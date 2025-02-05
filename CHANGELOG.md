# Change Log

All notable changes to the "cursor-stats" extension will be documented in this file.

## Upcoming Features

### Planned
- macOS support
- Session based request tracking
- Visual analytics with graphs for historical request usage
- Project-specific request usage monitoring
- Dedicated activity bar section for enhanced statistics view
- Customization features:
  - Configurable quota display options
  - Hide/show specific model statistics
  - Customizable status bar information
- Smart notification system:
  - Configurable usage threshold alerts (75%, 90%, 100%)
  - In-IDE notifications for quota management

## [1.0.4] - 2025-02-02

### Added
- WSL (Windows Subsystem for Linux) support for database path
- Dynamic status bar colors based on usage percentage
- Interactive buttons in tooltip for quick actions:
  - Refresh Statistics
  - Open Settings
  - Usage Based Pricing Settings
- Debug logging system with configuration option
- Improved tooltip formatting and alignment
  - Combined Period and Last Updated into a single line
  - Left-aligned Period and right-aligned Last Updated
  - Moved Total Cost to Current Usage line
  - Centered section titles
  - Added action buttons section
- Dynamic status bar improvements:
  - Usage-based color theming
  - Visual status indicators
  - Custom color scheme support

### Changed
- Enhanced error handling for database connections
- Improved WSL detection and path resolution
- Better visual organization of usage information
- Refined status bar color transitions based on usage levels
- Added detailed logging for debugging purposes
- Improved command handling and user interaction

### Known Issues
- macOS support is currently not available (planned for next release)

## [1.0.2] - 2025-02-02

### Added
- Click-to-settings functionality in status bar
- Automatic token retrieval from local database

### Changed
- Enhanced tooltip UI with better formatting and icons
- Improved separator styling for better readability
- Updated status bar icons for better visual consistency

## [1.0.1] - 2025-02-02

### Added
- Extension icon for better visibility in VS Code Marketplace
- Improved tooltip formatting for status bar items
- Better alignment of list items in the display

## [1.0.0] - 2025-02-02

### Added
- Initial release
- Status bar integration showing Cursor usage statistics
- Session token management
- Real-time statistics updates