# Cursor Stats Extension

A VS Code extension that provides real-time statistics about your Cursor usage, including premium requests and usage-based pricing information.

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
│   │   └── statusBar.ts # Status bar UI management
│   ├── utils/          # Utility functions
│   │   └── logger.ts   # Logging functionality
│   └── extension.ts    # Main extension file
```

### Components

1. **interfaces/types.ts**
   - Contains all TypeScript interfaces used throughout the extension
   - Ensures type safety and better code organization

2. **services/**
   - **api.ts**: Handles all communication with Cursor's API endpoints
   - **database.ts**: Manages SQLite database operations for token and usage data
   - **github.ts**: Handles GitHub release checking and updates

3. **handlers/**
   - **statusBar.ts**: Manages the VS Code status bar item and its UI

4. **utils/**
   - **logger.ts**: Provides logging functionality with different levels and channels

5. **extension.ts**
   - Main extension file that ties everything together
   - Handles extension activation/deactivation
   - Manages command registration and lifecycle

## Features

- Real-time monitoring of Cursor usage
- Premium request tracking
- Usage-based pricing information
- GitHub release updates
- Customizable status bar display
- Detailed tooltips with usage statistics
- Command palette integration

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

## License

MIT
