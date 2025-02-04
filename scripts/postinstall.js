const { execSync } = require('child_process');
const os = require('os');

console.log('Running postinstall script...');

// Check if running on macOS
if (process.platform === 'darwin') {
    // Check if running on ARM64 (Apple Silicon)
    if (process.arch === 'arm64') {
        console.log('Detected Apple Silicon (ARM64) architecture');
        try {
            console.log('Rebuilding sqlite3 for ARM64...');
            execSync('npm rebuild sqlite3 --build-from-source --target_arch=arm64', {
                stdio: 'inherit'
            });
            console.log('Successfully rebuilt sqlite3 for ARM64');
        } catch (error) {
            console.error('Failed to rebuild sqlite3:', error);
            // Don't exit with error to allow installation to continue
            // The extension will handle SQLite errors gracefully
        }
    }
}

// For other platforms, no special handling needed as prebuilt binaries should work
console.log('Postinstall completed'); 