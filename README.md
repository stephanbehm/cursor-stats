# Cursor Stats for VS Code

A Cursor extension that displays your Cursor Subscription usage statistics in the status bar. 

## Features

- Real-time display of Cursor usage statistics in the VS Code status bar
- Detailed tooltip showing:
  - Premium fast requests sent
  - Total Usage-based requests sent
  - Total Cost of Usage-based requests sent
- Easy session token management
- Graph icon indicating active statistics tracking

## Upcoming Features

We're working on exciting new features to enhance your experience:

- Session based request tracking
- Visual analytics with graphs for historical request usage
- Project-specific request usage monitoring
- Dedicated activity bar section for enhanced statistics view

## Installation

1. Install the extension from VS Code Marketplace
2. Get your Cursor session token (see Setup section below)
3. Enter your session token when prompted by the extension

## Setup

1. After installation, the extension will prompt you for your Cursor session token
2. To get your session token:
   - Visit [Cursor Settings](https://www.cursor.com/settings)
   - Open your browser's Developer Tools (F12 or right-click -> Inspect)
   - Go to the "Application" or "Storage" tab (in Chrome/Firefox)
   - Look for "Cookies" in the left sidebar
   - Find the cookie named "WorkosCursorSessionToken".
   - Copy the cookie value - this is your session token
3. The token will be securely stored and used to fetch your usage statistics

## Usage

Once configured, the extension will:
- Display a graph icon (📊) in the status bar
- Show current usage statistics
- Update statistics periodically
- Provide detailed information on hover

## Requirements

- VS Code version 1.80.0 or higher
- Active Cursor Editor account and session token

## Privacy & Security

- Your session token is stored securely in VS Code's secret storage
- All data is fetched directly from Cursor's servers
- No data is shared with third parties

## Contributing

Found a bug or have a feature request? Please open an issue on our [GitHub repository](https://github.com/dwtexe/cursor-stats).

## Release Notes

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
