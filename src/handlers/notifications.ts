import * as vscode from 'vscode';
import { log } from '../utils/logger';

// Track which thresholds have been notified in the current session
const notifiedThresholds = new Set<number>();

// Reset notification tracking
export function resetNotifications() {
    notifiedThresholds.clear();
    log('[Notifications] Reset notification tracking');
}

interface UsageInfo {
    percentage: number;
    type: 'premium' | 'usage-based';
    limit?: number;
}

export async function checkAndNotifyUsage(usageInfo: UsageInfo) {
    const config = vscode.workspace.getConfiguration('cursorStats');
    const enableAlerts = config.get<boolean>('enableAlerts', true);
    
    if (!enableAlerts) {
        return;
    }

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

        const notification = await vscode.window.showWarningMessage(
            message,
            'View Settings',
            'Dismiss'
        );

        if (notification === 'View Settings') {
            await vscode.commands.executeCommand('cursor-stats.openSettings');
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
} 