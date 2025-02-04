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

interface SQLiteError extends Error {
	code?: string;
	errno?: number;
}

interface AxiosErrorData {
	status?: number;
	data?: any;
	message?: string;
}

interface ExtendedAxiosError {
	response?: AxiosErrorData;
	message: string;
}

interface ComposerData {
	conversation: Array<{
		timingInfo?: {
			clientStartTime: number;
			[key: string]: any;
		};
		[key: string]: any;
	}>;
}

interface TimingInfo {
	key: string;
	timestamp: number;
	timingInfo: {
		clientStartTime: number;
		[key: string]: any;
	};
}

interface UsageLimitResponse {
	hardLimit?: number;
	noUsageBasedAllowed?: boolean;
}

let statusBarItem: vscode.StatusBarItem;
let updateInterval: NodeJS.Timeout;
let extensionContext: vscode.ExtensionContext;
let outputChannel: vscode.OutputChannel | undefined;
let lastTimingInfo: TimingInfo | null = null;
let dbConnection: sqlite3.Database | null = null;

function isValidToken(token: string | undefined): boolean {
	return token !== undefined && token.startsWith('user_');
}

async function getCursorTokenFromDB(): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		let dbPath = '';
		if (process.platform === 'win32') {
			dbPath = path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
		} else if (process.platform === 'linux') {
			// Check if running in WSL
			const isWSL = process.env.WSL_DISTRO_NAME || process.env.IS_WSL;
			if (isWSL) {
				// Get Windows username from environment variable
				const windowsUsername = process.env.WIN_USER || process.env.USERNAME || '';
				if (windowsUsername) {
					dbPath = path.join('/mnt/c/Users', windowsUsername, 'AppData/Roaming/Cursor/User/globalStorage/state.vscdb');
				} else {
					dbPath = path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
				}
			} else {
				dbPath = path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
			}
		} else if (process.platform === 'darwin') {
			dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
		} else {
			dbPath = path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
		}

		log(`Platform: ${process.platform}`);
		log(`Home directory: ${os.homedir()}`);
		log(`Attempting to open database at: ${dbPath}`);
		log(`Database path exists: ${require('fs').existsSync(dbPath)}`);

		const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
			if (err) {
				const sqlError = err as SQLiteError;
				log('Error opening database: ' + err, true);
				log('Database error details: ' + JSON.stringify({
					code: sqlError.code,
					errno: sqlError.errno,
					message: sqlError.message,
					path: dbPath
				}), true);
				resolve(undefined);
				return;
			}

			log('Successfully opened database connection');
		});

		log('Executing SQL query for token...');
		db.get("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'", [], (err, row: SQLiteRow) => {
			if (err) {
				const sqlError = err as SQLiteError;
				log('Error querying database: ' + err, true);
				log('Query error details: ' + JSON.stringify({
					code: sqlError.code,
					errno: sqlError.errno,
					message: sqlError.message
				}), true);
				db.close();
				resolve(undefined);
				return;
			}

			log(`Query completed. Row found: ${!!row}`);
			db.close();

			if (!row) {
				log('No token found in database');
				resolve(undefined);
				return;
			}

			try {
				log('Processing token from database...');
				const token = row.value;
				log(`Token length: ${token.length}`);
				log(`Token starts with: ${token.substring(0, 20)}...`);

				const decoded = jwt.decode(token, { complete: true });
				log(`JWT decoded successfully: ${!!decoded}`);
				log(`JWT payload exists: ${!!(decoded && decoded.payload)}`);
				log(`JWT sub exists: ${!!(decoded && decoded.payload && decoded.payload.sub)}`);

				if (!decoded || !decoded.payload || !decoded.payload.sub) {
					log('Invalid JWT structure: ' + JSON.stringify({ decoded }), true);
					resolve(undefined);
					return;
				}

				const sub = decoded.payload.sub.toString();
				log(`Sub value: ${sub}`);
				const userId = sub.split('|')[1];
				log(`Extracted userId: ${userId}`);
				const sessionToken = `${userId}%3A%3A${token}`;
				log(`Created session token, length: ${sessionToken.length}`);
				resolve(sessionToken);
			} catch (error: any) {
				log('Error processing token: ' + error, true);
				log('Error details: ' + JSON.stringify({
					name: error.name,
					message: error.message,
					stack: error.stack
				}), true);
				resolve(undefined);
			}
		});
	});
}

async function getValidToken(context: vscode.ExtensionContext): Promise<string | undefined> {
	return await getCursorTokenFromDB();
}

async function initializeDatabase(): Promise<void> {
	if (dbConnection) {
		return;
	}

	return new Promise((resolve, reject) => {
		const dbPath = getCursorDBPath();
		
		// First try to open with normal sqlite3
		try {
			dbConnection = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
				if (err) {
					const sqlError = err as SQLiteError;
					log(`Error initializing database connection: ${err}`, true);
					log('Database error details: ' + JSON.stringify({
						code: sqlError.code,
						errno: sqlError.errno,
						message: sqlError.message,
						path: dbPath
					}), true);

					// If we're on Apple Silicon, try rebuilding sqlite3
					if (process.platform === 'darwin' && process.arch === 'arm64') {
						log('Detected Apple Silicon, attempting to rebuild sqlite3...', true);
						try {
							const { execSync } = require('child_process');
							execSync('npm rebuild sqlite3 --build-from-source --target_arch=arm64', {
								stdio: 'inherit'
							});
							
							// Try opening the database again after rebuild
							dbConnection = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (rebuildErr) => {
								if (rebuildErr) {
									log('Failed to open database after rebuild: ' + rebuildErr, true);
									dbConnection = null;
									resolve(); // Resolve without error to allow extension to continue
								} else {
									log('Successfully opened database after rebuild');
									resolve();
								}
							});
						} catch (rebuildError) {
							log('Failed to rebuild sqlite3: ' + rebuildError, true);
							dbConnection = null;
							resolve(); // Resolve without error to allow extension to continue
						}
					} else {
						dbConnection = null;
						resolve(); // Resolve without error to allow extension to continue
					}
				} else {
					log('Database connection initialized successfully');
					resolve();
				}
			});
		} catch (error) {
			log(`Critical error during database initialization: ${error}`, true);
			dbConnection = null;
			resolve(); // Resolve without error to allow extension to continue
		}
	});
}

async function closeDatabase(): Promise<void> {
	return new Promise((resolve) => {
		if (dbConnection) {
			dbConnection.close(() => {
				dbConnection = null;
				log('Database connection closed');
				resolve();
			});
		} else {
			resolve();
		}
	});
}

async function readComposerEntries(): Promise<Array<[string, string]>> {
	if (!dbConnection) {
		await initializeDatabase();
	}

	if (!dbConnection) {
		log('Failed to initialize database connection', true);
		return [];
	}

	return new Promise((resolve) => {
		dbConnection!.all(
			"SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
			[],
			(err, rows: Array<{ key: string; value: string }>) => {
				if (err) {
					log(`Error querying database: ${err}`, true);
					resolve([]);
					return;
				}

				const results = rows.map(row => [row.key, row.value] as [string, string]);
				resolve(results);
			}
		);
	});
}

function log(message: string, error: boolean = false): void {
	const config = vscode.workspace.getConfiguration('cursorStats');
	const loggingEnabled = config.get<boolean>('enableLogging', false);
	
	// During development/debugging, show all logs
	// Always log errors, initialization logs, status bar logs, database logs, and API calls
	const shouldLog = error || 
					 loggingEnabled || 
					 message.includes('[Initialization]') || 
					 message.includes('[Status Bar]') ||
					 message.includes('[Database]') ||
					 message.includes('[DB Check]') ||
					 message.includes('[Auth]') ||
					 message.includes('[Stats]') ||
					 message.includes('[API]') ||
					 message.includes('[Critical]');
	
	if (shouldLog) {
		safeLog(message, error);
	}
}

function safeLog(message: string, isError: boolean = false): void {
	const timestamp = new Date().toISOString();
	const logLevel = isError ? 'ERROR' : 'INFO';
	const logMessage = `[${timestamp}] [${logLevel}] ${message}`;

	// Always log to console
	if (isError) {
		console.error(logMessage);
	} else {
		console.log(logMessage);
	}

	// Try to log to output channel if it exists
	try {
		outputChannel?.appendLine(logMessage);
	} catch {
		console.error('Failed to write to output channel');
	}

	// Show error messages in the UI for critical issues
	if (isError && message.includes('[Critical]')) {
		try {
			vscode.window.showErrorMessage(`Cursor Stats: ${message}`);
		} catch {
			console.error('Failed to show error message in UI');
		}
	}
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
	try {
		// Initialize logging first
		initializeLogging(context);
		
		log('[Initialization] Extension activation started');
		extensionContext = context;

		// Create status bar item with enhanced logging
		log('[Status Bar] Creating status bar item...');
		statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		log('[Status Bar] Status bar alignment: Right, Priority: 100');
		
		// Check initial usage-based status
		const token = await getValidToken(context);
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
			const token = await getValidToken(extensionContext);
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

function getUsageLimitEmoji(currentCost: number, limit: number): string {
	const percentage = (currentCost / limit) * 100;
	if (percentage >= 90) return '🔴';
	if (percentage >= 75) return '🟡';
	if (percentage >= 50) return '🟢';
	return '✅';
}

function formatRelativeTime(dateString: string): string {
	const date = new Date(dateString);
	const hours = date.getHours().toString().padStart(2, '0');
	const minutes = date.getMinutes().toString().padStart(2, '0');
	const seconds = date.getSeconds().toString().padStart(2, '0');
	
	return `${hours}:${minutes}:${seconds}`;
}

async function createMarkdownTooltip(lines: string[], isError: boolean = false): Promise<vscode.MarkdownString> {
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
		const token = await getValidToken(extensionContext);
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

function getStatusBarColor(percentage: number): vscode.ThemeColor {
	// Create a more granular color spectrum
	if (percentage >= 95) {
		return new vscode.ThemeColor('charts.red'); // Bright red
	} else if (percentage >= 90) {
		return new vscode.ThemeColor('errorForeground'); // Red
	} else if (percentage >= 85) {
		return new vscode.ThemeColor('testing.iconFailed'); // Dark red
	} else if (percentage >= 80) {
		return new vscode.ThemeColor('notebookStatusErrorIcon.foreground'); // Chart red
	} else if (percentage >= 75) {
		return new vscode.ThemeColor('charts.yellow'); // Warning yellow
	} else if (percentage >= 70) {
		return new vscode.ThemeColor('notebookStatusRunningIcon.foreground'); // Chart yellow
	} else if (percentage >= 65) {
		return new vscode.ThemeColor('charts.orange'); // Chart orange
	} else if (percentage >= 60) {
		return new vscode.ThemeColor('charts.blue'); // Light blue
	} else if (percentage >= 50) {
		return new vscode.ThemeColor('charts.green'); // Chart green
	} else if (percentage >= 40) {
		return new vscode.ThemeColor('testing.iconPassed'); // Success green
	} else if (percentage >= 30) {
		return new vscode.ThemeColor('terminal.ansiGreen'); // Terminal green
	} else if (percentage >= 20) {
		return new vscode.ThemeColor('symbolIcon.classForeground'); // Class blue
	} else if (percentage >= 10) {
		return new vscode.ThemeColor('debugIcon.startForeground'); // Start green
	} else {
		return new vscode.ThemeColor('foreground'); // Default color
	}
}

async function updateStats() {
	try {
		log('[Stats] Starting stats update...');
		const token = await getValidToken(extensionContext);
		
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

function getUsageEmoji(percentage: number): string {
	if (percentage >= 90) return '🔴';
	if (percentage >= 75) return '🟡';
	if (percentage >= 50) return '🟢';
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
	log('[API] Fetching Cursor stats...');
	log('[API] Token format check: ' + JSON.stringify({
		containsSeparator: token.includes('%3A%3A'),
		length: token.length
	}));

	const currentDate = new Date();
	const currentMonth = currentDate.getMonth() + 1;
	const currentYear = currentDate.getFullYear();
	const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
	const lastYear = currentMonth === 1 ? currentYear - 1 : currentYear;

	log('[API] Date calculations: ' + JSON.stringify({
		currentMonth,
		currentYear,
		lastMonth,
		lastYear
	}));

	// Extract user ID from token
	const userId = token.split('%3A%3A')[0];
	log(`[API] Extracted userId for API calls: ${userId}`);

	async function fetchMonthData(month: number, year: number): Promise<UsageItem[]> {
		log(`[API] Fetching data for ${month}/${year}`);
		try {
			const response = await axios.post('https://www.cursor.com/api/dashboard/get-monthly-invoice', {
				month,
				year,
				includeUsageEvents: false
			}, {
				headers: {
					Cookie: `WorkosCursorSessionToken=${token}`
				}
			});
			log('[API] Monthly invoice response: ' + JSON.stringify({
				status: response.status,
				hasItems: !!response.data.items,
				itemCount: response.data.items?.length
			}));

			const usageItems: UsageItem[] = [];
			if (response.data.items) {
				for (const item of response.data.items) {
					log('[API] Processing invoice item: ' + JSON.stringify({
						description: item.description,
						cents: item.cents
					}));
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
		} catch (error: any) {
			const axiosError = error as ExtendedAxiosError;
			log(`[API] Error fetching monthly data for ${month}/${year}: ${axiosError.message}`, true);
			log('[API] API error details: ' + JSON.stringify({
				status: axiosError.response?.status,
				data: axiosError.response?.data,
				message: axiosError.message
			}), true);
			throw error;
		}
	}

	log('[API] Fetching premium requests info...');
	try {
		const premiumResponse = await axios.get('https://www.cursor.com/api/usage', {
			params: { user: userId },
			headers: {
				Cookie: `WorkosCursorSessionToken=${token}`
			}
		});
		log('[API] Premium response: ' + JSON.stringify({
			status: premiumResponse.status,
			hasGPT4: !!premiumResponse.data['gpt-4'],
			numRequests: premiumResponse.data['gpt-4']?.numRequests,
			maxRequests: premiumResponse.data['gpt-4']?.maxRequestUsage
		}));

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
	} catch (error: any) {
		log('[API] Error fetching premium requests: ' + error, true);
		log('[API] API error details: ' + JSON.stringify({
			status: error.response?.status,
			data: error.response?.data,
			message: error.message
		}), true);
		throw error;
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

function getCursorDBPath(): string {
	if (process.platform === 'win32') {
		return path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
	} else if (process.platform === 'linux') {
		// Check if running in WSL
		const isWSL = process.env.WSL_DISTRO_NAME || process.env.IS_WSL;
		if (isWSL) {
			// Get Windows username from environment variable
			const windowsUsername = process.env.WIN_USER || process.env.USERNAME || '';
			if (windowsUsername) {
				return path.join('/mnt/c/Users', windowsUsername, 'AppData/Roaming/Cursor/User/globalStorage/state.vscdb');
			} else {
				return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
			}
		} else {
			return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
		}
	} else if (process.platform === 'darwin') {
		return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
	} else {
		return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
	}
}

function extractTimingInfo(value: string): TimingInfo | null {
	try {
		const parsed = JSON.parse(value) as ComposerData;
		let newestTiming: TimingInfo | null = null;

		for (const item of parsed.conversation) {
			if (item.timingInfo?.clientStartTime) {
				const timing = {
					key: '',  // Will be set later
					timestamp: item.timingInfo.clientStartTime,
					timingInfo: item.timingInfo
				};

				if (!newestTiming || timing.timestamp > newestTiming.timestamp) {
					newestTiming = timing;
				}
			}
		}

		return newestTiming;
	} catch (error) {
		log(`Error parsing composer data: ${error}`, true);
		return null;
	}
}

async function findNewestTimingInfo(): Promise<TimingInfo | null> {
	const entries = await readComposerEntries();
	let newestTiming: TimingInfo | null = null;

	for (const [key, value] of entries) {
		const timing = extractTimingInfo(value);
		if (timing) {
			timing.key = key;
			if (!newestTiming || timing.timestamp > newestTiming.timestamp) {
				newestTiming = timing;
			}
		}
	}

	return newestTiming;
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

function initializeLogging(context: vscode.ExtensionContext): void {
	try {
		outputChannel = vscode.window.createOutputChannel('Cursor Stats');
		context.subscriptions.push(outputChannel);
		log('[Initialization] Output channel created successfully');
	} catch {
		log('[Critical] Failed to create output channel', true);
		throw new Error('Failed to initialize logging system');
	}
}

async function getCurrentUsageLimit(token: string): Promise<UsageLimitResponse> {
	try {
		const response = await axios.post('https://www.cursor.com/api/dashboard/get-hard-limit', 
			{}, // empty JSON body
			{
				headers: {
					Cookie: `WorkosCursorSessionToken=${token}`
				}
			}
		);
		return response.data;
	} catch (error: any) {
		log('[API] Error fetching usage limit: ' + error.message, true);
		throw error;
	}
}

async function setUsageLimit(token: string, hardLimit: number, noUsageBasedAllowed: boolean): Promise<void> {
	try {
		await axios.post('https://www.cursor.com/api/dashboard/set-hard-limit', 
			{
				hardLimit,
				noUsageBasedAllowed
			},
			{
				headers: {
					Cookie: `WorkosCursorSessionToken=${token}`
				}
			}
		);
		log(`[API] Successfully ${noUsageBasedAllowed ? 'disabled' : 'enabled'} usage-based pricing with limit: $${hardLimit}`);
	} catch (error: any) {
		log('[API] Error setting usage limit: ' + error.message, true);
		throw error;
	}
}

async function checkUsageBasedStatus(token: string): Promise<{isEnabled: boolean, limit?: number}> {
	try {
		const response = await getCurrentUsageLimit(token);
		return {
			isEnabled: !response.noUsageBasedAllowed,
			limit: response.hardLimit
		};
	} catch (error: any) {
		log(`[API] Error checking usage-based status: ${error.message}`, true);
		// Return a default state if we can't check
		return {
			isEnabled: false
		};
	}
}
