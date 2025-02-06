# Change Log

All notable changes to the "cursor-stats" extension will be documented in this file.

## Upcoming Features

### Planned

- Session based request tracking
- Visual analytics with graphs for historical request usage
- Project-specific request usage monitoring
- Dedicated activity bar section for enhanced statistics view
- Customization features:
  - Configurable quota display options
  - Hide/show specific model statistics
  - Customizable status bar information

## [1.0.5-beta.15] - 2025-02-6

### Added

- Configurable refresh interval setting (minimum 5 seconds)
- SQL.js database support for improved cross-platform compatibility
- New database error handling and logging mechanisms

### Changed

- Replaced SQLite3 with SQL.js to eliminate native dependencies
- Complete database handling refactor for better reliability
- Updated package dependencies and lockfile
- Improved installation process by removing postinstall script

### Removed

- SQLite3 native dependency and related build scripts
- Database connection pooling and monitoring logic
- Unused dependencies and development files

### Fixed

- Potential installation issues on ARM architectures
- Database file path resolution logic
- Memory leaks in database handling
- Error handling during token retrieval

## [1.0.5-beta.3] - 2024-02-14

### Added

- Support for new startOfMonth field in API response
- Smart notification system with configurable thresholds
- Optional status bar colors with configuration
- Support for Cursor nightly version database paths
- Enhanced tooltip with compact and modern layout
- Improved settings accessibility features

### Changed

- Improved handling of usage-based pricing billing cycle (3rd/4th day)
- Enhanced error handling and API response processing
- Better startup behavior for notifications and status bar
- Refined settings navigation and accessibility
- Updated tooltip design with better organization

### Fixed

- Startup notification and status bar visibility issues
- Double notifications on startup
- Settings button functionality when no file is open
- Status bar visibility during notifications

### Known Issues

- macOS support is currently not available (still working on it)

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
