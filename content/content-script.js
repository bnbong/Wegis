/**
 * Wegis Content Script
 * Collects links from web pages and performs phishing site detection
 */

class QshingDefender {
  constructor() {
    this.linkCollector = new LinkCollector();
    this.checkedUrls = new Map(); // URL -> {result, confidence, timestamp}
    this.blockedUrls = new Set();
    this.phishingDetails = new Map();
    this.isEnabled = true;
    this.warningOverlay = null;

    this.init();
  }

  /**
   * Initialize
   */
  async init() {
    console.log('Initializing Wegis...');

    // Load saved settings
    await this.loadSettings();

    // Start link collection after page load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () =>
        this.startProtection()
      );
    } else {
      this.startProtection();
    }

    // Start dynamic link detection
    this.setupEventListeners();
  }

  /**
   * Start protection features
   */
  async startProtection() {
    if (!this.isEnabled) {
      return;
    }

    console.log('Starting phishing site protection');

    try {
      // Initial link collection
      const links = await this.linkCollector.collectAllLinks();
      console.log(`Found total of ${links.length} links.`);

      // Start link checking
      await this.checkLinks(links);

      // Start dynamic content detection
      this.linkCollector.startObserving();

      // Setup link click blocking
      this.setupLinkBlocking();
    } catch (error) {
      console.error('Error starting protection features:', error);
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Receive new link detection messages
    window.addEventListener('message', (event) => {
      if (event.data.type === 'QSHING_NEW_LINKS') {
        this.checkLinks(event.data.links);
      }
    });

    // Communication with background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch (request.action) {
        case 'GET_PAGE_LINKS':
          this.linkCollector.collectAllLinks().then((links) => {
            sendResponse({ links });
          });
          return true;

        case 'CHECK_URL':
          this.checkSingleUrl(request.url).then((result) => {
            sendResponse(result);
          });
          return true;

        case 'TOGGLE_PROTECTION':
          this.isEnabled = request.enabled;
          if (!this.isEnabled) {
            this.linkCollector.stopObserving();
            this.removeAllWarnings();
          } else {
            this.startProtection();
          }
          sendResponse({ success: true });
          break;
      }
    });
  }

  /**
   * Batch link checking
   */
  async checkLinks(urls) {
    if (!urls || urls.length === 0) {
      return;
    }

    // Exclude already checked URLs
    const uncheckedUrls = urls.filter((url) => !this.checkedUrls.has(url));

    if (uncheckedUrls.length === 0) {
      return;
    }

    console.log(`Checking ${uncheckedUrls.length} new links...`);

    // Batch processing (max 10 at a time)
    const batchSize = 10;
    for (let i = 0; i < uncheckedUrls.length; i += batchSize) {
      const batch = uncheckedUrls.slice(i, i + batchSize);
      await this.processBatch(batch);

      // Delay for API rate limiting
      if (i + batchSize < uncheckedUrls.length) {
        await this.delay(1000);
      }
    }
  }

  /**
   * Process batch
   */
  async processBatch(urls) {
    const promises = urls.map((url) => this.checkSingleUrl(url));

    try {
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Error in batch processing:', error);
    }
  }

  /**
   * Check single URL
   */
  async checkSingleUrl(url) {
    try {
      // Check cache
      const cached = this.checkedUrls.get(url);
      if (cached && Date.now() - cached.timestamp < 3600000) {
        // 1 hour cache
        return cached;
      }

      // Send request to background script (avoids CORS issues)
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'CHECK_URL', url }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response);
        });
      });

      // Cache result
      this.checkedUrls.set(url, result);

      // Handle phishing sites
      if (result.result) {
        this.blockedUrls.add(url);
        this.phishingDetails.set(url, result);
        this.markPhishingLink(url, result.confidence);
        console.warn(
          `Phishing site detected: ${url} (Confidence: ${(
            result.confidence * 100
          ).toFixed(1)}%)`
        );
      }

      return result;
    } catch (error) {
      console.error(`Error checking URL (${url}):`, error);
      return {
        result: false,
        confidence: 0,
        timestamp: Date.now(),
        url,
        error: error.message
      };
    }
  }

  /**
   * Mark phishing links
   */
  markPhishingLink(url, confidence) {
    // Find all link elements with matching URL
    const linkElements = document.querySelectorAll(`a[href*="${url}"]`);

    linkElements.forEach((element) => {
      this.addWarningToLink(element, confidence);
    });
  }

  /**
   * Add warning to link
   */
  addWarningToLink(linkElement, confidence) {
    // Skip if warning already added
    if (linkElement.classList.contains('qshing-warning')) {
      return;
    }

    // Apply warning styles
    linkElement.classList.add('qshing-warning');
    linkElement.style.cssText += `
      background-color: #ff4444 !important;
      color: white !important;
      border: 2px solid #cc0000 !important;
      padding: 2px 4px !important;
      border-radius: 3px !important;
      position: relative !important;
    `;

    // Add warning icon
    const warningIcon = document.createElement('span');
    warningIcon.innerHTML = '⚠️ Danger';
    warningIcon.style.cssText = `
      background: #cc0000;
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 5px;
    `;

    linkElement.insertBefore(warningIcon, linkElement.firstChild);

    // Add tooltip
    linkElement.title = `Phishing site suspected (Confidence: ${(
      confidence * 100
    ).toFixed(1)}%)`;
  }

  /**
   * Setup link blocking
   */
  setupLinkBlocking() {
    const handleClick = (event) => {
      const target = event.target.closest('a');
      if (!target) {
        return;
      }

      const href = target.getAttribute('href');
      if (!href) {
        return;
      }

      const normalizedUrl = this.linkCollector.normalizeURL(href);
      if (!normalizedUrl) {
        return;
      }

      if (this.blockedUrls.has(normalizedUrl)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.showBlockingWarning(normalizedUrl, target);
      }
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('auxclick', handleClick, true);

    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter') {
          return;
        }

        const activeElement = document.activeElement;
        if (!activeElement || activeElement.tagName !== 'A') {
          return;
        }

        const href = activeElement.getAttribute('href');
        if (!href) {
          return;
        }

        const normalizedUrl = this.linkCollector.normalizeURL(href);
        if (this.blockedUrls.has(normalizedUrl)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.showBlockingWarning(normalizedUrl, activeElement);
        }
      },
      true
    );

    // Special handling for download links
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target.closest(
          'a[download], a[href$=".pdf"], a[href$=".exe"], a[href$=".zip"]'
        );
        if (!target) {
          return;
        }

        const href = target.getAttribute('href');
        if (!href) {
          return;
        }

        // Additional warning for download links
        if (this.isHighRiskDownload(href)) {
          event.preventDefault();
          this.showDownloadWarning(href, target);
        }
      },
      true
    );
  }

  /**
   * Show blocking warning
   */
  showBlockingWarning(url, _linkElement) {
    const result = this.phishingDetails.get(url) || this.checkedUrls.get(url);
    const confidence = result ? result.confidence : 0;
    const message = result && result.message ? result.message : '';

    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: flex;
      justify-content: center;
      align-items: center;
    `;

    modal.innerHTML = `
      <div style="background: white; padding: 30px; border-radius: 10px; max-width: 500px; text-align: center;">
        <h2 style="color: #cc0000; margin: 0 0 20px 0;">⚠️ Blocked Dangerous Site</h2>
        <p style="margin: 10px 0;">This link is suspected to be a phishing site.</p>
        ${
          message
            ? `<p style="margin: 10px 0; font-size: 14px; color: #555;">${message}</p>`
            : ''
        }
        <p style="font-weight: bold; color: #cc0000;">Confidence: ${(
          confidence * 100
        ).toFixed(1)}%</p>
        <p style="word-break: break-all; background: #f5f5f5; padding: 10px; border-radius: 5px; font-family: monospace;">${url}</p>
        <div style="margin-top: 20px;">
          <button id="qshing-close" style="background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 5px; margin: 0 10px; cursor: pointer;">Close</button>
          <button id="qshing-proceed" style="background: #dc3545; color: white; border: none; padding: 10px 20px; border-radius: 5px; margin: 0 10px; cursor: pointer;">Continue at your own risk</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('#qshing-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelector('#qshing-proceed').addEventListener('click', () => {
      document.body.removeChild(modal);
      this.allowNavigationToUrl(url);
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  /**
   * Show download warning dialog
   */
  showDownloadWarning(url, _linkElement) {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: flex;
      justify-content: center;
      align-items: center;
    `;

    const filename = this.linkCollector.getFilenameFromURL(url);
    const extension = this.linkCollector.getFileExtension(url);

    modal.innerHTML = `
      <div style="background: white; padding: 30px; border-radius: 10px; max-width: 500px; text-align: center;">
        <h2 style="color: #ff8c00; margin: 0 0 20px 0;">📁 File Download Warning</h2>
        <p style="margin: 10px 0;">Please check the file you are about to download.</p>
        <p style="font-weight: bold;">Filename: ${filename}</p>
        <p style="font-weight: bold;">Extension: .${extension}</p>
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p style="margin: 0; color: #856404;">⚠️ PDF files may contain malicious scripts. Only download from trusted sources.</p>
        </div>
        <div style="margin-top: 20px;">
          <button id="qshing-cancel" style="background: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 5px; margin: 0 10px; cursor: pointer;">Cancel</button>
          <button id="qshing-download" style="background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 5px; margin: 0 10px; cursor: pointer;">Download</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('#qshing-cancel').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelector('#qshing-download').addEventListener('click', () => {
      document.body.removeChild(modal);
      window.open(url, '_blank');
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  /**
   * Allow navigation after user confirmation
   */
  allowNavigationToUrl(url) {
    this.blockedUrls.delete(url);
    this.phishingDetails.delete(url);
    chrome.runtime.sendMessage(
      {
        action: 'ALLOW_PHISHING_URL',
        url
      },
      () => {
        if (chrome.runtime.lastError) {
          // Ignore errors (e.g., service worker inactive)
        }
        window.open(url, '_blank', 'noopener');
      }
    );
  }

  /**
   * Identify high-risk download files
   */
  isHighRiskDownload(url) {
    const highRiskExtensions = [
      'pdf',
      'exe',
      'zip',
      'rar',
      'msi',
      'dmg',
      'pkg',
      'apk'
    ];
    const extension = this.linkCollector.getFileExtension(url);
    return highRiskExtensions.includes(extension.toLowerCase());
  }

  /**
   * Remove all warnings
   */
  removeAllWarnings() {
    const warningElements = document.querySelectorAll('.qshing-warning');
    warningElements.forEach((element) => {
      element.classList.remove('qshing-warning');
      element.style.cssText = '';

      // Remove warning icon
      const warningIcon = element.querySelector('span');
      if (warningIcon && warningIcon.innerHTML.includes('Danger')) {
        warningIcon.remove();
      }
    });
  }

  /**
   * Load settings
   */
  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['qshingEnabled']);
      this.isEnabled = result.qshingEnabled !== false; // Default true
    } catch (error) {
      console.error('Error loading settings:', error);
      this.isEnabled = true;
    }
  }

  /**
   * Delay function
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Execute on page load
new QshingDefender();
