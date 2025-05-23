import { log } from './logger';
import { getCursorTokenFromDB } from '../services/database';
import { checkUsageBasedStatus, fetchCursorStats, getStripeSessionUrl } from '../services/api';
import { checkAndNotifyUsage, checkAndNotifySpending, checkAndNotifyUnpaidInvoice } from '../handlers/notifications';
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
            
            // Calculate actual total cost (sum of positive items only)
            const actualTotalCost = items.reduce((sum, item) => {
                const cost = parseFloat(item.totalDollars.replace('$', ''));
                // Only add positive costs (ignore mid-month payment credits)
                return cost > 0 ? sum + cost : sum;
            }, 0);

            // Calculate total requests from usage-based pricing (needed for status bar text)
            const usageBasedRequests = items.reduce((sum, item) => {
                // Only count requests from positive cost items
                if (parseFloat(item.totalDollars.replace('$', '')) > 0) {
                    const match = item.calculation.match(/^\*\*(\d+)\*\*/);
                    return sum + (match ? parseInt(match[1]) : 0);
                }
                return sum;
            }, 0);
            totalRequests += usageBasedRequests;
            
            // Calculate usage percentage based on actual total cost (always in USD)
            if (usageStatus.isEnabled && usageStatus.limit) {
                usageBasedPercent = (actualTotalCost / usageStatus.limit) * 100;
            }
            
            // Convert actual cost currency for status bar display
            const formattedActualCost = await convertAndFormatCurrency(actualTotalCost);
            costText = ` $(credit-card) ${formattedActualCost}`;

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

            // Calculate actual total cost (sum of positive items only)
            const actualTotalCost = items.reduce((sum, item) => {
                const cost = parseFloat(item.totalDollars.replace('$', ''));
                return cost > 0 ? sum + cost : sum;
            }, 0);
            
            // Calculate usage-based pricing period
            const billingDay = 3;
            const currentDate = new Date();
            let periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), billingDay);
            let periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, billingDay - 1);
            
            if (currentDate.getDate() < billingDay) {
                periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, billingDay);
                periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), billingDay - 1);
            }
            
            contentLines.push(
                formatTooltipLine(`   Usage Based Period: ${formatDateWithMonthName(periodStart)} - ${formatDateWithMonthName(periodEnd)}`),
            );
            
            // Calculate unpaid amount correctly
            const unpaidAmount = Math.max(0, actualTotalCost - stats.lastMonth.usageBasedPricing.midMonthPayment);
            
            // Calculate usage percentage based on actual total cost (always in USD)
            const usagePercentage = usageStatus.limit ? ((actualTotalCost / usageStatus.limit) * 100).toFixed(1) : '0.0';
            
            // Convert currency for tooltip
            const currencyCode = getCurrentCurrency();
            const formattedActualTotalCost = await convertAndFormatCurrency(actualTotalCost);
            const formattedUnpaidAmount = await convertAndFormatCurrency(unpaidAmount);
            const formattedLimit = await convertAndFormatCurrency(usageStatus.limit || 0);
            
            // Store original values for statusBar.ts to use, using actual total cost
            const originalUsageData = {
                usdTotalCost: actualTotalCost, // Use actual cost here
                usdLimit: usageStatus.limit || 0,
                percentage: usagePercentage
            };
            
            if (stats.lastMonth.usageBasedPricing.midMonthPayment > 0) {
                contentLines.push(
                    formatTooltipLine(`   Current Usage (Total: ${formattedActualTotalCost} - Unpaid: ${formattedUnpaidAmount})`),
                    formatTooltipLine(`   __USD_USAGE_DATA__:${JSON.stringify(originalUsageData)}`), // Hidden metadata line
                    ''
                );
            } else {
                contentLines.push(
                    formatTooltipLine(`   Current Usage (Total: ${formattedActualTotalCost})`),
                    formatTooltipLine(`   __USD_USAGE_DATA__:${JSON.stringify(originalUsageData)}`), // Hidden metadata line 
                    ''
                );
            }
            
            // Determine the maximum length for formatted item costs for padding
            let maxFormattedItemCostLength = 0;
            for (const item of items) {
                if (item.description?.includes('Mid-month usage paid')) {
                    continue;
                }
                const itemCost = parseFloat(item.totalDollars.replace('$', ''));
                // We format with 2 decimal places for display
                const tempFormattedCost = itemCost.toFixed(2); // Format to string with 2 decimals
                if (tempFormattedCost.length > maxFormattedItemCostLength) {
                    maxFormattedItemCostLength = tempFormattedCost.length;
                }
            }

            for (const item of items) {
                // Skip mid-month payment line item from the detailed list
                if (item.description?.includes('Mid-month usage paid')) {
                    continue;
                }

                // If the item has a description, use it to provide better context
                if (item.description) {
                    // Logic for populating detectedUnknownModels for the notification
                    // This now uses modelNameForTooltip as a primary signal from api.ts
                    if (item.modelNameForTooltip === "unknown-model" && item.description) {
                        // api.ts couldn't determine a specific model.
                        // Let's inspect the raw description for a hint for the notification.
                        let extractedTermForNotification = "";

                        // Try to extract model name from specific patterns first
                        const tokenBasedDescMatch = item.description.match(/^(\d+) token-based usage calls to ([\w.-]+),/i);
                        if (tokenBasedDescMatch && tokenBasedDescMatch[2]) {
                            extractedTermForNotification = tokenBasedDescMatch[2].trim();
                        } else {
                            const extraFastMatch = item.description.match(/extra fast premium requests? \(([^)]+)\)/i);
                            if (extraFastMatch && extraFastMatch[1]) {
                                extractedTermForNotification = extraFastMatch[1].trim();
                            } else {
                                // General case: "N ACTUAL_MODEL_NAME_OR_PHRASE requests/calls"
                                const fullDescMatch = item.description.match(/^(\d+)\s+(.+?)(?: request| calls)?(?: beyond|\*| per|$)/i);
                                if (fullDescMatch && fullDescMatch[2]) {
                                    extractedTermForNotification = fullDescMatch[2].trim();
                                    // If it's discounted and starts with "discounted ", remove prefix
                                    if (item.isDiscounted && extractedTermForNotification.toLowerCase().startsWith("discounted ")) {
                                        extractedTermForNotification = extractedTermForNotification.substring(11).trim();
                                    }
                                } else {
                                    // Fallback: first word after number if other patterns fail (less likely to be useful)
                                    const simpleDescMatch = item.description.match(/^(\d+)\s+([\w.-]+)/i); // Changed to [\w.-]+
                                    if (simpleDescMatch && simpleDescMatch[2]) {
                                        extractedTermForNotification = simpleDescMatch[2].trim();
                                    }
                                }
                            }
                        }
                        
                        // General cleanup of suffixes
                        extractedTermForNotification = extractedTermForNotification.replace(/requests?|calls?|beyond|\*|per|,$/gi, '').trim();
                        if (extractedTermForNotification.toLowerCase().endsWith(" usage")) {
                            extractedTermForNotification = extractedTermForNotification.substring(0, extractedTermForNotification.length - 6).trim();
                        }
                        // Ensure it's not an empty string after cleanup
                        if (extractedTermForNotification && 
                            extractedTermForNotification.length > 1 && // Meaningful length
                            extractedTermForNotification.toLowerCase() !== "token-based" &&
                            extractedTermForNotification.toLowerCase() !== "discounted") {

                            const veryGenericKeywords = [
                                'usage', 'calls', 'request', 'requests', 'cents', 'beyond', 'month', 'day',
                                'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
                                'premium', 'extra', 'tool', 'fast', 'thinking'
                                // Model families like 'claude', 'gpt', 'gemini', 'o1' etc. are NOT here, 
                                // as "claude-x" should be flagged if "claude-x" is new.
                            ];
                            
                            const isVeryGeneric = veryGenericKeywords.includes(extractedTermForNotification.toLowerCase());

                            if (!isVeryGeneric) {
                                const alreadyPresent = Array.from(detectedUnknownModels).some(d => d.toLowerCase().includes(extractedTermForNotification.toLowerCase()) || extractedTermForNotification.toLowerCase().includes(d.toLowerCase()));
                                if (!alreadyPresent) {
                                    detectedUnknownModels.add(extractedTermForNotification);
                                    log(`[Stats] Adding to detectedUnknownModels (api.ts flagged as unknown-model, extracted term): '${extractedTermForNotification}' from "${item.description}"`);
                                }
                            }
                        }
                    }
                    
                    // Convert item cost for display
                    const itemCost = parseFloat(item.totalDollars.replace('$', ''));
                    let formattedItemCost = await convertAndFormatCurrency(itemCost);

                    // Pad the numerical part of the formattedItemCost
                    const currencySymbol = formattedItemCost.match(/^[^0-9-.\\,]*/)?.[0] || "";
                    const numericalPart = formattedItemCost.substring(currencySymbol.length);
                    const paddedNumericalPart = numericalPart.padStart(maxFormattedItemCostLength, '0');
                    formattedItemCost = currencySymbol + paddedNumericalPart;
                    
                    let line = `   • ${item.calculation} ➜ &nbsp;&nbsp;**${formattedItemCost}**`;
                    const modelName = item.modelNameForTooltip;
                    let modelNameDisplay = ""; // Initialize for the model name part of the string

                    if (modelName) { // Make sure modelName is there
                        const isDiscounted = item.description && item.description.toLowerCase().includes("discounted");
                        const isUnknown = modelName === "unknown-model";

                        if (isDiscounted) {
                            modelNameDisplay = `(discounted | ${isUnknown ? "unknown-model" : modelName})`;
                        } else if (isUnknown) {
                            modelNameDisplay = "(unknown-model)";
                        } else {
                            modelNameDisplay = `(${modelName})`;
                        }
                    }
                    // If modelName was undefined or null, modelNameDisplay remains empty.

                    if (modelNameDisplay) { // Only add spacing and display string if it's not empty
                        const desiredTotalWidth = 70; // Adjust as needed for good visual alignment
                        const currentLineWidth = line.replace(/\*\*/g, '').replace(/&nbsp;/g, ' ').length; // Approx length without markdown & html spaces
                        const modelNameDisplayLength = modelNameDisplay.replace(/&nbsp;/g, ' ').length;
                        const spacesNeeded = Math.max(1, desiredTotalWidth - currentLineWidth - modelNameDisplayLength);
                        line += ' '.repeat(spacesNeeded) + `&nbsp;&nbsp;&nbsp;&nbsp;${modelNameDisplay}`;
                    }
                    contentLines.push(formatTooltipLine(line));

                } else {
                    // Fallback for items without a description (should be rare but handle it)
                    const itemCost = parseFloat(item.totalDollars.replace('$', ''));
                    let formattedItemCost = await convertAndFormatCurrency(itemCost);

                    // Pad the numerical part of the formattedItemCost
                    const currencySymbol = formattedItemCost.match(/^[^0-9-.\\,]*/)?.[0] || "";
                    const numericalPart = formattedItemCost.substring(currencySymbol.length);
                    const paddedNumericalPart = numericalPart.padStart(maxFormattedItemCostLength, '0');
                    formattedItemCost = currencySymbol + paddedNumericalPart;
                    
                    // Use a generic calculation string if item.calculation is also missing, or the original if available
                    const calculationString = item.calculation || "Unknown Item"; 
                    contentLines.push(formatTooltipLine(`   • ${calculationString} ➜ &nbsp;&nbsp;**${formattedItemCost}**`));
                }
            }

            if (stats.lastMonth.usageBasedPricing.midMonthPayment > 0) {
                const formattedMidMonthPayment = await convertAndFormatCurrency(stats.lastMonth.usageBasedPricing.midMonthPayment);
                contentLines.push(
                    '',
                    formatTooltipLine(`ℹ️ You have paid **${formattedMidMonthPayment}** of this cost already`)
                );
            }

            const formattedFinalCost = await convertAndFormatCurrency(actualTotalCost);
            contentLines.push(
                '',
                formatTooltipLine(`💳 Total Cost: ${formattedFinalCost}`)
            );

            // Update costText for status bar here, using actual total cost
            costText = ` $(credit-card) ${formattedFinalCost}`;

            // Add spending notification check
            if (usageStatus.isEnabled) {
                setTimeout(() => {
                    checkAndNotifySpending(actualTotalCost); // Check spending based on actual total cost
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
                    checkAndNotifyUnpaidInvoice(token);
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

        // The main notification for unknown models is now based on the populated detectedUnknownModels set
        if (!unknownModelNotificationShown && detectedUnknownModels.size > 0) {
            unknownModelNotificationShown = true; // Show once per session globally
            const unknownModelsString = Array.from(detectedUnknownModels).join(", ");
            log(`[Stats] Showing notification for aggregated unknown models: ${unknownModelsString}`);
            
            vscode.window.showInformationMessage(
                `New or unhandled Cursor model terms detected: "${unknownModelsString}". If these seem like new models, please create a report and submit it on GitHub.`,
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
    } catch (error: any) {
        const errorCount = incrementConsecutiveErrorCount();
        log(`[Critical] API error: ${error.message}`, true);
        log('[Status Bar] Status bar visibility updated after error');
    }
}
