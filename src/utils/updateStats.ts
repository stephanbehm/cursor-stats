import { log } from './logger';
import { getCursorTokenFromDB } from '../services/database';
import { checkUsageBasedStatus, fetchCursorStats, getStripeSessionUrl } from '../services/api';
import { checkAndNotifyUsage, checkAndNotifySpending } from '../handlers/notifications';
import { 
    startRefreshInterval, 
    startCountdownDisplay, 
    formatCountdown, 
    COOLDOWN_DURATION_MS,
    getRefreshInterval,
    getCooldownStartTime,
    getConsecutiveErrorCount,
    incrementConsecutiveErrorCount,
    setCooldownStartTime,
    resetConsecutiveErrorCount
} from './cooldown';
import { createMarkdownTooltip, formatTooltipLine, getMaxLineWidth, getStatusBarColor, createSeparator } from '../handlers/statusBar';
import * as vscode from 'vscode';
import { convertAndFormatCurrency, getCurrentCurrency } from './currency';

// Track unknown models to avoid repeated notifications
let unknownModelNotificationShown = false;
let detectedUnknownModels: Set<string> = new Set();

export async function updateStats(statusBarItem: vscode.StatusBarItem) {
    try {
        log('[Stats] ' +"=".repeat(100));
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

        const stats = await fetchCursorStats(token).catch(async (error: any) => {
            if (error.response?.status === 401 || error.response?.status === 403) {
                log('[Auth] Token expired or invalid, attempting to refresh...', true);
                const newToken = await getCursorTokenFromDB();
                if (newToken) {
                    log('[Auth] Successfully retrieved new token, retrying stats fetch...');
                    return await fetchCursorStats(newToken);
                }
            }
            log(`[Critical] API error: ${error.message}`, true);
            throw error; // Re-throw to be caught by outer catch
        });

        // Reset error count on successful fetch
        if (getConsecutiveErrorCount() > 0 || getCooldownStartTime()) {
            log('[Stats] API connection restored, resetting error state');
            resetConsecutiveErrorCount();
            if (getCooldownStartTime()) {
                setCooldownStartTime(null);
                startRefreshInterval();
            }
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
                const match = item.calculation.match(/^(\d+)\s*\*/);
                return sum + (match ? parseInt(match[1]) : 0);
            }, 0);
            totalRequests += usageBasedRequests;
            
            if (usageStatus.isEnabled && usageStatus.limit) {
                usageBasedPercent = (totalCost / usageStatus.limit) * 100;
            }
            
            // Convert currency for status bar display
            const formattedCost = await convertAndFormatCurrency(totalCost);
            costText = ` $(credit-card) ${formattedCost}`;

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
        // Always use premium percentage unless it's exhausted and usage-based is enabled
        const usagePercent = premiumPercent < 100 ? premiumPercent : 
                            (usageStatus.isEnabled ? usageBasedPercent : premiumPercent);
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
            formatTooltipLine(`   📊 ${premiumPercentFormatted}% utilized`),
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
            
            // Calculate usage percentage (always in USD)
            const usagePercentage = usageStatus.limit ? ((totalCostBeforeMidMonth / usageStatus.limit) * 100).toFixed(1) : '0.0';
            
            // Convert currency for tooltip
            const currencyCode = getCurrentCurrency();
            const formattedTotalCost = await convertAndFormatCurrency(totalCostBeforeMidMonth);
            const formattedUnpaidAmount = await convertAndFormatCurrency(unpaidAmount);
            const formattedLimit = await convertAndFormatCurrency(usageStatus.limit || 0);
            
            // Store original values for statusBar.ts to use
            const originalUsageData = {
                usdTotalCost: totalCostBeforeMidMonth,
                usdLimit: usageStatus.limit || 0,
                percentage: usagePercentage
            };
            
            if (stats.lastMonth.usageBasedPricing.midMonthPayment > 0) {
                contentLines.push(
                    formatTooltipLine(`   Current Usage (Total: ${formattedTotalCost} - Unpaid: ${formattedUnpaidAmount})`),
                    formatTooltipLine(`   __USD_USAGE_DATA__:${JSON.stringify(originalUsageData)}`), // Hidden metadata line
                    ''
                );
            } else {
                contentLines.push(
                    formatTooltipLine(`   Current Usage (Total: ${formattedTotalCost})`),
                    formatTooltipLine(`   __USD_USAGE_DATA__:${JSON.stringify(originalUsageData)}`), // Hidden metadata line 
                    ''
                );
            }
            
            for (const item of items) {
                // If the item has a description, use it to provide better context
                if (item.description) {
                    // Extract the item type from description for better display
                    let displayType = "";
                    let isKnownModel = true;
                    
                    if (item.description.includes("tool calls")) {
                        displayType = "Tool Calls";
                    } else if (item.description.match(/o3-mini/i)) {
                        displayType = "o3-mini";
                    } else if (item.description.match(/o1\s+requests/i)) {
                        displayType = "o1";
                    } else if (item.description.match(/claude-3\.7-sonnet-thinking-max/i)) {
                        displayType = "claude-3.7-sonnet-thinking-max";
                    } else if (item.description.match(/claude-3\.7-sonnet-max/i)) {
                        displayType = "claude-3.7-sonnet-max";
                    } else if (item.description.match(/extra fast premium/i)) {
                        displayType = "Fast Requests";
                    } else if (item.description.match(/gpt-4\.5-preview/i)) {
                        displayType = "gpt-4.5-preview";
                    } else if (item.description.match(/gemini-2-5-pro-exp-max/i)) {
                        displayType = "gemini-2-5-pro-exp-max";
                    } else {
                        // Try to extract a potential model name from the description
                        // Look for patterns like: "X requests for MODEL_NAME"
                        const modelMatch = item.description.match(/requests\s+(?:for|of|to)\s+([a-zA-Z0-9\-\.]+)/i);
                        if (modelMatch && modelMatch[1]) {
                            displayType = modelMatch[1];
                            isKnownModel = false;
                            
                            // Add to our set of detected unknown models
                            detectedUnknownModels.add(modelMatch[1]);
                            
                            log(`[Stats] Detected unknown model: ${modelMatch[1]} in description: "${item.description}"`, true);
                        } else {
                            displayType = "Requests";
                            
                            // Check if this might be a new model format we don't recognize
                            if (item.description.match(/requests/i) && !item.description.includes("Mid-month")) {
                                isKnownModel = false;
                                log(`[Stats] Potentially unknown model format: "${item.description}"`, true);
                                detectedUnknownModels.add(item.description);
                            }
                        }
                    }
                    
                    // Show notification if an unknown model was found and we haven't shown it yet
                    if (!isKnownModel && !unknownModelNotificationShown && detectedUnknownModels.size > 0) {
                        unknownModelNotificationShown = true;
                        
                        const unknownModels = Array.from(detectedUnknownModels).join(", ");
                        log(`[Stats] Showing notification for unknown models: ${unknownModels}`);
                        
                        vscode.window.showInformationMessage(
                            `New Cursor model detected on api response: "${unknownModels}". Please create a report and submit it on GitHub so we can add support for this model.`,
                            'Create Report',
                            'Open GitHub Issues'
                        ).then(selection => {
                            if (selection === 'Create Report') {
                                vscode.commands.executeCommand('cursor-stats.createReport');
                            } else if (selection === 'Open GitHub Issues') {
                                vscode.env.openExternal(vscode.Uri.parse('https://github.com/Dwtexe/cursor-stats/issues/new'));
                            }
                        });
                    }
                    
                    // Convert item cost for display
                    const itemCost = parseFloat(item.totalDollars.replace('$', ''));
                    const formattedItemCost = await convertAndFormatCurrency(itemCost);
                    const calculation = item.calculation.split('*')[0].trim();
                    const rate = item.calculation.split('*')[1]?.trim() || '';
                    
                    // If rate exists, convert its currency too
                    let formattedCalculation = calculation;
                    if (rate) {
                        const rateValue = parseFloat(rate.replace('$', ''));
                        const formattedRate = await convertAndFormatCurrency(rateValue);
                        formattedCalculation = `${calculation}*${formattedRate}`;
                    } else {
                        formattedCalculation = item.calculation;
                    }
                    
                    contentLines.push(formatTooltipLine(`   • ${formattedCalculation} (${displayType}) ➜ **${formattedItemCost}**`));
                } else {
                    // Convert item cost for display
                    const itemCost = parseFloat(item.totalDollars.replace('$', ''));
                    const formattedItemCost = await convertAndFormatCurrency(itemCost);
                    const calculation = item.calculation.split('*')[0].trim();
                    const rate = item.calculation.split('*')[1]?.trim() || '';
                    
                    // If rate exists, convert its currency too
                    let formattedCalculation = calculation;
                    if (rate) {
                        const rateValue = parseFloat(rate.replace('$', ''));
                        const formattedRate = await convertAndFormatCurrency(rateValue);
                        formattedCalculation = `${calculation}*${formattedRate}`;
                    } else {
                        formattedCalculation = item.calculation;
                    }
                    
                    contentLines.push(formatTooltipLine(`   • ${formattedCalculation} ➜ **${formattedItemCost}**`));
                }
            }
            
            if (stats.lastMonth.usageBasedPricing.midMonthPayment > 0) {
                const formattedMidMonthPayment = await convertAndFormatCurrency(stats.lastMonth.usageBasedPricing.midMonthPayment);
                contentLines.push(
                    '',
                    formatTooltipLine(`ℹ️ You have paid ${formattedMidMonthPayment} of this cost already`)
                );
            }

            const formattedFinalCost = await convertAndFormatCurrency(totalCostBeforeMidMonth);
            contentLines.push(
                '',
                formatTooltipLine(`💳 Total Cost: ${formattedFinalCost}`)
            );

            costText = ` $(credit-card) ${formattedFinalCost}`;

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
        // Filter out the metadata line before creating the final tooltip
        const visibleContentLines = contentLines.filter(line => !line.includes('__USD_USAGE_DATA__'));
        
        const tooltipLines = [
            title,
            separator,
            ...visibleContentLines.slice(1),
            '',
            formatTooltipLine(`🕒 Last Updated: ${new Date().toLocaleString()}`),
        ];

        // Update usage based percent for notifications
        usageBasedPercent = usageStatus.isEnabled ? usageBasedPercent : 0;
        
        log('[Status Bar] Updating status bar with new stats...');
        statusBarItem.text = `$(graph)${totalUsageText}`;
        statusBarItem.tooltip = await createMarkdownTooltip(tooltipLines, false, contentLines);
        statusBarItem.show();
        log('[Stats] Stats update completed successfully');

        // Show notifications after ensuring status bar is visible
        if (usageStatus.isEnabled) {
            setTimeout(() => {
                // First check premium usage
                const premiumPercent = Math.round((stats.premiumRequests.current / stats.premiumRequests.limit) * 100);
                checkAndNotifyUsage({
                    percentage: premiumPercent,
                    type: 'premium'
                });

                // Only check usage-based if premium is over limit
                if (premiumPercent >= 100) {
                    checkAndNotifyUsage({
                        percentage: usageBasedPercent,
                        type: 'usage-based',
                        limit: usageStatus.limit,
                        premiumPercentage: premiumPercent
                    });
                }

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
        const errorCount = incrementConsecutiveErrorCount();
        log(`[Critical] Error updating stats (Error count: ${errorCount}): ${error.message}`, true);

        if (errorCount >= 2) {
            // Always reset cooldown timer on errors after 2 consecutive failures
            setCooldownStartTime(Date.now());
            const refreshInterval = getRefreshInterval();
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
            startCountdownDisplay();
            log('[Critical] Starting/Resetting cooldown period due to consecutive errors');
        }

        const cooldownStartTime = getCooldownStartTime();
        statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorBackground');
        
        if (cooldownStartTime) {
            const now = Date.now();
            const elapsed = now - cooldownStartTime;
            const remaining = COOLDOWN_DURATION_MS - elapsed;
            statusBarItem.text = `$(warning) Cursor API Unavailable (Retrying in ${formatCountdown(remaining)})`;
        } else {
            statusBarItem.text = "$(error) Cursor Stats: Error";
        }

        const errorLines = [
            '⚠️ Error fetching Cursor stats',
            `❌ ${error.response?.status >= 500 ? 'Cursor API is temporarily unavailable' : 'Unable to retrieve usage statistics'}`,
            cooldownStartTime ? '\nAuto-refresh paused due to consecutive errors' : '',
            '',
            `🕒 Last attempt: ${new Date().toLocaleString()}`
        ].filter(line => line !== '');
        
        statusBarItem.tooltip = await createMarkdownTooltip(errorLines, true);
        statusBarItem.show();
        log('[Status Bar] Status bar visibility updated after error');
    }
}
