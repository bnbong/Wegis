/**
 * Qshing Defender Popup JavaScript
 * Popup interface logic handling
 */

class QshingPopup {
  constructor() {
    this.elements = {};
    this.currentTab = null;

    this.init();
  }

  /**
   * Initialize
   */
  async init() {
    console.log('Qshing Defender Popup initialized');

    // DOM element references
    this.initElements();

    // Setup event listeners
    this.setupEventListeners();

    // Get current tab information
    await this.getCurrentTab();

    // Load initial data
    await this.loadInitialData();

    // Update UI
    this.updateUI();
  }

  /**
   * Initialize DOM elements
   */
  initElements() {
    this.elements = {
      // Status related
      statusIndicator: document.getElementById('statusIndicator'),
      statusText: document.getElementById('statusText'),
      mainToggle: document.getElementById('mainToggle'),

      // Statistics related
      blockedSites: document.getElementById('blockedSites'),
      checkedUrls: document.getElementById('checkedUrls'),

      // Current page related
      currentUrl: document.getElementById('currentUrl'),
      linkCount: document.getElementById('linkCount'),
      scanButton: document.getElementById('scanButton'),

      // Settings related
      blockPhishing: document.getElementById('blockPhishing'),
      showWarnings: document.getElementById('showWarnings'),
      checkDownloads: document.getElementById('checkDownloads'),

      // Button related
      optionsButton: document.getElementById('optionsButton'),
      helpButton: document.getElementById('helpButton'),

      // Loading
      loadingOverlay: document.getElementById('loadingOverlay')
    };
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Main toggle
    this.elements.mainToggle.addEventListener('change', (e) => {
      this.toggleProtection(e.target.checked);
    });

    // Scan again button
    this.elements.scanButton.addEventListener('click', () => {
      this.scanCurrentPage();
    });

    // Settings checkboxes
    this.elements.blockPhishing.addEventListener('change', (e) => {
      this.updateSetting('blockPhishing', e.target.checked);
    });

    this.elements.showWarnings.addEventListener('change', (e) => {
      this.updateSetting('showWarnings', e.target.checked);
    });

    this.elements.checkDownloads.addEventListener('change', (e) => {
      this.updateSetting('checkDownloads', e.target.checked);
    });

    // Advanced settings button
    this.elements.optionsButton.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Help button
    this.elements.helpButton.addEventListener('click', () => {
      chrome.tabs.create({
        url: 'https://github.com/bnbong/Qshing_extension/wiki'
      });
    });
  }

  /**
   * Get current tab information
   */
  async getCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      this.currentTab = tab;

      if (tab && tab.url) {
        this.elements.currentUrl.textContent = this.truncateUrl(tab.url);
      }
    } catch (error) {
      console.error('Failed to get current tab information:', error);
      this.elements.currentUrl.textContent = 'Unable to get information';
    }
  }

  /**
   * Load initial data
   */
  async loadInitialData() {
    try {
      // Load settings
      await this.loadSettings();

      // Load statistics
      await this.loadStats();

      // Load current page link count
      await this.loadPageLinkCount();
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  }

  /**
   * Load settings
   */
  async loadSettings() {
    try {
      const settings = await chrome.storage.sync.get([
        'qshingEnabled',
        'blockPhishing',
        'showWarnings',
        'checkDownloads'
      ]);

      this.elements.mainToggle.checked = settings.qshingEnabled !== false;
      this.elements.blockPhishing.checked = settings.blockPhishing !== false;
      this.elements.showWarnings.checked = settings.showWarnings !== false;
      this.elements.checkDownloads.checked = settings.checkDownloads !== false;
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  /**
   * Load statistics
   */
  async loadStats() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'GET_STATS'
      });

      if (response && !response.error) {
        this.elements.blockedSites.textContent = response.blockedSites || 0;
        this.elements.checkedUrls.textContent = response.checkedUrls || 0;
      }
    } catch (error) {
      console.error('Failed to load statistics:', error);
    }
  }

  /**
   * Load current page link count
   */
  async loadPageLinkCount() {
    if (!this.currentTab || !this.currentTab.id) {
      this.elements.linkCount.textContent = '0';
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'GET_PAGE_LINKS'
      });

      if (response && response.links) {
        this.elements.linkCount.textContent = response.links.length.toString();
      } else {
        this.elements.linkCount.textContent = '0';
      }
    } catch (error) {
      console.error('Failed to load page link count:', error);
      this.elements.linkCount.textContent = '?';
    }
  }

  /**
   * Toggle protection features
   */
  async toggleProtection(enabled) {
    try {
      // Save settings
      await chrome.storage.sync.set({ qshingEnabled: enabled });

      // Notify content script
      if (this.currentTab && this.currentTab.id) {
        chrome.tabs.sendMessage(this.currentTab.id, {
          action: 'TOGGLE_PROTECTION',
          enabled
        });
      }

      // Update UI
      this.updateProtectionStatus(enabled);
    } catch (error) {
      console.error('Failed to toggle protection features:', error);
      // Restore toggle state on failure
      this.elements.mainToggle.checked = !enabled;
    }
  }

  /**
   * Update settings
   */
  async updateSetting(settingName, value) {
    try {
      await chrome.storage.sync.set({ [settingName]: value });
      console.log(`Settings updated: ${settingName} = ${value}`);
    } catch (error) {
      console.error(`Failed to update settings (${settingName}):`, error);
    }
  }

  /**
   * Scan current page
   */
  async scanCurrentPage() {
    if (!this.currentTab || !this.currentTab.id) {
      return;
    }

    try {
      // Show loading
      this.showLoading(true);
      this.elements.scanButton.disabled = true;
      this.elements.scanButton.innerHTML =
        '<span class="scan-icon">⏳</span>Scanning...';

      // Request rescan from content script
      const response = await chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'GET_PAGE_LINKS'
      });

      if (response && response.links && response.links.length > 0) {
        // Request batch check from background script
        const checkResponse = await chrome.runtime.sendMessage({
          action: 'CHECK_BATCH_URLS',
          urls: response.links
        });

        if (checkResponse && !checkResponse.error) {
          console.log('Page rescan completed');

          // Update statistics
          await this.loadStats();

          // Update link count
          this.elements.linkCount.textContent =
            response.links.length.toString();
        }
      }
    } catch (error) {
      console.error('Failed to scan page:', error);
    } finally {
      // Hide loading
      this.showLoading(false);
      this.elements.scanButton.disabled = false;
      this.elements.scanButton.innerHTML =
        '<span class="scan-icon">🔍</span>Scan Again';
    }
  }

  /**
   * Update UI
   */
  updateUI() {
    const isEnabled = this.elements.mainToggle.checked;
    this.updateProtectionStatus(isEnabled);
  }

  /**
   * Update protection status
   */
  updateProtectionStatus(enabled) {
    if (enabled) {
      this.elements.statusIndicator.className = 'status-indicator';
      this.elements.statusText.textContent = 'Protected';
    } else {
      this.elements.statusIndicator.className = 'status-indicator warning';
      this.elements.statusText.textContent = 'Protection Disabled';
    }
  }

  /**
   * Show/hide loading
   */
  showLoading(show) {
    this.elements.loadingOverlay.style.display = show ? 'flex' : 'none';
  }

  /**
   * Truncate URL
   */
  truncateUrl(url) {
    if (!url) {
      return '';
    }

    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      if (domain.length > 30) {
        return domain.substring(0, 27) + '...';
      }

      return domain;
    } catch (error) {
      return url.length > 30 ? url.substring(0, 27) + '...' : url;
    }
  }

  /**
   * Number formatting
   */
  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const popup = new QshingPopup();
  window.qshingPopup = popup;
});

// Refresh data when popup gains focus
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // Refresh statistics when popup becomes visible again
    const popup = window.qshingPopup;
    if (popup) {
      popup.loadStats();
    }
  }
});
