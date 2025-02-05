import * as vscode from 'vscode';
import { log } from '../utils/logger';

// Track which thresholds have been notified in the current session
const notifiedThresholds = new Set<number>();
let isNotificationInProgress = false;

// Reset notification tracking
export function resetNotifications() {
    notifiedThresholds.clear();
    isNotificationInProgress = false;
    log('[Notifications] Reset notification tracking');
}

interface UsageInfo {
    percentage: number;
    type: 'premium' | 'usage-based';
    limit?: number;
}

export async function checkAndNotifyUsage(usageInfo: UsageInfo) {
    // Prevent concurrent notifications
    if (isNotificationInProgress) {
        log('[Notifications] Notification already in progress, skipping...');
        return;
    }

    const config = vscode.workspace.getConfiguration('cursorStats');
    const enableAlerts = config.get<boolean>('enableAlerts', true);
    
    if (!enableAlerts) {
        return;
    }

    try {
        isNotificationInProgress = true;
        const thresholds = config.get<number[]>('usageAlertThresholds', [75, 90, 100])
            .sort((a, b) => a - b);

        const { percentage, type, limit } = usageInfo;

        // Find the highest threshold that has been exceeded but not yet notified
        const exceededThreshold = thresholds
            .reverse()
            .find(threshold => percentage >= threshold && !notifiedThresholds.has(threshold));

        if (exceededThreshold) {
            log(`[Notifications] Usage threshold ${exceededThreshold}% exceeded for ${type} usage`);
            
            const message = type === 'premium' 
                ? `Premium request usage has reached ${percentage.toFixed(1)}%`
                : `Usage-based spending has reached ${percentage.toFixed(1)}% of your $${limit} limit`;

            // Use a modal notification to avoid interfering with status bar visibility
            const notification = await vscode.window.showWarningMessage(
                message,
                { modal: false, detail: 'Click View Settings to manage your usage limits.' },
                'View Settings',
                'Dismiss'
            );

            if (notification === 'View Settings') {
                try {
                    // Try to open settings directly first
                    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:Dwtexe.cursor-stats');
                } catch (error) {
                    log('[Notifications] Failed to open settings directly, trying alternative method...', true);
                    try {
                        // Fallback to opening settings view
                        await vscode.commands.executeCommand('workbench.action.openSettings');
                        // Then search for our extension
                        await vscode.commands.executeCommand('workbench.action.search.toggleQueryDetails');
                        await vscode.commands.executeCommand('workbench.action.search.action.replaceAll', '@ext:Dwtexe.cursor-stats');
                    } catch (fallbackError) {
                        log('[Notifications] Failed to open settings with fallback method', true);
                        // Show error message to user
                        vscode.window.showErrorMessage('Failed to open Cursor Stats settings. Please try opening VS Code settings manually.');
                    }
                }
            }

            notifiedThresholds.add(exceededThreshold);
        }

        // Clear notifications for thresholds that are no longer exceeded
        // This allows re-notification if usage goes above threshold again
        for (const threshold of notifiedThresholds) {
            if (percentage < threshold) {
                notifiedThresholds.delete(threshold);
                log(`[Notifications] Cleared notification for threshold ${threshold}%`);
            }
        }
    } finally {
        isNotificationInProgress = false;
    }
} 