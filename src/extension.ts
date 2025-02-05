// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { checkForUpdates } from './services/github';
import { TimingInfo } from './interfaces/types';
import { createMarkdownTooltip, createSeparator, createStatusBarItem, formatTooltipLine, getMaxLineWidth, getMonthName, getStatusBarColor, getUsageEmoji } from './handlers/statusBar';
import { initializeLogging, log } from './utils/logger';
import { getCursorTokenFromDB, initializeDatabase, closeDatabase, findNewestTimingInfo } from './services/database';
import { checkUsageBasedStatus, getCurrentUsageLimit, setUsageLimit, fetchCursorStats } from './services/api';

let statusBarItem: vscode.StatusBarItem;
let updateInterval: NodeJS.Timeout;
let extensionContext: vscode.ExtensionContext;
let outputChannel: vscode.OutputChannel | undefined;
let lastTimingInfo: TimingInfo | null = null;
let lastReleaseCheck: number = 0;
const RELEASE_CHECK_INTERVAL = 1000 * 60 * 60; // Check every hour


// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
	try {
		// Initialize logging first
		initializeLogging(context);
		
		log('[Initialization] Extension activation started');
		extensionContext = context;

		// Create status bar item with enhanced logging
		statusBarItem = createStatusBarItem();

		// Check initial usage-based status
		const token = await getCursorTokenFromDB();
		if (token) {
			log('[Initialization] Checking usage-based pricing status...');
			const status = await checkUsageBasedStatus(token);
			log(`[Initialization] Usage-based pricing is ${status.isEnabled ? 'enabled' : 'disabled'}${status.limit ? ` with limit $${status.limit}` : ''}`);
		}
		
		// Register commands
		log('[Initialization] Registering commands...');
		const refreshCommand = vscode.commands.registerCommand('cursor-stats.refreshStats', async () => {
			log('[Command] Manually refreshing stats...');
			await updateStats();
		});
		const openCursorSettings = vscode.commands.registerCommand('cursor-stats.openSettings', () => {
			log('[Command] Opening Cursor settings...');
			vscode.env.openExternal(vscode.Uri.parse('https://www.cursor.com/settings'));
		});
		const setLimitCommand = vscode.commands.registerCommand('cursor-stats.setLimit', async () => {
			const token = await getCursorTokenFromDB();
			if (!token) {
				vscode.window.showErrorMessage('Please sign in to Cursor first');
				return;
			}

			try {
				const currentLimit = await getCurrentUsageLimit(token);
				const isEnabled = !currentLimit.noUsageBasedAllowed;
				
				const quickPick = await vscode.window.showQuickPick([
					{
						label: '$(check) Enable Usage-Based Pricing',
						description: 'Turn on usage-based pricing and set a limit',
						value: 'enable'
					},
					{
						label: '$(pencil) Set Monthly Limit',
						description: 'Change your monthly spending limit',
						value: 'set'
					},
					{
						label: '$(x) Disable Usage-Based Pricing',
						description: 'Turn off usage-based pricing',
						value: 'disable'
					}
				], {
					placeHolder: `Current status: ${isEnabled ? 'Enabled' : 'Disabled'} ${isEnabled ? `(Limit: $${currentLimit.hardLimit})` : ''}`
				});

				if (!quickPick) return;

				switch (quickPick.value) {
					case 'enable':
						if (!isEnabled) {
							const limit = await vscode.window.showInputBox({
								prompt: 'Enter monthly spending limit in dollars',
								placeHolder: '50',
								validateInput: (value) => {
									const num = Number(value);
									return (!isNaN(num) && num > 0) ? null : 'Please enter a valid number greater than 0';
								}
							});
							if (limit) {
								await setUsageLimit(token, Number(limit), false);
								vscode.window.showInformationMessage(`Usage-based pricing enabled with $${limit} limit`);
								await updateStats();
							}
						} else {
							vscode.window.showInformationMessage('Usage-based pricing is already enabled');
						}
						break;

					case 'set':
						if (isEnabled) {
							const newLimit = await vscode.window.showInputBox({
								prompt: 'Enter new monthly spending limit in dollars',
								placeHolder: String(currentLimit.hardLimit),
								validateInput: (value) => {
									const num = Number(value);
									return (!isNaN(num) && num > 0) ? null : 'Please enter a valid number greater than 0';
								}
							});
							if (newLimit) {
								await setUsageLimit(token, Number(newLimit), false);
								vscode.window.showInformationMessage(`Monthly limit updated to $${newLimit}`);
								await updateStats();
							}
						} else {
							vscode.window.showWarningMessage('Please enable usage-based pricing first');
						}
						break;

					case 'disable':
						if (isEnabled) {
							await setUsageLimit(token, 0, true);
							vscode.window.showInformationMessage('Usage-based pricing disabled');
							await updateStats();
						} else {
							vscode.window.showInformationMessage('Usage-based pricing is already disabled');
						}
						break;
				}
			} catch (error: any) {
				vscode.window.showErrorMessage(`Failed to manage usage limit: ${error.message}`);
			}
		});
		
		// Add command to status bar item
		statusBarItem.command = 'cursor-stats.openSettings';
		log('[Status Bar] Command assigned to status bar item');
		
		// Add to subscriptions
		context.subscriptions.push(statusBarItem, openCursorSettings, refreshCommand, setLimitCommand);
		log('[Initialization] Subscriptions registered');

		// Initialize database connection
		log('[Database] Initializing database connection...');
		await initializeDatabase();
		
		// Show status bar item explicitly
		log('[Status Bar] Showing status bar item...');
		statusBarItem.show();
		log('[Status Bar] Initial visibility state set');

		// Initial update
		log('[Stats] Performing initial stats update...');
		await updateStats();

		// Start monitoring loop with optimized interval
		log('[Monitoring] Starting monitoring loop...');
		updateInterval = setInterval(monitorDatabase, 1000);

		// Check for updates on startup
		await checkForUpdates(lastReleaseCheck, RELEASE_CHECK_INTERVAL);
		
		// Schedule periodic update checks
		setInterval(() => checkForUpdates(lastReleaseCheck, RELEASE_CHECK_INTERVAL), RELEASE_CHECK_INTERVAL);

		log('[Initialization] Extension activation completed successfully');
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
		log(`[Critical] Failed to activate extension: ${errorMessage}`, true);
		if (error instanceof Error && error.stack) {
			log(`[Critical] Stack trace: ${error.stack}`, true);
		}
		throw error;
	}
}


async function updateStats() {
	try {
		log('[Stats] Starting stats update...');
		const token = await getCursorTokenFromDB();
		
		if (!token) {
			log('[Critical] No valid token found', true);
			statusBarItem.text = "$(alert) Cursor Stats: No token found";
			statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorBackground');
			const tooltipLines = [
				'⚠️ Could not retrieve Cursor token from database'
			];
			statusBarItem.tooltip = await createMarkdownTooltip(tooltipLines, true);
			log('[Status Bar] Updated status bar with no token message');
			statusBarItem.show();
			log('[Status Bar] Status bar visibility updated after no token');
			return;
		}

		// Check usage-based status first
		const usageStatus = await checkUsageBasedStatus(token);
		log(`[Stats] Usage-based pricing status: ${JSON.stringify(usageStatus)}`);

		log('[Stats] Token retrieved successfully, fetching stats...');
		const stats = await fetchCursorStats(token).catch(async (error: any) => {
			if (error.response?.status === 401 || error.response?.status === 403) {
				log('[Auth] Token expired or invalid, attempting to refresh...', true);
				const newToken = await getCursorTokenFromDB();
				if (newToken) {
					log('[Auth] Successfully retrieved new token, retrying stats fetch...');
					return await fetchCursorStats(newToken);
				}
			}
			if (error.response?.status >= 500) {
				log(`[Critical] Cursor API server error: ${error.response.status}`, true);
				return null;
			}
			log(`[Critical] Unexpected error during stats fetch: ${error.message}`, true);
			throw error;
		});

		if (!stats) {
			log('[Critical] Failed to fetch stats from API', true);
			statusBarItem.text = "$(warning) Cursor API Unavailable";
			statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningBackground');
			const tooltipLines = [
				'⚠️ Cursor API is temporarily unavailable',
				'Please try again later',
				'',
				`Usage-Based Pricing: ${usageStatus.isEnabled ? '✅ Enabled' : '❌ Disabled'}`,
				usageStatus.limit ? `Monthly Limit: $${usageStatus.limit}` : '',
				'',
				`🕒 Last attempt: ${new Date().toLocaleString()}`
			].filter(line => line !== '');
			
			statusBarItem.tooltip = await createMarkdownTooltip(tooltipLines, true);
			log('[Status Bar] Updated status bar with API unavailable message');
			log('[Status Bar] Status bar visibility updated after API error');
			return;
		}
		
		let costText = '';
		
		// Calculate usage percentages
		const premiumPercent = Math.round((stats.premiumRequests.current / stats.premiumRequests.limit) * 100);
		let usageBasedPercent = 0;
		
		if (stats.lastMonth.usageBasedPricing.length > 0) {
			const items = stats.lastMonth.usageBasedPricing;
			const totalCost = items.reduce((sum, item) => sum + parseFloat(item.totalDollars.replace('$', '')), 0);
			
			if (usageStatus.isEnabled && usageStatus.limit) {
				usageBasedPercent = (totalCost / usageStatus.limit) * 100;
			}
			
			costText = ` $(credit-card) $${totalCost.toFixed(2)}`;
		}

		// Set status bar color based on usage type
		const usagePercent = usageStatus.isEnabled ? usageBasedPercent : premiumPercent;
		statusBarItem.color = getStatusBarColor(usagePercent);

		// Build content first to determine width
		const title = '⚡ Cursor Usage Statistics ⚡';
		const contentLines = [
			title,
			'',
			'🚀 Premium Fast Requests'
		];
		
		// Format premium requests progress with fixed decimal places
		const premiumPercentFormatted = Math.round(premiumPercent); // Round to whole number
		contentLines.push(
			formatTooltipLine(`   • ${stats.premiumRequests.current}/${stats.premiumRequests.limit} requests used`),
			formatTooltipLine(`   📊 ${premiumPercentFormatted}% utilized ${getUsageEmoji(premiumPercent)}`),
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
			formatTooltipLine(`📅 Period: ${getMonthName(stats.lastMonth.month)} ${stats.lastMonth.year}`),
			'',
			formatTooltipLine(`🕒 Last Updated: ${new Date().toLocaleString()}`)
		);

		// Calculate separator width based on content
		const maxWidth = getMaxLineWidth(contentLines);
		const separator = createSeparator(maxWidth);

		// Create final tooltip content
		const tooltipLines = [
			title,
			separator,
			...contentLines.slice(1)
		];

		log('[Status Bar] Updating status bar with new stats...');
		statusBarItem.text = `$(graph) ${stats.premiumRequests.current}/${stats.premiumRequests.limit}${costText}`;
		statusBarItem.tooltip = await createMarkdownTooltip(tooltipLines);
		statusBarItem.show();
		log('[Status Bar] Status bar visibility updated after stats update');
		log('[Stats] Stats update completed successfully');
	} catch (error: any) {
		log(`[Critical] Error updating stats: ${error.message}`, true);
		statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorBackground');
		let errorMessage = 'Unable to retrieve usage statistics';
		if (error.response?.status >= 500) {
			errorMessage = 'Cursor API is temporarily unavailable';
		}
		
		statusBarItem.text = "$(error) Cursor Stats: Error";
		const errorLines = [
			'⚠️ Error fetching Cursor stats',
			`❌ ${errorMessage}`,
			'',
			`🕒 Last attempt: ${new Date().toLocaleString()}`
		];
		
		statusBarItem.tooltip = await createMarkdownTooltip(errorLines, true);
		log('[Status Bar] Status bar visibility updated after error');
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	try {
		if (updateInterval) {
			clearInterval(updateInterval);
		}
		if (statusBarItem) {
			statusBarItem.dispose();
		}
		if (outputChannel) {
			outputChannel.dispose();
		}
		// Close database connection
		closeDatabase().catch(error => {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			log(`Error closing database connection: ${errorMessage}`, true);
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		console.error('Error during deactivation:', errorMessage);
	}
}

async function monitorDatabase() {
	try {
		const currentTime = new Date().toISOString();
		log(`[DB Check] Checking database at ${currentTime}`);
		
		const timing = await findNewestTimingInfo();
		
		if (!timing) {
			log('No timing information found in database');
			return;
		}

		// Only update if we have new timing information
		if (!lastTimingInfo || 
			timing.key !== lastTimingInfo.key || 
			timing.timestamp !== lastTimingInfo.timestamp) {
			
			log(`New timing information found: ${JSON.stringify(timing)}`);
			lastTimingInfo = timing;
			
			// Only make API call when we detect new activity
			await updateStats();
		}
	} catch (error) {
		log(`Error monitoring database: ${error}`, true);
	}
}
