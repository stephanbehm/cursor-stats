import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as jwt from 'jsonwebtoken';
import { SQLiteRow, SQLiteError, TimingInfo, ComposerData } from '../interfaces/types';
import { log } from '../utils/logger';

let dbConnection: sqlite3.Database | null = null;

export function getCursorDBPath(): string {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    } else if (process.platform === 'linux') {
        const isWSL = process.env.WSL_DISTRO_NAME || process.env.IS_WSL;
        if (isWSL) {
            const windowsUsername = process.env.WIN_USER || process.env.USERNAME || '';
            if (windowsUsername) {
                return path.join('/mnt/c/Users', windowsUsername, 'AppData/Roaming/Cursor/User/globalStorage/state.vscdb');
            }
        }
        return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    } else if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    }
    return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

export async function getCursorTokenFromDB(): Promise<string | undefined> {
    return new Promise((resolve) => {
        const dbPath = getCursorDBPath();

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

export async function initializeDatabase(): Promise<void> {
    if (dbConnection) {
        return;
    }

    return new Promise((resolve) => {
        const dbPath = getCursorDBPath();
        
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

                    if (process.platform === 'darwin' && process.arch === 'arm64') {
                        log('Detected Apple Silicon, attempting to rebuild sqlite3...', true);
                        try {
                            const { execSync } = require('child_process');
                            execSync('npm rebuild sqlite3 --build-from-source --target_arch=arm64', {
                                stdio: 'inherit'
                            });
                            
                            dbConnection = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (rebuildErr) => {
                                if (rebuildErr) {
                                    log('Failed to open database after rebuild: ' + rebuildErr, true);
                                    dbConnection = null;
                                    resolve();
                                } else {
                                    log('Successfully opened database after rebuild');
                                    resolve();
                                }
                            });
                        } catch (rebuildError) {
                            log('Failed to rebuild sqlite3: ' + rebuildError, true);
                            dbConnection = null;
                            resolve();
                        }
                    } else {
                        dbConnection = null;
                        resolve();
                    }
                } else {
                    log('Database connection initialized successfully');
                    resolve();
                }
            });
        } catch (error) {
            log(`Critical error during database initialization: ${error}`, true);
            dbConnection = null;
            resolve();
        }
    });
}

export async function closeDatabase(): Promise<void> {
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

export async function readComposerEntries(): Promise<Array<[string, string]>> {
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

export function extractTimingInfo(value: string): TimingInfo | null {
    try {
        const parsed = JSON.parse(value) as ComposerData;
        let newestTiming: TimingInfo | null = null;

        for (const item of parsed.conversation) {
            if (item.timingInfo?.clientStartTime) {
                const timing = {
                    key: '',
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

export async function findNewestTimingInfo(): Promise<TimingInfo | null> {
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