// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { checkForUpdates } from './services/github';
import { createMarkdownTooltip, createSeparator, createStatusBarItem, formatTooltipLine, getMaxLineWidth, getStatusBarColor, getUsageEmoji } from './handlers/statusBar';
import { initializeLogging, log } from './utils/logger';
import { getCursorTokenFromDB } from './services/database';
import { checkUsageBasedStatus, getCurrentUsageLimit, setUsageLimit, fetchCursorStats, getStripeSessionUrl } from './services/api';
import { checkAndNotifyUsage, resetNotifications, checkAndNotifySpending } from './handlers/notifications';

let statusBarItem: vscode.StatusBarItem;
let refreshInterval: NodeJS.Timeout;
let extensionContext: vscode.ExtensionContext;
let outputChannel: vscode.OutputChannel | undefined;
let lastReleaseCheck: number = 0;
let isWindowFocused: boolean = true; // Add focus state tracking
const RELEASE_CHECK_INTERVAL = 1000 * 60 * 60; // Check every hour

function getRefreshIntervalMs(): number {
    const config = vscode.workspace.getConfiguration('cursorStats');
    const intervalSeconds = Math.max(config.get('refreshInterval', 30), 5); // Minimum 5 seconds
    return intervalSeconds * 1000;
}

function startRefreshInterval() {
    // Clear any existing interval
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    
    // Only start interval if window is focused
    if (isWindowFocused) {
        // Start new interval
        const intervalMs = getRefreshIntervalMs();
        log(`[Refresh] Starting refresh interval: ${intervalMs}ms`);
        refreshInterval = setInterval(updateStats, intervalMs);
    } else {
        log('[Refresh] Window not focused, refresh interval not started');
    }
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
    try {
        // Initialize logging first
        initializeLogging(context);
        
        log('[Initialization] Extension activation started');
        extensionContext = context;

        // Reset notifications on activation
        resetNotifications();

        // Create status bar item with enhanced logging
        statusBarItem = createStatusBarItem();

        // Add window focus event listeners
        const focusListener = vscode.window.onDidChangeWindowState(e => {
            isWindowFocused = e.focused;
            log(`[Window] Window focus changed: ${isWindowFocused ? 'focused' : 'unfocused'}`);
            
            if (isWindowFocused) {
                // Immediately update stats when window regains focus
                updateStats();
                // Restart the refresh interval
                startRefreshInterval();
            } else {
                // Clear interval when window loses focus
                if (refreshInterval) {
                    clearInterval(refreshInterval);
                    log('[Refresh] Cleared refresh interval due to window losing focus');
                }
            }
        });

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
        const openCursorSettings = vscode.commands.registerCommand('cursor-stats.openSettings', async () => {
            log('[Command] Opening extension settings...');
            // Use a more reliable way to open settings
            const settingsUri = vscode.Uri.parse('vscode://ms-vscode.cursor-stats/settings');
            try {
                // Try to open settings directly first
                await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:Dwtexe.cursor-stats');
            } catch (error) {
                log('[Command] Failed to open settings directly, trying alternative method...', true);
                try {
                    // Fallback to opening settings view
                    await vscode.commands.executeCommand('workbench.action.openSettings');
                    // Then search for our extension
                    await vscode.commands.executeCommand('workbench.action.search.toggleQueryDetails');
                    await vscode.commands.executeCommand('workbench.action.search.action.replaceAll', '@ext:Dwtexe.cursor-stats');
                } catch (fallbackError) {
                    log('[Command] Failed to open settings with fallback method', true);
                    // Show error message to user
                    vscode.window.showErrorMessage('Failed to open Cursor Stats settings. Please try opening VS Code settings manually.');
                }
            }
        });

        // Add configuration change listener
        const configListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('cursorStats.enableStatusBarColors')) {
                log('[Settings] Status bar colors setting changed, updating display...');
                await updateStats();
            }
            if (e.affectsConfiguration('cursorStats.refreshInterval')) {
                log('[Settings] Refresh interval changed, restarting timer...');
                startRefreshInterval();
            }
            if (e.affectsConfiguration('cursorStats.showTotalRequests')) {
                log('[Settings] Show total requests setting changed, updating display...');
                await updateStats();
            }
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

                if (!quickPick) {
                    return;
                }

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
        context.subscriptions.push(
            statusBarItem, 
            openCursorSettings, 
            refreshCommand, 
            setLimitCommand,
            configListener,
            focusListener  // Add focus listener to subscriptions
        );
        log('[Initialization] Subscriptions registered');
        
        // Show status bar item explicitly
        log('[Status Bar] Showing status bar item...');
        statusBarItem.show();
        log('[Status Bar] Initial visibility state set');

        // Start refresh interval
        startRefreshInterval();

        // Initial update and update check
        setTimeout(async () => {
            await updateStats();
            // Check for updates after initial stats are loaded
            await checkForUpdates(lastReleaseCheck, RELEASE_CHECK_INTERVAL);
        }, 1500);

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

        // Show status bar early to ensure visibility
        statusBarItem.show();

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
            statusBarItem.show();
            log('[Status Bar] Status bar visibility updated after API error');
            return;
        }
        
        let costText = '';
        
        // Calculate usage percentages
        const premiumPercent = Math.round((stats.premiumRequests.current / stats.premiumRequests.limit) * 100);
        let usageBasedPercent = 0;
        let totalUsageText = '';
        let totalRequests = stats.premiumRequests.current;

        if (stats.lastMonth.usageBasedPricing.items.length > 0) {
            const items = stats.lastMonth.usageBasedPricing.items;
            const totalCost = items.reduce((sum, item) => sum + parseFloat(item.totalDollars.replace('$', '')), 0);
            
            // Calculate total requests from usage-based pricing
            const usageBasedRequests = items.reduce((sum, item) => {
                const match = item.calculation.match(/(\d+)\s*\*/);
                return sum + (match ? parseInt(match[1]) : 0);
            }, 0);
            totalRequests += usageBasedRequests;
            
            if (usageStatus.isEnabled && usageStatus.limit) {
                usageBasedPercent = (totalCost / usageStatus.limit) * 100;
            }
            
            costText = ` $(credit-card) $${totalCost.toFixed(2)}`;

            // Calculate total usage text if enabled
            const config = vscode.workspace.getConfiguration('cursorStats');
            const showTotalRequests = config.get<boolean>('showTotalRequests', false);
            
            if (showTotalRequests) {
                totalUsageText = ` ${totalRequests}/${stats.premiumRequests.limit}${costText}`;
            } else {
                totalUsageText = ` ${stats.premiumRequests.current}/${stats.premiumRequests.limit}${costText}`;
            }
        } else {
            totalUsageText = ` ${stats.premiumRequests.current}/${stats.premiumRequests.limit}`;
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
        const premiumPercentFormatted = Math.round(premiumPercent);
        const startDate = new Date(stats.premiumRequests.startOfMonth);
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1);

        const formatDateWithMonthName = (date: Date) => {
            const day = date.getDate();
            const monthName = date.toLocaleString('en-US', { month: 'long' });
            return `${day} ${monthName}`;
        };

        contentLines.push(
            formatTooltipLine(`   • ${stats.premiumRequests.current}/${stats.premiumRequests.limit} requests used`),
            formatTooltipLine(`   📊 ${premiumPercentFormatted}% utilized ${getUsageEmoji(premiumPercent)}`),
            formatTooltipLine(`   Fast Requests Period: ${formatDateWithMonthName(startDate)} - ${formatDateWithMonthName(endDate)}`),
            '',
            '📈 Usage-Based Pricing'
        );
        
        if (stats.lastMonth.usageBasedPricing.items.length > 0) {
            const items = stats.lastMonth.usageBasedPricing.items;
            // Calculate total cost without including the mid-month payment in the sum
            let totalCost = items.reduce((sum, item) => sum + parseFloat(item.totalDollars.replace('$', '')), 0);
            
            // Calculate usage-based pricing period
            const billingDay = 3;
            const currentDate = new Date();
            let periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), billingDay);
            let periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, billingDay - 1);
            
            // If we're before the billing day, adjust the period to the previous month
            if (currentDate.getDate() < billingDay) {
                periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, billingDay);
                periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), billingDay - 1);
            }
            
            contentLines.push(
                formatTooltipLine(`   Usage Based Period: ${formatDateWithMonthName(periodStart)} - ${formatDateWithMonthName(periodEnd)}`),
            );
            
            // Add total cost header with unpaid amount if there's a mid-month payment
            const totalCostBeforeMidMonth = items.reduce((sum, item) => sum + parseFloat(item.totalDollars.replace('$', '')), 0);
            const unpaidAmount = totalCostBeforeMidMonth - stats.lastMonth.usageBasedPricing.midMonthPayment;
            
            if (stats.lastMonth.usageBasedPricing.midMonthPayment > 0) {
                contentLines.push(
                    formatTooltipLine(`   Current Usage (Total: $${totalCostBeforeMidMonth.toFixed(2)} - Unpaid: $${unpaidAmount.toFixed(2)})`),
                    ''
                );
            } else {
                contentLines.push(
                    formatTooltipLine(`   Current Usage (Total: $${totalCostBeforeMidMonth.toFixed(2)})`),
                    ''
                );
            }
            
            for (const item of items) {
                contentLines.push(formatTooltipLine(`   • ${item.calculation} ➜ ${item.totalDollars}`));
            }
            
            if (stats.lastMonth.usageBasedPricing.midMonthPayment > 0) {
                contentLines.push(
                    '',
                    formatTooltipLine(`ℹ️ You have paid $${stats.lastMonth.usageBasedPricing.midMonthPayment.toFixed(2)} of this cost already`)
                );
            }

            contentLines.push(
                '',
                formatTooltipLine(`💳 Total Cost: $${totalCostBeforeMidMonth.toFixed(2)}`)
            );

            costText = ` $(credit-card) $${totalCostBeforeMidMonth.toFixed(2)}`;

            // Add spending notification check
            if (usageStatus.isEnabled) {
                setTimeout(() => {
                    checkAndNotifySpending(totalCostBeforeMidMonth);
                }, 1000);
            }
        } else {
            contentLines.push('   ℹ️ No usage data for last month');
        }

        // Calculate separator width based on content
        const maxWidth = getMaxLineWidth(contentLines);
        const separator = createSeparator(maxWidth);

        // Create final tooltip content with Last Updated at the bottom
        const tooltipLines = [
            title,
            separator,
            ...contentLines.slice(1),
            '',
            formatTooltipLine(`🕒 Last Updated: ${new Date().toLocaleString()}`),
        ];

        // Update usage based percent for notifications
        usageBasedPercent = usageStatus.isEnabled ? usageBasedPercent : 0;
        
        log('[Status Bar] Updating status bar with new stats...');
        statusBarItem.text = `$(graph)${totalUsageText}`;
        statusBarItem.tooltip = await createMarkdownTooltip(tooltipLines);
        statusBarItem.show();
        log('[Status Bar] Status bar visibility updated after stats update');
        log('[Stats] Stats update completed successfully');

        // Show notifications after ensuring status bar is visible
        if (usageStatus.isEnabled) {
            setTimeout(() => {
                checkAndNotifyUsage({
                    percentage: usageBasedPercent,
                    type: 'usage-based',
                    limit: usageStatus.limit
                });

                if (stats.lastMonth.usageBasedPricing.hasUnpaidMidMonthInvoice) {
                    vscode.window.showWarningMessage('⚠️ You have an unpaid mid-month invoice. Please pay it to continue using usage-based pricing.', 'Open Billing Page')
                        .then(async selection => {
                            if (selection === 'Open Billing Page') {
                                try {
                                    const stripeUrl = await getStripeSessionUrl(token);
                                    vscode.env.openExternal(vscode.Uri.parse(stripeUrl));
                                } catch (error) {
                                    // Fallback to settings page if stripe URL fails
                                    vscode.env.openExternal(vscode.Uri.parse('https://www.cursor.com/settings'));
                                }
                            }
                        });
                }
            }, 1000);
        } else {
            setTimeout(() => {
                checkAndNotifyUsage({
                    percentage: premiumPercent,
                    type: 'premium'
                });
            }, 1000);
        }
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
        statusBarItem.show();
        log('[Status Bar] Status bar visibility updated after error');
    }
}

export function deactivate() {
    log('[Deactivation] Extension deactivation started');
    try {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            log('[Deactivation] Refresh interval cleared');
        }
        
        if (outputChannel) {
            outputChannel.dispose();
            log('[Deactivation] Output channel disposed');
        }
        
        log('[Deactivation] Extension deactivation completed successfully');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        log(`[Critical] Failed to deactivate extension cleanly: ${errorMessage}`, true);
        if (error instanceof Error && error.stack) {
            log(`[Critical] Stack trace: ${error.stack}`, true);
        }
        throw error;
    }
}
