import { execSync } from 'child_process';
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