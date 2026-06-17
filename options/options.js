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
      // Protection (QR scanning is options-only; the rest live in the popup)
      scanQRCodes: document.getElementById('scanQRCodes'),

      // Whitelist
      whitelistDomain: document.getElementById('whitelistDomain'),
      addWhitelist: document.getElementById('addWhitelist'),
      whitelistList: document.getElementById('whitelistList'),

      // Data management
      clearCache: document.getElementById('clearCache'),
      resetSettings: document.getElementById('resetSettings'),

      // Others
      saveIndicator: document.getElementById('saveIndicator')
    };
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Settings toggles
    ['scanQRCodes'].forEach((elementId) => {
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

    this.elements.resetSettings.addEventListener('click', () => {
      this.resetSettings();
    });
  }

  /**
   * Load settings
   */
  async loadSettings() {
    try {
      const settings = await chrome.storage.sync.get(['scanQRCodes']);
      this.settings = {
        scanQRCodes: settings.scanQRCodes !== false
      };
    } catch (error) {
      console.error('Failed to load settings:', error);
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
      alert('Cache cleared successfully.');
    } catch (error) {
      console.error('Failed to clear cache:', error);
      alert('Failed to clear cache.');
    }
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
        scanQRCodes: true
      };

      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(defaultSettings);
      await chrome.storage.local.clear();

      // Dynamic blocking rules live in declarativeNetRequest, not storage —
      // clear them too so a reset truly removes all active blocking.
      await chrome.runtime.sendMessage({ action: 'CLEAR_BLOCKING' });

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
   * Domain validation using the native URL parser (no hand-rolled regex).
   */
  isValidDomain(domain) {
    try {
      const { hostname } = new URL(`https://${domain}`);
      // Reject inputs that carried a path/port/auth or have no dot.
      return hostname === domain.toLowerCase() && hostname.includes('.');
    } catch (_) {
      return false;
    }
  }
}

// Initialize options page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new QshingOptions();
});
