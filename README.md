# Cursor Stats for VS Code

A Cursor extension that displays your Cursor Subscription usage statistics in the status bar. 

## Features

- Real-time display of Cursor usage statistics in the VS Code status bar
- Detailed tooltip showing:
  - Premium fast requests sent
  - Total Usage-based requests sent
  - Total Cost of Usage-based requests sent
  - Quick action buttons for common tasks
- Interactive commands:
  - Refresh Statistics
  - Open Settings
  - Usage Based Pricing Settings
- Dynamic status bar colors based on usage levels
- WSL (Windows Subsystem for Linux) support
- Easy session token management
- Graph icon indicating active statistics tracking
- Debug logging system for troubleshooting

## Current Features

- Dynamic status bar theming:
  - Color changes based on usage levels (green to red)
  - Visual indicators for quota status
- Enhanced tooltip display:
  - Centered section titles
  - Clean, organized layout
  - Combined timestamp and period information
  - Intuitive usage progress visualization
  - Interactive action buttons
- Cross-platform support:
  - Windows
  - Linux
  - WSL (Windows Subsystem for Linux)
  - macOS (coming soon)
- Debugging and Configuration:
  - Configurable logging system
  - Detailed error reporting
  - Easy troubleshooting options

## Settings

The extension provides the following settings:

- `cursorStats.enableLogging`: Enable detailed logging for debugging purposes (default: false)

## Upcoming Features

We're working on exciting new features to enhance your experience:

- Session based request tracking
- Visual analytics with graphs for historical request usage
- Project-specific request usage monitoring
- Dedicated activity bar section for enhanced statistics view
- Smart notifications system:
  - IDE alerts at 75%, 90%, and 100% usage
  - Customizable threshold alerts

## Installation

1. Install the extension from VS Code Marketplace
2. Use it happily

## Setup

1. Its Just Works

## Usage

Once configured, the extension will:
- Display a graph icon (📊) in the status bar
- Show current usage statistics
- Update statistics periodically
- Provide detailed information on hover

## Requirements

- VS Code version 1.80.0 or higher
- Active Cursor Editor account and session token
- Supported platforms:
  - Windows
  - Linux
  - WSL (Windows Subsystem for Linux)
  - macOS support coming soon

## Privacy & Security

- All data is fetched directly from Cursor's servers
- No data is shared with third parties

## Contributing

Found a bug or have a feature request? Please open an issue on our [GitHub repository](https://github.com/dwtexe/cursor-stats).

## Release Notes

### 1.0.4 (2025-02-02)
- Added WSL (Windows Subsystem for Linux) support
- Implemented dynamic status bar colors
- Enhanced tooltip formatting and layout
- Added interactive buttons for quick actions
- Implemented debug logging system
- Improved error handling and stability
- Note: macOS support is planned for the next release

### 1.0.2 (2025-02-02)
- Added click-to-settings functionality in status bar
- Enhanced tooltip UI with better formatting and icons
- Improved separator styling for better readability
- Automatic token retrieval from local database

### 1.0.1 (2025-02-02)
- Added extension icon for better visibility
- Improved tooltip formatting for clearer information display
- Enhanced list item alignment in displays

### 1.0.0 (2025-02-02)
- Initial release
- Status bar integration with usage statistics
- Tooltip with detailed information
- Secure token storage
- Real-time statistics updates

---

**Enjoy tracking your Cursor usage!**
