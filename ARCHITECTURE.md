# Wegis - Architecture & Logic Structure

## System Overview

Wegis is a Chrome browser extension that provides real-time protection against phishing attacks by analyzing all links on web pages. The extension uses a multi-layered architecture with content scripts, background services, and API integration.

## Core Components

### 1. Content Scripts (`content/`)

#### Link Collector (`link-collector.js`)

- **Purpose**: Collects clickable/scannable links from web pages
- **Functions**:
  - URL pattern matching from text content
  - Hyperlink extraction from `<a>` tags
  - QR code detection + decoding (jsQR, with a cross-origin service-worker fallback)
  - Dynamic content monitoring via Mutation Observer

#### Content Script (`content-script.js`)

- **Purpose**: Main orchestrator for content-side operations
- **Functions**:
  - Initializes link collection on page load
  - Communicates with background service worker
  - Handles phishing link marking and warning display
  - Manages click event blocking for dangerous links
  - Shows download warnings for high-risk files

### 2. Background Service (`background/service-worker.js`)

#### Core Responsibilities

- **API Communication**: Manages all communication with Qshing Detection API
- **Caching System**: Implements intelligent caching to reduce API calls
- **Request Blocking**: Intercepts and blocks requests to known phishing sites
- **Statistics Tracking**: Maintains counters for blocked sites and checked URLs
- **Message Handling**: Processes messages from content scripts and popup

#### API Integration Flow

1. Receives URL list from content script
2. Checks local cache for previous results
3. Sends uncached URLs to Qshing API in batches
4. Processes API responses and updates cache
5. Returns results to content script
6. Updates extension statistics

### 3. User Interface

#### Popup Interface (`popup/`)

- **popup.html**: Clean, modern UI with status indicators
- **popup.js**: Handles user interactions and displays statistics
- **popup.css**: Responsive design with visual status indicators
- **Features**:
  - Real-time protection toggle
  - Current page link count
  - Protection statistics display
  - Quick settings access

#### Options Page (`options/`)

- **options.html**: Comprehensive settings interface
- **options.js**: Advanced configuration management
- **options.css**: Professional settings page styling
- **Features**:
  - Advanced protection settings
  - Whitelist management
  - Cache and data management
  - Settings import/export
  - Usage statistics

## Data Flow Architecture

### 1. Link Discovery Phase

```
User visits webpage → Content Script loads → Link Collector scans page
```

### 2. Analysis Phase

```
Links collected → Sent to Background Service → Cache check → API call (if needed)
```

### 3. Protection Phase

```
API response → Background processes result → Content Script receives verdict → UI updates
```

### 4. User Interaction Phase

```
User clicks link → Event intercepted → Safety check → Allow/Block decision
```

## Real-time Monitoring System

### Mutation Observer Implementation

- Monitors DOM changes for dynamically loaded content
- Debounced link re-scanning to prevent performance issues
- Intelligent filtering to only scan relevant changes
- Automatic re-protection of new content

### Event Handling

- Click event interception with highest priority
- Download link special handling
- QR code continuous monitoring
- Form submission protection (future enhancement)

## Security Architecture

### Content Security Policy (CSP)

- Strict script execution policies
- No eval() or inline scripts
- Controlled external resource loading

### Permission Model

- **activeTab**: Access current tab content only
- **storage**: Local settings and cache storage
- **declarativeNetRequest**: Malicious request blocking using Manifest V3 API
- **<all_urls>**: Universal protection coverage (host permissions)

### Data Protection

- No sensitive user data collection
- URL anonymization in logs
- Secure API communication (HTTPS only)
- Local cache encryption (future enhancement)

## API Integration Strategy

### Wegis Server API

```
Base: https://api.bnbong.com/api/v1/wegis-server/
Analyze (single): POST /analyze/check
Analyze (batch):  POST /analyze/batch
Recent:           GET  /analyze/recent
Health:           GET  /health
Feedback:         POST /feedback/*
Rate Limiting: Built-in delay and batch processing
Fallback: Local cache and manual overrides
```

### Batch Processing Logic

1. Collect URLs in batches of 5-10
2. Check each URL against local cache
3. Send uncached URLs to API simultaneously
4. Process responses with error handling
5. Update cache with TTL (Time To Live)

### Error Handling

- Network failure graceful degradation
- API timeout handling
- Invalid response recovery
- User notification for critical errors

## Performance Optimizations

### Caching Strategy

- **Memory Cache**: Fast access for recent checks (1 hour TTL)
- **Persistent Storage**: Long-term cache for known safe/unsafe sites
- **Cache Invalidation**: Automatic cleanup of expired entries
- **Memory Management**: Prevents excessive memory usage

### Batch Processing

- Groups API requests to reduce server load
- Intelligent scheduling to avoid rate limits
- Progressive loading for large link sets
- Background processing to avoid UI blocking

### Resource Optimization

- Lazy loading of QR code detection
- Efficient DOM scanning algorithms
- Minimal memory footprint
- CPU usage monitoring and throttling

## Testing

See [tests/README.md](tests/README.md) for the automated unit tests
(`npm test`) covering the shared verdict/risk logic, and the manual browser
fixtures for the DOM/QR/download behavior.
