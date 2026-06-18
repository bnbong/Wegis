/**
 * Wegis Popup JavaScript
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
    console.log('Wegis Popup initialized');

    // DOM element references
    this.initElements();

    // Setup event listeners
    this.setupEventListeners();

    try {
      // Get current tab information
      await this.getCurrentTab();

      // Load initial data
      await this.loadInitialData();

      // Update UI
      this.updateUI();
    } finally {
      // Settings have been applied to the controls — reveal them (removes the
      // loading state that hid the toggle/status until now). Always runs so a
      // load error never leaves the popup stuck hidden.
      document.body.classList.remove('wegis-loading');
    }
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
      feedbackButton: document.getElementById('feedbackButton'),

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

    // Feedback -> open the GitHub issue tracker.
    if (this.elements.feedbackButton) {
      this.elements.feedbackButton.addEventListener('click', () => {
        chrome.tabs.create({
          url: 'https://github.com/bnbong/Wegis/issues/new'
        });
      });
    }

    // Listen for background updates
    chrome.runtime.onMessage.addListener((request) => {
      if (request && request.action === 'STATS_UPDATED') {
        const stats = request.stats || {};
        this.elements.blockedSites.textContent = stats.blockedSites || 0;
        this.elements.checkedUrls.textContent = stats.checkedUrls || 0;
      }
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
      this.elements.scanButton.innerHTML = 'Scanning...';

      // Ask the content script to re-check AND re-apply verdicts on the page
      // (the content script owns the crayon-erase / blocking UI).
      const response = await chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'RESCAN'
      });

      console.log('Page rescan completed');
      await this.loadStats();
      if (response && typeof response.links === 'number') {
        this.elements.linkCount.textContent = response.links.toString();
      }
    } catch (error) {
      console.error('Failed to scan page:', error);
    } finally {
      // Hide loading
      this.showLoading(false);
      this.elements.scanButton.disabled = false;
      this.elements.scanButton.innerHTML = 'Scan Again';
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
    } catch {
      return url.length > 30 ? url.substring(0, 27) + '...' : url;
    }
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new QshingPopup();
});
