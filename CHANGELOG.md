# Changelog

## v2.0.0 (2026-06-17)

### Breaking Changes

- Expanded the extension permissions to support Chrome download monitoring and system notifications.
- Replaced the legacy boolean-only detection result with a normalized verdict model: `safe`, `phishing`, `suspicious`, `unknown`, `unsupported_language`, and `error`.
- Removed the old settings import/export controls and redundant options-page statistics/info sections.

### Features

- Added shared core detection helpers in `lib/wegis-core.js` for verdict normalization, shortener detection, download-risk evaluation, and policy gating.
- Added redirect resolution for shortened and high-risk URLs, including analysis of the final destination and blocking for both original and resolved URLs.
- Added QR-code URL detection for images, canvases, `<picture>` sources, CSS background images, and dynamically changed image sources.
- Added service-worker QR decoding fallback for cross-origin images that cannot be decoded from a content-script canvas.
- Added QR warning overlays so risky or unverifiable QR destinations are flagged directly on the page before users scan them.
- Added Chrome downloads API protection that evaluates final download URLs, MIME types, file extensions, uppercase extensions, and deceptive double extensions.
- Added system notifications for blocked or risky downloads.
- Added live settings and whitelist integration for QR scanning, download checks, warnings, blocking behavior, cache TTL, and API delay.
- Added fail-closed handling for API, network, redirect, and unsupported-language cases in high-risk contexts.
- Added Node unit tests for the shared core logic and browser fixtures for QR, download, and unsupported-language scenarios.

### Changed

- Routed initial and dynamic page scans through batch URL checks where possible.
- Kept legacy server responses compatible while allowing newer verdict-based server responses.
- Updated feedback copy and removed the local proofreading flow from the popup.

## v1.0.0 (2025-09-13)

### Features

- Link collection: URLs, hyperlinks, download links (e.g., PDF), social card links, QR codes in images/canvas
- Background analysis: routes requests through service worker to avoid CORS, with intelligent caching
- Request blocking: Manifest V3 `declarativeNetRequest` dynamic rules
- UI: popup with protection status, stats, and quick settings; options page for advanced configuration
- Download protection: warning modal before risky file downloads
- Dynamic pages: `MutationObserver` for continuous protection on changing DOM
