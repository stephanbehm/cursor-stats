import * as path from 'path';
import * as os from 'os';
import * as jwt from 'jsonwebtoken';
import * as vscode from 'vscode';
import { Database } from 'node-sqlite3-wasm';
import { log } from '../utils/logger';
import { execSync } from 'child_process';

// use globalStorageUri to get the user directory path
// support Portable mode : https://code.visualstudio.com/docs/editor/portable
function getDefaultUserDirPath(): string {
    // Import getExtensionContext here to avoid circular dependency
    const { getExtensionContext } = require('../extension');
    const context = getExtensionContext();
    const extensionGlobalStoragePath = context.globalStorageUri.fsPath;
    const userDirPath = path.dirname(path.dirname(path.dirname(extensionGlobalStoragePath)));
    log(`[Database] Default user directory path: ${userDirPath}`);
    return userDirPath;
}

export function getCursorDBPath(): string {
    // Check for custom path in settings
    const config = vscode.workspace.getConfiguration('cursorStats');
    const customPath = config.get<string>('customDatabasePath');
    const userDirPath = getDefaultUserDirPath();
    
    if (customPath && customPath.trim() !== '') {
        log(`[Database] Using custom path: ${customPath}`);
        return customPath;
    }
    const folderName = vscode.env.appName;

    if (process.platform === 'win32') {
        return path.join(userDirPath, 'User', 'globalStorage', 'state.vscdb');
    } else if (process.platform === 'linux') {
        const isWSL = vscode.env.remoteName === 'wsl';
        if (isWSL) {
            const windowsUsername = getWindowsUsername();
            if (windowsUsername) {
                return path.join('/mnt/c/Users', windowsUsername, 'AppData/Roaming', folderName, 'User/globalStorage/state.vscdb');
            }
        }
        return path.join(userDirPath, 'User', 'globalStorage', 'state.vscdb');
    } else if (process.platform === 'darwin') {
        return path.join(userDirPath, 'User', 'globalStorage', 'state.vscdb');
    }
    return path.join(userDirPath, 'User', 'globalStorage', 'state.vscdb');
}

export async function getCursorTokenFromDB(): Promise<string | undefined> {
    let db: Database | undefined = undefined;
    try {
        const dbPath = getCursorDBPath();
        log(`[Database] Attempting to open database at: ${dbPath}`);

        db = new Database(dbPath, { readOnly: true });
        const row = db.get("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'");
        
        if (!row || !row.value) {
            log('[Database] No token found in database');
            return undefined;
        }

        const token = row.value as string;
        log(`[Database] Token starts with: ${token.substring(0, 20)}...`);

        try {
            const decoded = jwt.decode(token, { complete: true });

            if (!decoded || typeof decoded !== 'object' || !decoded.payload || typeof decoded.payload !== 'object' || !decoded.payload.sub) {
                log('[Database] Invalid JWT structure: ' + JSON.stringify({ decoded }), true);
                return undefined;
            }

            const sub = decoded.payload.sub.toString();
            const userId = sub.split('|')[1];
            const sessionToken = `${userId}%3A%3A${token}`;
            return sessionToken;
        } catch (error: any) {
            log('[Database] Error processing token: ' + error, true);
            log('[Database] Error details: ' + JSON.stringify({
                name: error.name,
                message: error.message,
                stack: error.stack
            }), true);
            return undefined;
        }
    } catch (error: any) {
        log('[Database] Error with database operation: ' + error, true);
        log('[Database] Database error details: ' + JSON.stringify({
            message: error.message,
            stack: error.stack
        }), true);
        return undefined;
    } finally {
        if (db && db.isOpen) {
            db.close();
        }
    }
}
export function getWindowsUsername(): string | undefined {
    try {
      // Executes cmd.exe and echoes the %USERNAME% variable
      const result = execSync('cmd.exe /C "echo %USERNAME%"', { encoding: 'utf8' });
      const username = result.trim();
      return username || undefined;
    } catch (error) {
      console.error('Error getting Windows username:', error);
      return undefined;
    }
  }
