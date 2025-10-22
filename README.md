<p align="center">
    <img align="top" width="30%" src="/icons/qshing_extension_icon.jpeg" alt="Wegis"/>
</p>

<div align="center">

# Wegis Browser Extension

**Guarding Every Link, Every Time**

[![Release](https://img.shields.io/github/v/release/bnbong/Wegis?display_name=tag)](https://github.com/bnbong/Wegis/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/bnbong/Wegis/blob/main/LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)](#)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](#)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)](#)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](#)

---

## Project Overview

## Key Features

- Automatic collection and analysis of all links on web pages
- Real-time phishing site verification through Wegis Server API
- Blocking dangerous link access with warning notifications
- Special protection for file download links (PDF, etc.)
- Real-time link monitoring and pre-loading prevention

## Technology Stack

- **Manifest Version**: 3
- **Languages**: JavaScript (ES2022), HTML5, CSS3
- **API**: Wegis Server API
- **Permissions**: activeTab, declarativeNetRequest, storage, host permissions
- **External Libraries**: jsQR (QR code decoding)

## API Specification

### Wegis Server API

Base URL:

```
https://api.bnbong.xyz/api/v1/wegis-server/
```

Endpoints:

- POST `/analyze/check` — Single URL phishing analysis
- POST `/analyze/batch` — Multiple URL batch analysis (for browser extensions)
- GET `/analyze/recent` — Recent analysis results
- GET `/health` — Server status check
- POST `/feedback/*` — User feedback management

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
