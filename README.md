# Cursor Stats Extension

A VS Code extension that provides real-time statistics about your Cursor usage, including premium requests and usage-based pricing information.

## Features

- 🚀 Real-time monitoring of Cursor usage
- 📊 Premium request tracking with startOfMonth support
- 💰 Usage-based pricing information with billing cycle awareness
- 🔔 Smart notification system with configurable thresholds
- 🎨 Customizable status bar display with optional colors
- 📝 Detailed tooltips with usage statistics
- ⚡ Command palette integration
- 🌙 Support for both regular and nightly Cursor versions
- 🔄 GitHub release updates
- 🖥️ WSL (Windows Subsystem for Linux) support

## Installation

### VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Cursor Stats"
4. Click Install

### Manual Installation
1. Download the latest .vsix file from [Releases](https://github.com/Dwtexe/cursor-stats/releases)
2. Open VS Code
3. Press Ctrl+Shift+P
4. Type 'Install from VSIX' and select it
5. Choose the downloaded file

## Requirements
- VS Code ^1.85.0
- Windows OS (WSL supported)
- Cursor IDE installed

## Project Structure

The project is organized into the following directories:

```
cursor-stats/
├── src/
│   ├── interfaces/      # TypeScript interfaces and types
│   │   └── types.ts
│   ├── services/       # Core services for different functionalities
│   │   ├── api.ts      # API communication with Cursor servers
│   │   ├── database.ts # SQLite database operations
│   │   └── github.ts   # GitHub release checking
│   ├── handlers/       # UI and event handlers
│   │   ├── statusBar.ts # Status bar UI management
│   │   └── notifications.ts # Smart notification system
│   ├── utils/          # Utility functions
│   │   └── logger.ts   # Logging functionality
│   └── extension.ts    # Main extension file
```

## Configuration

The extension can be configured through VS Code settings:

- `cursorStats.enableLogging`: Enable detailed logging for debugging
- `cursorStats.enableStatusBarColors`: Toggle colored status bar based on usage
- `cursorStats.enableAlerts`: Enable usage alert notifications
- `cursorStats.usageAlertThresholds`: Configure percentage thresholds for alerts

## Development

1. Clone the repository
2. Run `npm install` to install dependencies
3. Open the project in VS Code
4. Press F5 to start debugging

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

If you encounter any issues or have suggestions, please:
1. Check our [Known Issues](https://github.com/Dwtexe/cursor-stats/issues)
2. Submit a new issue if needed
3. Join the discussion in existing issues

## License

MIT
