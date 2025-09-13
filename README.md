<p align="center">
    <img align="top" width="30%" src="/icons/qshing_extension_icon.jpeg" alt="Wegis"/>
</p>

<div align="center">

# Wegis Browser Extension

**A Chrome browser extension that provides real-time protection against phishing sites by analyzing all links on web pages users visit.**

[![Release](https://img.shields.io/github/v/release/bnbong/Wegis?display_name=tag)](https://github.com/bnbong/Wegis/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/bnbong/Wegis/blob/main/LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)](#)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](#)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)](#)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](#)

</div>

---

## Project Overview

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
Wegis/
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
   git clone https://github.com/bnbong/Wegis.git
   cd Wegis
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

## Installation Guide

Please refer to [INSTALL.md](INSTALL.md) for detailed installation instructions.
