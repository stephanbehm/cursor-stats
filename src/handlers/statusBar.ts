import * as vscode from 'vscode';
import { log } from '../utils/logger';
import { getCurrentUsageLimit } from '../services/api';
import { getCursorTokenFromDB } from '../services/database';


let statusBarItem: vscode.StatusBarItem;

export function createStatusBarItem(): vscode.StatusBarItem {
    log('[Status Bar] Creating status bar item...');
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    log('[Status Bar] Status bar alignment: Right, Priority: 100');
    return statusBarItem;
}

export function formatTooltipLine(text: string, maxWidth: number = 50): string {
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

export function getMaxLineWidth(lines: string[]): number {
    return Math.max(...lines.map(line => line.length));
}

export function createSeparator(width: number): string {
    const separatorWidth = Math.floor(width / 2);
    return '╌'.repeat(separatorWidth + 5);
}

export function getUsageLimitEmoji(currentCost: number, limit: number): string {
    const percentage = (currentCost / limit) * 100;
    if (percentage >= 90) return '🔴';
    if (percentage >= 75) return '🟡';
    if (percentage >= 50) return '🟢';
    return '✅';
}

export function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${hours}:${minutes}:${seconds}`;
}

export async function createMarkdownTooltip(lines: string[], isError: boolean = false): Promise<vscode.MarkdownString> {
	const tooltip = new vscode.MarkdownString();
	tooltip.isTrusted = true;
	tooltip.supportHtml = true;
	tooltip.supportThemeIcons = true;

	// Header section with centered title
	tooltip.appendMarkdown('<div align="center">\n\n');
	tooltip.appendMarkdown('## ⚡ Cursor Usage\n\n');
	tooltip.appendMarkdown('</div>\n\n');

	if (isError) {
		tooltip.appendMarkdown('> ⚠️ **Error State**\n\n');
		tooltip.appendMarkdown(lines.join('\n\n'));
	} else {
		// Premium Requests Section
		if (lines.some(line => line.includes('Premium Fast Requests'))) {
			tooltip.appendMarkdown('<div align="center">\n\n');
			tooltip.appendMarkdown('### 🚀 Premium Fast Requests\n\n');
			tooltip.appendMarkdown('</div>\n\n');
			
			// Extract and format premium request info
			const requestLine = lines.find(line => line.includes('requests used'));
			const percentLine = lines.find(line => line.includes('utilized'));
			if (requestLine) {
				tooltip.appendMarkdown(`**Usage:** ${requestLine.split('•')[1].trim()}\n\n`);
				if (percentLine) {
					tooltip.appendMarkdown(`**Progress:** ${percentLine.split('📊')[1].trim()}\n\n`);
				}
			}
		}

		// Usage Based Pricing Section
		const token = await getCursorTokenFromDB();
		let isEnabled = false;

		if (token) {
			try {
				const limitResponse = await getCurrentUsageLimit(token);
				isEnabled = !limitResponse.noUsageBasedAllowed;
				const costLine = lines.find(line => line.includes('Total Cost:'));
				const totalCost = costLine ? parseFloat(costLine.split('$')[1]) : 0;

				tooltip.appendMarkdown('<div align="center">\n\n');
				tooltip.appendMarkdown(`### 📈 Usage-Based Pricing (${isEnabled ? 'Enabled' : 'Disabled'})\n\n`);
				tooltip.appendMarkdown('</div>\n\n');
				
				if (isEnabled && limitResponse.hardLimit) {
					const usagePercentage = ((totalCost / limitResponse.hardLimit) * 100).toFixed(1);
					const usageEmoji = getUsageLimitEmoji(totalCost, limitResponse.hardLimit);
					tooltip.appendMarkdown(`**Monthly Limit:** $${limitResponse.hardLimit.toFixed(2)} (${usagePercentage}% used) ${usageEmoji}\n\n`);
				} else if (!isEnabled) {
					tooltip.appendMarkdown('> ℹ️ Usage-based pricing is currently disabled\n\n');
				}
				
				// Show usage details regardless of enabled/disabled status
				const pricingLines = lines.filter(line => line.includes('*') && line.includes('➜'));
				if (pricingLines.length > 0) {
					const costLine = lines.find(line => line.includes('Total Cost:'));
					const totalCost = costLine ? costLine.split('Total Cost:')[1].trim() : '';
					
					tooltip.appendMarkdown(`**Current Usage** (Total: ${totalCost}):\n\n`);
					pricingLines.forEach(line => {
						const [calc, cost] = line.split('➜').map(part => part.trim());
						tooltip.appendMarkdown(`• ${calc.replace('•', '').trim()} → ${cost}\n\n`);
					});
				} else {
					tooltip.appendMarkdown('> ℹ️ No usage recorded for this period\n\n');
				}
			} catch (error: any) {
				log('[API] Error fetching limit for tooltip: ' + error.message, true);
				tooltip.appendMarkdown('> ⚠️ Error checking usage-based pricing status\n\n');
			}
		} else {
			tooltip.appendMarkdown('> ⚠️ Unable to check usage-based pricing status\n\n');
		}

		// Period and Last Updated in a table format
		const periodLine = lines.find(line => line.includes('Period:'));
		const updatedLine = lines.find(line => line.includes('Last Updated:'));
		if (periodLine || updatedLine) {
			tooltip.appendMarkdown('---\n\n');
			tooltip.appendMarkdown('<div align="center">\n\n');
			if (periodLine && updatedLine) {
				const period = periodLine.split(':')[1].trim();
				const updatedTime = updatedLine.split(':').slice(1).join(':').trim();
				tooltip.appendMarkdown(`📅 **Period:** ${period} • 🕒 **Updated:** ${formatRelativeTime(updatedTime)}\n\n`);
			} else {
				if (periodLine) {
					tooltip.appendMarkdown(`📅 **Period:** ${periodLine.split(':')[1].trim()}\n\n`);
				}
				if (updatedLine) {
					const updatedTime = updatedLine.split(':').slice(1).join(':').trim();
					tooltip.appendMarkdown(`🕒 **Updated:** ${formatRelativeTime(updatedTime)}\n\n`);
				}
			}
			tooltip.appendMarkdown('</div>\n\n');
		}
	}

	// Action Buttons Section with consistent center alignment
	tooltip.appendMarkdown('---\n\n');
	tooltip.appendMarkdown('<div align="center">\n\n');
	tooltip.appendMarkdown('🔄 [Refresh](command:cursor-stats.refreshStats) • ');
	tooltip.appendMarkdown('⚙️ [Settings](command:cursor-stats.openSettings) • ');
	tooltip.appendMarkdown('💰 [Usage Based Pricing](command:cursor-stats.setLimit)\n\n');
	tooltip.appendMarkdown('</div>');

	return tooltip;
}

export function getStatusBarColor(percentage: number): vscode.ThemeColor {
    if (percentage >= 95) {
        return new vscode.ThemeColor('charts.red');
    } else if (percentage >= 90) {
        return new vscode.ThemeColor('errorForeground');
    } else if (percentage >= 85) {
        return new vscode.ThemeColor('testing.iconFailed');
    } else if (percentage >= 80) {
        return new vscode.ThemeColor('notebookStatusErrorIcon.foreground');
    } else if (percentage >= 75) {
        return new vscode.ThemeColor('charts.yellow');
    } else if (percentage >= 70) {
        return new vscode.ThemeColor('notebookStatusRunningIcon.foreground');
    } else if (percentage >= 65) {
        return new vscode.ThemeColor('charts.orange');
    } else if (percentage >= 60) {
        return new vscode.ThemeColor('charts.blue');
    } else if (percentage >= 50) {
        return new vscode.ThemeColor('charts.green');
    } else if (percentage >= 40) {
        return new vscode.ThemeColor('testing.iconPassed');
    } else if (percentage >= 30) {
        return new vscode.ThemeColor('terminal.ansiGreen');
    } else if (percentage >= 20) {
        return new vscode.ThemeColor('symbolIcon.classForeground');
    } else if (percentage >= 10) {
        return new vscode.ThemeColor('debugIcon.startForeground');
    } else {
        return new vscode.ThemeColor('foreground');
    }
}

export function getUsageEmoji(percentage: number): string {
    if (percentage >= 90) return '🔴';
    if (percentage >= 75) return '🟡';
    if (percentage >= 50) return '🟢';
    return '✅';
}

export function getMonthName(month: number): string {
    const months = [
        'January', 'February', 'March', 'April',
        'May', 'June', 'July', 'August',
        'September', 'October', 'November', 'December'
    ];
    return months[month - 1];
}
