# Wegis Extension Installation Guide

## Requirements

- Chrome Browser (Version 88 or higher)
- Manifest V3 support

## Installation Method

### 1. Install in Developer Mode (Recommended)

1. **Open Chrome browser and go to the extension management page**

   ```
   chrome://extensions/
   ```

2. **Enable Developer Mode**

   - Toggle "Developer mode" in the top right corner.

3. **Load Extension**

   - Click "Load unpacked" button.
   - Select the root folder of this project.

4. **Verify Installation**
   - Check that "Wegis" is active in the extension list.

### 2. Icon File Preparation (Optional)

The current project includes placeholder icons. To use actual icons:

1. Replace the following files in the `icons/` folder with actual PNG images:
   - `icon16.png` (16x16 pixels)
   - `icon48.png` (48x48 pixels)
   - `icon128.png` (128x128 pixels)

## Configuration

### API Server Settings

The extension uses the following API endpoint by default:

```
https://api.bnbong.xyz/phishing-detection/analyze
```

To use a different server, modify the API endpoint in `background/service-worker.js`.

### Permission Settings

This extension requires the following permissions:

- `activeTab`: Access to current tab content
- `storage`: Settings storage
- `declarativeNetRequest`: Blocking dangerous requests using Manifest V3 API
- `<all_urls>`: Operation on all websites (host permissions)

## Troubleshooting

### When the extension fails to load

1. **Check manifest.json**

   - Verify the file is in valid JSON format
   - Ensure all required fields are included

2. **Check file structure**

   ```
   Qshing_extension/
   ├── manifest.json
   ├── background/
   │   └── service-worker.js
   ├── content/
   │   ├── content-script.js
   │   └── link-collector.js
   ├── popup/
   │   ├── popup.html
   │   ├── popup.css
   │   └── popup.js
   ├── options/
   │   ├── options.html
   │   ├── options.css
   │   └── options.js
   ├── lib/
   │   └── jsqr.min.js
   └── icons/
       ├── icon16.png
       ├── icon48.png
       └── icon128.png
   ```

3. **Check for errors in developer tools**
   - Click the "Errors" link for the extension at `chrome://extensions/`
   - Check error messages displayed in the console

### API Connection Issues

1. **Check network connection**

   - Verify the API server is online
   - Check if CORS settings are correct

2. **Check network tab in developer tools**
   - Verify API requests are being sent properly
   - Check response status codes

### When QR code scanning doesn't work

1. **Check jsQR library**
   - Verify `lib/jsqr.min.js` file was downloaded correctly
   - Try downloading again with network connection

## Usage

1. **Enable Extension**

   - Click the Wegis icon in the browser toolbar

2. **Link Inspection**

   - Links are automatically inspected when visiting web pages
   - Warning messages appear when suspicious links are found

3. **Change Settings**
   - Right-click the extension icon and select "Options"
   - Various settings can be adjusted

## Security Notes

- This extension sends webpage links to external APIs
- For privacy protection, only use trusted API servers
- If suspicious activity is detected, immediately disable the extension and contact the [developer](mailto:bbbong9@gmail.com)

## Support

If you encounter problems or have questions:

- Contact us through [GitHub Issues](https://github.com/bnbong/Qshing_extension/issues)
- When reporting bugs, please include browser version and error messages
