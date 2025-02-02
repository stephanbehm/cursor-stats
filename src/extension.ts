// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';

interface UsageItem {
	calculation: string;
	totalDollars: string;
}

interface CursorStats {
	currentMonth: {
		month: number;
		year: number;
		usageBasedPricing: UsageItem[];
	};
	lastMonth: {
		month: number;
		year: number;
		usageBasedPricing: UsageItem[];
	};
	premiumRequests: {
		current: number;
		limit: number;
	};
}

let statusBarItem: vscode.StatusBarItem;
let updateInterval: NodeJS.Timeout;
let extensionContext: vscode.ExtensionContext;

function isValidToken(token: string | undefined): boolean {
	return token !== undefined && token.startsWith('user_');
}

async function getValidToken(context: vscode.ExtensionContext): Promise<string | undefined> {
	// First try to get from workspace settings
	const configToken = vscode.workspace.getConfiguration().get('cursorStats.sessionToken') as string;
	if (isValidToken(configToken)) {
		return configToken;
	}

	// If config token was explicitly cleared, clear the global state too
	if (configToken === '') {
		await context.globalState.update('cursorSessionToken', undefined);
		return undefined;
	}

	// Then try global state
	const stateToken = context.globalState.get('cursorSessionToken') as string;
	if (isValidToken(stateToken)) {
		return stateToken;
	}

	return undefined;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	extensionContext = context;
	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'cursor-stats.updateToken';
	context.subscriptions.push(statusBarItem);

	// Register commands
	let updateTokenCommand = vscode.commands.registerCommand('cursor-stats.updateToken', async () => {
		const token = await vscode.window.showInputBox({
			prompt: 'Enter your Cursor Session Token (must start with "user_")',
			password: true,
			validateInput: (value) => {
				return isValidToken(value) ? null : 'Token must start with "user_"';
			}
		});
		
		if (token) {
			await context.globalState.update('cursorSessionToken', token);
			await vscode.workspace.getConfiguration().update('cursorStats.sessionToken', token, true);
			updateStats();
		}
	});

	context.subscriptions.push(updateTokenCommand);

	// Check if valid token exists, if not prompt for it
	const token = await getValidToken(context);
	if (!token) {
		const newToken = await vscode.window.showInputBox({
			prompt: 'Enter your Cursor Session Token to start monitoring usage (must start with "user_")',
			password: true,
			validateInput: (value) => {
				return isValidToken(value) ? null : 'Token must start with "user_"';
			}
		});
		
		if (newToken) {
			await context.globalState.update('cursorSessionToken', newToken);
			await vscode.workspace.getConfiguration().update('cursorStats.sessionToken', newToken, true);
		}
	}

	// Start update loop
	updateStats();
	updateInterval = setInterval(updateStats, 1000);
}

async function updateStats() {
	try {
		const token = await getValidToken(extensionContext);
		
		if (!token) {
			statusBarItem.text = "$(warning) Cursor Stats: No valid token";
			statusBarItem.tooltip = 'Click to add a valid Cursor Session Token (must start with "user_")';
			statusBarItem.show();
			return;
		}

		const stats = await fetchCursorStats(token);
		
		// Format usage pricing details
		let costText = '';
		let tooltipText = 'Cursor Usage Statistics\n';
		tooltipText += '━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
		tooltipText += 'Usage-Based Pricing:\n';
		
		if (stats.lastMonth.usageBasedPricing.length > 0) {
			const items = stats.lastMonth.usageBasedPricing;
			const totalCost = items.reduce((sum, item) => sum + parseFloat(item.totalDollars.replace('$', '')), 0);
			
			// Calculate maximum lengths for each component
			const maxIndexLength = items.length.toString().length;
			const maxCalcLength = Math.max(...items.map(item => item.calculation.length));
			const maxCostLength = Math.max(...items.map(item => item.totalDollars.length));
			
			// Calculate padding for perfect alignment
			const indexPadding = 6;  // Space after the index number
			const equalsPadding = 2; // Space around equals sign
			
			// Add each usage item to tooltip with proper alignment
			items.forEach((item, index) => {
				const indexStr = `${index + 1}.`.padEnd(maxIndexLength + indexPadding);
				const calcStr = item.calculation.padStart(maxCalcLength);
				const costStr = item.totalDollars.padStart(maxCostLength);
				tooltipText += `      ${indexStr}${calcStr}  =  ${costStr}\n`;
			});
			
			costText = ` (+$${totalCost.toFixed(2)})`;
		} else {
			tooltipText += '      No usage data for last month';
		}

		tooltipText += '\n\nPremium Fast Requests:\n';
		tooltipText += `      ${stats.premiumRequests.current}/${stats.premiumRequests.limit} requests used`;
		tooltipText += '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n';
		tooltipText += 'Click to update token';

		statusBarItem.text = `$(graph) ${stats.premiumRequests.current}/${stats.premiumRequests.limit}${costText}`;
		statusBarItem.tooltip = tooltipText;
		statusBarItem.show();
	} catch (error) {
		console.error('Error updating stats:', error);
		statusBarItem.text = "$(error) Cursor Stats: Error";
		let tooltipText = 'Error fetching Cursor stats\n';
		tooltipText += '━━━━━━━━━━━━━━━━━━━━━━━━━\n';
		tooltipText += 'Click to update token';
		statusBarItem.tooltip = tooltipText;
		statusBarItem.show();
	}
}

async function fetchCursorStats(token: string): Promise<CursorStats> {
	const currentDate = new Date();
	const currentMonth = currentDate.getMonth() + 1;
	const currentYear = currentDate.getFullYear();
	const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
	const lastYear = currentMonth === 1 ? currentYear - 1 : currentYear;

	// Extract user ID from token (part before %3A%3A)
	const userId = token.split('%3A%3A')[0];

	async function fetchMonthData(month: number, year: number): Promise<UsageItem[]> {
		const response = await axios.post('https://www.cursor.com/api/dashboard/get-monthly-invoice', {
			month,
			year,
			includeUsageEvents: false
		}, {
			headers: {
				Cookie: `WorkosCursorSessionToken=${token}`
			}
		});

		const usageItems: UsageItem[] = [];
		if (response.data.items) {
			for (const item of response.data.items) {
				const requestCount = parseInt(item.description.match(/(\d+)/)[1]);
				const cents = item.cents;
				const costPerRequest = cents / requestCount;
				const dollars = cents / 100;

				usageItems.push({
					calculation: `${requestCount}*${Math.floor(costPerRequest)}`,
					totalDollars: `$${dollars.toFixed(2)}`
				});
			}
		}
		return usageItems;
	}

	// Fetch premium requests info using the extracted user ID
	const premiumResponse = await axios.get('https://www.cursor.com/api/usage', {
		params: { user: userId },
		headers: {
			Cookie: `WorkosCursorSessionToken=${token}`
		}
	});

	return {
		currentMonth: {
			month: currentMonth,
			year: currentYear,
			usageBasedPricing: await fetchMonthData(currentMonth, currentYear)
		},
		lastMonth: {
			month: lastMonth,
			year: lastYear,
			usageBasedPricing: await fetchMonthData(lastMonth, lastYear)
		},
		premiumRequests: {
			current: premiumResponse.data['gpt-4'].numRequests,
			limit: premiumResponse.data['gpt-4'].maxRequestUsage
		}
	};
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (updateInterval) {
		clearInterval(updateInterval);
	}
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}
