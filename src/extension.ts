// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as jwt from 'jsonwebtoken';

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

interface SQLiteRow {
	value: string;
}

let statusBarItem: vscode.StatusBarItem;
let updateInterval: NodeJS.Timeout;
let extensionContext: vscode.ExtensionContext;

function isValidToken(token: string | undefined): boolean {
	return token !== undefined && token.startsWith('user_');
}

async function getCursorTokenFromDB(): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		let dbPath = '';
		if (process.platform === 'win32') {
			dbPath = path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
		} else if (process.platform === 'darwin') {
			dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
		} else {
			dbPath = path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
		}

		const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
			if (err) {
				console.error('Error opening database:', err);
				resolve(undefined);
				return;
			}
		});

		db.get("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'", [], (err, row: SQLiteRow) => {
			db.close();
			if (err) {
				console.error('Error querying database:', err);
				resolve(undefined);
				return;
			}

			if (!row) {
				resolve(undefined);
				return;
			}

			try {
				const token = row.value;
				const decoded = jwt.decode(token, { complete: true });
				if (!decoded || !decoded.payload || !decoded.payload.sub) {
					resolve(undefined);
					return;
				}

				const sub = decoded.payload.sub.toString();
				const userId = sub.split('|')[1];
				const sessionToken = `${userId}%3A%3A${token}`;
				resolve(sessionToken);
			} catch (error) {
				console.error('Error processing token:', error);
				resolve(undefined);
			}
		});
	});
}

async function getValidToken(context: vscode.ExtensionContext): Promise<string | undefined> {
	return await getCursorTokenFromDB();
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	extensionContext = context;
	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	
	// Register command to open Cursor settings
	const openCursorSettings = vscode.commands.registerCommand('cursor-stats.openSettings', () => {
		vscode.env.openExternal(vscode.Uri.parse('https://www.cursor.com/settings'));
	});
	
	// Add command to status bar item
	statusBarItem.command = 'cursor-stats.openSettings';
	
	context.subscriptions.push(statusBarItem, openCursorSettings);

	// Start update loop
	updateStats();
	updateInterval = setInterval(updateStats, 1000);
}

function formatTooltipLine(text: string, maxWidth: number = 50): string {
	if (text.length <= maxWidth) return text;
	const words = text.split(' ');
	let lines = [];
	let currentLine = '';

	for (const word of words) {
		if ((currentLine + word).length > maxWidth) {
			if (currentLine) lines.push(currentLine.trim());
			currentLine = word;
		} else {
			currentLine += (currentLine ? ' ' : '') + word;
		}
	}
	if (currentLine) lines.push(currentLine.trim());
	return lines.join('\n   ');
}

function getMaxLineWidth(lines: string[]): number {
	return Math.max(...lines.map(line => line.length));
}

function createSeparator(width: number): string {
	// Divide by 2 since emojis and other special characters count as double width
	const separatorWidth = Math.floor(width / 2);
	return '╌'.repeat(separatorWidth+5);
}

async function updateStats() {
	try {
		const token = await getValidToken(extensionContext);
		
		if (!token) {
			statusBarItem.text = "$(alert) Cursor Stats: No token found";
			statusBarItem.tooltip = '⚠️ Could not retrieve Cursor token from database';
			statusBarItem.show();
			return;
		}

		const stats = await fetchCursorStats(token).catch(async (error) => {
			if (error.response?.status === 401 || error.response?.status === 403) {
				console.log('Token expired or invalid, trying to get new token from DB');
				const newToken = await getCursorTokenFromDB();
				if (newToken) {
					return await fetchCursorStats(newToken);
				}
			}
			throw error;
		});

		if (!stats) {
			throw new Error('Failed to fetch stats');
		}
		
		let costText = '';
		
		// Build content first to determine width
		const title = '⚡ Cursor Usage Statistics ⚡';
		const contentLines = [
			title,
			'',
			'🚀 Premium Fast Requests'
		];
		
		const usagePercent = Math.round((stats.premiumRequests.current / stats.premiumRequests.limit) * 100);
		contentLines.push(
			formatTooltipLine(`   • ${stats.premiumRequests.current}/${stats.premiumRequests.limit} requests used`),
			formatTooltipLine(`   📊 ${usagePercent}% utilized ${getUsageEmoji(usagePercent)}`),
			'',
			'📈 Usage-Based Pricing'
		);
		
		if (stats.lastMonth.usageBasedPricing.length > 0) {
			const items = stats.lastMonth.usageBasedPricing;
			const totalCost = items.reduce((sum, item) => sum + parseFloat(item.totalDollars.replace('$', '')), 0);
			
			for (const item of items) {
				contentLines.push(formatTooltipLine(`   • ${item.calculation} ➜ ${item.totalDollars}`));
			}
			
			contentLines.push(
				'',
				formatTooltipLine(`💳 Total Cost: $${totalCost.toFixed(2)}`)
			);
			
			costText = ` $(credit-card) $${totalCost.toFixed(2)}`;
		} else {
			contentLines.push('   ℹ️ No usage data for last month');
		}

		contentLines.push(
			'',
			formatTooltipLine(`📅 Period: ${getMonthName(stats.lastMonth.month)} ${stats.lastMonth.year}`)
		);

		// Calculate separator width based on content
		const maxWidth = getMaxLineWidth(contentLines);
		const separator = createSeparator(maxWidth);

		// Assemble final tooltip with dynamic separators
		let tooltipText = [
			title,
			separator,
			...contentLines.slice(1),
			separator
		].join('\n');

		statusBarItem.text = `$(graph) ${stats.premiumRequests.current}/${stats.premiumRequests.limit}${costText}`;
		statusBarItem.tooltip = tooltipText;
		statusBarItem.show();
	} catch (error) {
		console.error('Error updating stats:', error);
		statusBarItem.text = "$(error) Cursor Stats: Error";
		const errorLines = [
			'⚠️ Error fetching Cursor stats',
			'❌ Unable to retrieve usage statistics'
		];
		const errorSeparator = createSeparator(getMaxLineWidth(errorLines));
		let tooltipText = [
			errorLines[0],
			errorSeparator,
			errorLines[1]
		].join('\n');
		statusBarItem.tooltip = tooltipText;
		statusBarItem.show();
	}
}

function getUsageEmoji(percentage: number): string {
	if (percentage >= 90) return '🔴';
	if (percentage >= 75) return '🟡';
	if (percentage >= 50) return '🔵';
	return '✅';
}

function getMonthName(month: number): string {
	const months = [
		'January', 'February', 'March', 'April',
		'May', 'June', 'July', 'August',
		'September', 'October', 'November', 'December'
	];
	return months[month - 1];
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
