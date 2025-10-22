# Changelog

## v1.0.0 (2025-09-13)

### Features

- Link collection: URLs, hyperlinks, download links (e.g., PDF), social card links, QR codes in images/canvas
- Background analysis: routes requests through service worker to avoid CORS, with intelligent caching
- Request blocking: Manifest V3 `declarativeNetRequest` dynamic rules
- UI: popup with protection status, stats, and quick settings; options page for advanced configuration
- Download protection: warning modal before risky file downloads
- Dynamic pages: `MutationObserver` for continuous protection on changing DOM
