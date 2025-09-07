# Qshing Defender Browser Extension

## Project Overview

A Chrome browser extension that provides real-time protection against phishing sites by analyzing all links on web pages users visit.

## Key Features

- Automatic collection and analysis of all links on web pages
- Real-time phishing site verification through Qshing Detection Server API
- Blocking dangerous link access with warning notifications
- Special protection for file download links (PDF, etc.)
- Real-time link monitoring and pre-loading prevention

## Technology Stack

- **Manifest Version**: 3
- **Languages**: JavaScript (ES2022), HTML5, CSS3
- **API**: [Qshing Detection API](https://github.com/bnbong/Qshing_server)
- **Permissions**: activeTab, declarativeNetRequest, storage, host permissions
- **External Libraries**: jsQR (QR code decoding)

## API Specification

### Qshing Detection Server API

```
POST https://api.bnbong.xyz/phishing-detection/analyze
Content-Type: application/json

Request:
{
  "url": "string"
}

Response:
{
  "timestamp": "string",
  "message": "string",
  "data": {
    "result": true,  // Whether it's a phishing site
    "confidence": 0.0  // Phishing site probability (0.0 ~ 1.0)
  }
}
```

## Project Structure

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
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── lib/
│   └── jsqr.min.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Security Considerations

- CSP (Content Security Policy) compliance
- Principle of least privilege application
- User data protection
- API key security management
- HTTPS communication enforcement

## Development Setup

### Prerequisites

- Node.js (v18.0.0 or higher)
- npm or yarn
- Git

### Setting up the development environment

1. **Clone the repository**

   ```bash
   git clone https://github.com/bnbong/Qshing_extension.git
   cd Qshing_extension
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Install pre-commit hooks**

   ```bash
   # Install pre-commit (if not already installed)
   pip install pre-commit

   # Install the hooks
   pre-commit install
   ```

### Code Quality Tools

#### Linting and Formatting

- **ESLint**: JavaScript linting
- **Stylelint**: CSS linting
- **Prettier**: Code formatting
- **Pre-commit hooks**: Automated checks before commits

#### Available Scripts

```bash
# Lint JavaScript files
npm run lint

# Fix JavaScript linting issues
npm run lint:fix

# Lint CSS files
npm run lint:css

# Fix CSS linting issues
npm run lint:css:fix

# Format all files with Prettier
npm run format

# Check if files are properly formatted
npm run format:check

# Run all linting tools
npm run lint:all

# Fix all issues (lint + format)
npm run fix:all
```

## Installation Guide

Please refer to [INSTALL.md](INSTALL.md) for detailed installation instructions.
