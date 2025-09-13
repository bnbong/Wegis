/**
 * Wegis Options Page JavaScript
 * Extension settings page logic
 */

class QshingOptions {
  constructor() {
    this.elements = {};
    this.settings = {};
    this.whitelist = [];

    this.init();
  }

  /**
   * Initialize
   */
  async init() {
    console.log('Wegis Options initialized');

    // Initialize DOM elements
    this.initElements();

    // Setup event listeners
    this.setupEventListeners();

    // Load settings
    await this.loadSettings();

    // Load statistics
    await this.loadStats();

    // Load whitelist
    await this.loadWhitelist();

    // Update UI
    this.updateUI();
  }

  /**
   * Initialize DOM elements
   */
  initElements() {
    this.elements = {
      // General settings
      qshingEnabled: document.getElementById('qshingEnabled'),
      blockPhishing: document.getElementById('blockPhishing'),
      showWarnings: document.getElementById('showWarnings'),
      checkDownloads: document.getElementById('checkDownloads'),

      // Advanced settings
      scanQRCodes: document.getElementById('scanQRCodes'),
      cacheTime: document.getElementById('cacheTime'),
      apiDelay: document.getElementById('apiDelay'),

      // Whitelist
      whitelistDomain: document.getElementById('whitelistDomain'),
      addWhitelist: document.getElementById('addWhitelist'),
      whitelistList: document.getElementById('whitelistList'),

      // Statistics
      totalChecked: document.getElementById('totalChecked'),
      totalBlocked: document.getElementById('totalBlocked'),
      cacheSize: document.getElementById('cacheSize'),
      successRate: document.getElementById('successRate'),

      // Data management
      clearCache: document.getElementById('clearCache'),
      exportSettings: document.getElementById('exportSettings'),
      importSettings: document.getElementById('importSettings'),
      resetSettings: document.getElementById('resetSettings'),

      // Others
      saveIndicator: document.getElementById('saveIndicator'),
      fileInput: document.getElementById('fileInput')
    };
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Settings checkboxes/selects
    const settingElements = [
      'qshingEnabled',
      'blockPhishing',
      'showWarnings',
      'checkDownloads',
      'scanQRCodes',
      'cacheTime',
      'apiDelay'
    ];

    settingElements.forEach((elementId) => {
      const element = this.elements[elementId];
      if (element) {
        element.addEventListener('change', (e) => {
          this.updateSetting(
            elementId,
            e.target.type === 'checkbox' ? e.target.checked : e.target.value
          );
        });
      }
    });

    // Whitelist related
    this.elements.addWhitelist.addEventListener('click', () => {
      this.addToWhitelist();
    });

    this.elements.whitelistDomain.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.addToWhitelist();
      }
    });

    // Data management
    this.elements.clearCache.addEventListener('click', () => {
      this.clearCache();
    });

    this.elements.exportSettings.addEventListener('click', () => {
      this.exportSettings();
    });

    this.elements.importSettings.addEventListener('click', () => {
      this.elements.fileInput.click();
    });

    this.elements.fileInput.addEventListener('change', (e) => {
      this.importSettings(e.target.files[0]);
    });

    this.elements.resetSettings.addEventListener('click', () => {
      this.resetSettings();
    });
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
        'checkDownloads',
        'scanQRCodes',
        'cacheTime',
        'apiDelay'
      ]);

      this.settings = {
        qshingEnabled: settings.qshingEnabled !== false,
        blockPhishing: settings.blockPhishing !== false,
        showWarnings: settings.showWarnings !== false,
        checkDownloads: settings.checkDownloads !== false,
        scanQRCodes: settings.scanQRCodes !== false,
        cacheTime: settings.cacheTime || '3600',
        apiDelay: settings.apiDelay || '1000'
      };

      console.log('Settings loaded:', this.settings);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  /**
   * Load statistics
   */
  async loadStats() {
    try {
      // Get statistics from background script
      const stats = await chrome.runtime.sendMessage({ action: 'GET_STATS' });
      const cacheInfo = await chrome.runtime.sendMessage({
        action: 'GET_CACHE_SIZE'
      });

      if (stats && !stats.error) {
        this.elements.totalChecked.textContent = this.formatNumber(
          stats.checkedUrls || 0
        );
        this.elements.totalBlocked.textContent = this.formatNumber(
          stats.blockedSites || 0
        );

        // Calculate success rate
        const successRate =
          stats.checkedUrls > 0
            ? (
                ((stats.checkedUrls - (stats.errorCount || 0)) /
                  stats.checkedUrls) *
                100
              ).toFixed(1)
            : 0;
        this.elements.successRate.textContent = successRate + '%';
      }

      if (cacheInfo && !cacheInfo.error) {
        this.elements.cacheSize.textContent = this.formatNumber(
          cacheInfo.size || 0
        );
      }
    } catch (error) {
      console.error('Failed to load statistics:', error);
    }
  }

  /**
   * Load whitelist
   */
  async loadWhitelist() {
    try {
      const result = await chrome.storage.local.get(['whitelist']);
      this.whitelist = result.whitelist || [];
      this.renderWhitelist();
    } catch (error) {
      console.error('Failed to load whitelist:', error);
    }
  }

  /**
   * Update UI
   */
  updateUI() {
    // Update checkboxes
    Object.keys(this.settings).forEach((key) => {
      const element = this.elements[key];
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = this.settings[key];
        } else {
          element.value = this.settings[key];
        }
      }
    });
  }

  /**
   * Update settings
   */
  async updateSetting(key, value) {
    try {
      this.settings[key] = value;
      await chrome.storage.sync.set({ [key]: value });

      console.log(`Settings updated: ${key} = ${value}`);
      this.showSaveIndicator();
    } catch (error) {
      console.error(`Failed to update settings (${key}):`, error);
    }
  }

  /**
   * Add domain to whitelist
   */
  async addToWhitelist() {
    const domain = this.elements.whitelistDomain.value.trim();

    if (!domain) {
      alert('Please enter a domain.');
      return;
    }

    // Domain validation
    if (!this.isValidDomain(domain)) {
      alert('Please enter a valid domain.');
      return;
    }

    // Check for duplicates
    if (this.whitelist.includes(domain)) {
      alert('This domain is already in the whitelist.');
      return;
    }

    try {
      this.whitelist.push(domain);
      await chrome.storage.local.set({ whitelist: this.whitelist });

      this.elements.whitelistDomain.value = '';
      this.renderWhitelist();
      this.showSaveIndicator();
    } catch (error) {
      console.error('Failed to add to whitelist:', error);
      alert('Failed to add to whitelist.');
    }
  }

  /**
   * Remove domain from whitelist
   */
  async removeFromWhitelist(domain) {
    try {
      this.whitelist = this.whitelist.filter((item) => item !== domain);
      await chrome.storage.local.set({ whitelist: this.whitelist });

      this.renderWhitelist();
      this.showSaveIndicator();
    } catch (error) {
      console.error('Failed to remove from whitelist:', error);
      alert('Failed to remove from whitelist.');
    }
  }

  /**
   * Render whitelist
   */
  renderWhitelist() {
    const container = this.elements.whitelistList;
    container.innerHTML = '';

    if (this.whitelist.length === 0) {
      container.innerHTML =
        '<p style="color: #666; text-align: center; padding: 20px;">Whitelist is empty.</p>';
      return;
    }

    this.whitelist.forEach((domain) => {
      const item = document.createElement('div');
      item.className = 'whitelist-item';
      item.innerHTML = `
        <span class="whitelist-domain">${domain}</span>
        <button class="remove-btn" data-domain="${domain}">Remove</button>
      `;

      // Remove button event
      item.querySelector('.remove-btn').addEventListener('click', (e) => {
        const domain = e.target.getAttribute('data-domain');
        if (confirm(`Remove "${domain}" from whitelist?`)) {
          this.removeFromWhitelist(domain);
        }
      });

      container.appendChild(item);
    });
  }

  /**
   * Clear cache
   */
  async clearCache() {
    if (!confirm('Clear cache? This action cannot be undone.')) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({ action: 'CLEAR_CACHE' });
      await this.loadStats();
      alert('Cache cleared successfully.');
    } catch (error) {
      console.error('Failed to clear cache:', error);
      alert('Failed to clear cache.');
    }
  }

  /**
   * Export settings
   */
  async exportSettings() {
    try {
      const allSettings = await chrome.storage.sync.get(null);
      const whitelist = await chrome.storage.local.get(['whitelist']);

      const exportData = {
        settings: allSettings,
        whitelist: whitelist.whitelist || [],
        exportDate: new Date().toISOString(),
        version: '1.0.0'
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `Wegis-settings-${
        new Date().toISOString().split('T')[0]
      }.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export settings:', error);
      alert('Failed to export settings.');
    }
  }

  /**
   * Import settings
   */
  async importSettings(file) {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      if (!importData.settings || !importData.version) {
        throw new Error('Invalid settings file.');
      }

      if (
        !confirm('Overwrite existing settings? This action cannot be undone.')
      ) {
        return;
      }

      // Import settings
      await chrome.storage.sync.set(importData.settings);

      // Import whitelist
      if (importData.whitelist) {
        await chrome.storage.local.set({ whitelist: importData.whitelist });
      }

      // Refresh UI
      await this.loadSettings();
      await this.loadWhitelist();
      this.updateUI();

      alert('Settings imported successfully.');
    } catch (error) {
      console.error('Failed to import settings:', error);
      alert('Failed to import settings. Please check the file.');
    }

    // Reset file input
    this.elements.fileInput.value = '';
  }

  /**
   * Reset settings
   */
  async resetSettings() {
    if (!confirm('Reset all settings? This action cannot be undone.')) {
      return;
    }

    try {
      // Reset to default settings
      const defaultSettings = {
        qshingEnabled: true,
        blockPhishing: true,
        showWarnings: true,
        checkDownloads: true,
        scanQRCodes: true,
        cacheTime: '3600',
        apiDelay: '1000'
      };

      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(defaultSettings);
      await chrome.storage.local.clear();

      // Refresh UI
      await this.loadSettings();
      await this.loadWhitelist();
      this.updateUI();

      alert('Settings have been reset.');
    } catch (error) {
      console.error('Failed to reset settings:', error);
      alert('Failed to reset settings.');
    }
  }

  /**
   * Show save indicator
   */
  showSaveIndicator() {
    this.elements.saveIndicator.style.display = 'flex';

    setTimeout(() => {
      this.elements.saveIndicator.style.display = 'none';
    }, 2000);
  }

  /**
   * Domain validation
   */
  isValidDomain(domain) {
    const domainRegex =
      /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
    return domainRegex.test(domain);
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

// Initialize options page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const options = new QshingOptions();
  window.qshingOptions = options;
});
