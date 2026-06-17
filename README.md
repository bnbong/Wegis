<p align="center">
    <img align="top" width="50%" src="icons/wegis_logo_general.png" alt="Wegis"/>
</p>
<p align="center">
<em><b>Wegis:</b> Guarding Every Link, Every Time</em>
</p>
<div align="center">

[![Release](https://img.shields.io/github/v/release/bnbong/Wegis?display_name=tag)](https://github.com/bnbong/Wegis/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/bnbong/Wegis/blob/main/LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)](#)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](#)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)](#)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](#)

</div>

---

A Chrome extension that detects and blocks phishing, QR phishing, shortened links, and risky downloads in real time while you browse.

As of **2.0**, Wegis doesn't just warn — it **erases** dangerous links right on
the page you're looking at. Risky links are scribbled out with animated crayon
strokes (and QR codes are crossed out with a "Blocked by Wegis" overlay), so the
threat is unmistakable at a glance. The crayon is a pure visual layer on top of
the existing security engine: click/keyboard blocking, href neutralization,
original + final URL blocking rules, and QR/download protection are unchanged.

## Key Features

- **Crayon erase**: dangerous links are visually scribbled out on the page,
  QR codes are crossed out — color/stroke varies per link, respects
  `prefers-reduced-motion`
- Blocking dangerous link access with warning notifications
- QR phishing, shortened link, and redirected URL protection
- Risky download checks with browser notifications
- Real-time link phishing site monitoring for dynamically changing pages

## Technology Stack

- **Manifest Version**: 3
- **Languages**: JavaScript (ES2022), HTML5, CSS3
- **API**: [Wegis Server API](https://github.com/bnbong/Wegis_server)
- **AI**: **mobileBERT + CNN multimodal model** for phishing detection
- **Permissions**: activeTab, declarativeNetRequest, storage, downloads,
  notifications, host permissions
- **External Libraries**: jsQR (QR code decoding)

## Quick Start

### Official Installation

official download link will be provided later.

### Manual Installation

1. Download this repository from GitHub with **Code > Download ZIP**, or clone
   it with Git.
2. If you downloaded a ZIP file, unzip it.
3. Open Chrome and go to `chrome://extensions/`.
4. Enable **Developer mode** in the top-right corner.
5. Click **Load unpacked** and select the project root folder that contains
   `manifest.json`.
6. Confirm that **Wegis** appears in the extension list and is enabled.

## Usage

- Wegis automatically scans links, QR codes, shortened links, and risky
  downloads while you browse.
- Click the Wegis toolbar icon to view status and quick settings.
- Open the extension options page to adjust protection, warnings, QR scanning,
  download checks, cache time, API delay, and the whitelist.

## Contributing

Development setup and project checks are documented in
[CONTRIBUTING.md](CONTRIBUTING.md).
