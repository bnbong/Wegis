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
      loadingOverlay: document.getElementById('loadingOverlay'),

      // Feedback
      feedbackButton: document.getElementById('feedbackButton'),
      feedbackOverlay: document.getElementById('feedbackOverlay'),
      feedbackForm: document.getElementById('feedbackForm'),
      feedbackUrl: document.getElementById('feedbackUrl'),
      feedbackDetectedResult: document.getElementById('feedbackDetectedResult'),
      feedbackIsCorrect: document.getElementById('feedbackIsCorrect'),
      feedbackConfidence: document.getElementById('feedbackConfidence'),
      feedbackConfidenceValue: document.getElementById(
        'feedbackConfidenceValue'
      ),
      feedbackComment: document.getElementById('feedbackComment'),
      feedbackStatus: document.getElementById('feedbackStatus'),
      feedbackSubmitButton: document.getElementById('feedbackSubmitButton'),
      feedbackCancelButton: document.getElementById('feedbackCancelButton'),
      feedbackCloseButton: document.getElementById('feedbackCloseButton')
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

    if (this.elements.feedbackButton) {
      this.elements.feedbackButton.addEventListener('click', () => {
        this.toggleFeedbackModal(true);
      });
    }

    if (this.elements.feedbackCancelButton) {
      this.elements.feedbackCancelButton.addEventListener('click', () => {
        this.toggleFeedbackModal(false);
      });
    }

    if (this.elements.feedbackCloseButton) {
      this.elements.feedbackCloseButton.addEventListener('click', () => {
        this.toggleFeedbackModal(false);
      });
    }

    if (this.elements.feedbackForm) {
      this.elements.feedbackForm.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submitFeedbackForm();
      });
    }

    if (this.elements.feedbackConfidence) {
      this.elements.feedbackConfidence.addEventListener('input', (event) => {
        this.updateFeedbackConfidenceDisplay(event.target.value);
      });
      this.updateFeedbackConfidenceDisplay(
        this.elements.feedbackConfidence.value
      );
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
   * Toggle feedback modal visibility
   */
  toggleFeedbackModal(show) {
    const overlay = this.elements.feedbackOverlay;
    if (!overlay) {
      return;
    }

    if (show) {
      this.resetFeedbackForm();
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');

      if (this.currentTab && this.currentTab.url) {
        this.elements.feedbackUrl.value = this.currentTab.url;
      }

      setTimeout(() => {
        this.elements.feedbackComment?.focus();
      }, 50);
    } else {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      if (this.elements.feedbackSubmitButton) {
        this.elements.feedbackSubmitButton.disabled = false;
        this.elements.feedbackSubmitButton.innerHTML =
          '<span class="btn-icon">📨</span>Submit Feedback';
      }
      this.resetFeedbackForm();
    }
  }

  /**
   * Reset feedback form fields
   */
  resetFeedbackForm() {
    if (!this.elements.feedbackForm) {
      return;
    }

    this.elements.feedbackForm.reset();
    if (this.elements.feedbackIsCorrect) {
      this.elements.feedbackIsCorrect.checked = true;
    }
    if (this.elements.feedbackDetectedResult) {
      this.elements.feedbackDetectedResult.value = 'true';
    }
    if (this.elements.feedbackConfidence) {
      this.elements.feedbackConfidence.value = '0';
      this.updateFeedbackConfidenceDisplay('0');
    }
    if (this.elements.feedbackStatus) {
      this.elements.feedbackStatus.textContent = '';
      this.elements.feedbackStatus.className = 'feedback-status';
    }
  }

  /**
   * Update confidence display text
   */
  updateFeedbackConfidenceDisplay(value) {
    if (!this.elements.feedbackConfidenceValue) {
      return;
    }

    const numeric = Number(value);
    const clamped = Number.isFinite(numeric)
      ? Math.min(Math.max(numeric, 0), 100)
      : 0;
    this.elements.feedbackConfidenceValue.textContent = `${clamped}%`;
  }

  /**
   * Submit feedback form
   */
  async submitFeedbackForm() {
    if (
      !this.elements.feedbackUrl ||
      !this.elements.feedbackComment ||
      !this.elements.feedbackSubmitButton ||
      !this.elements.feedbackStatus
    ) {
      return;
    }

    const url = this.elements.feedbackUrl.value.trim();
    let comment = this.elements.feedbackComment.value.trim();

    if (!url) {
      this.elements.feedbackStatus.textContent = 'URL is required.';
      this.elements.feedbackStatus.className = 'feedback-status error';
      return;
    }

    if (!comment) {
      this.elements.feedbackStatus.textContent = 'Comment is required.';
      this.elements.feedbackStatus.className = 'feedback-status error';
      return;
    }

    const detectedResult =
      this.elements.feedbackDetectedResult?.value === 'true';
    const isCorrect = this.elements.feedbackIsCorrect?.checked ?? true;
    const confidencePercent =
      Number(this.elements.feedbackConfidence?.value) || 0;
    const confidence = Math.min(Math.max(confidencePercent, 0), 100) / 100;

    const originalComment = comment;

    this.elements.feedbackSubmitButton.disabled = true;
    this.elements.feedbackSubmitButton.innerHTML =
      '<span class="btn-icon">⏳</span>Submitting...';
    this.elements.feedbackStatus.textContent =
      'Proofreading your comment locally...';
    this.elements.feedbackStatus.className = 'feedback-status info';

    const proofreadResult = await this.proofreadComment(comment);
    comment = proofreadResult.corrected;

    if (proofreadResult.changed) {
      this.elements.feedbackComment.value = comment;
      this.elements.feedbackStatus.textContent =
        'Comment corrected. Submitting feedback...';
    } else {
      this.elements.feedbackStatus.textContent =
        'No corrections needed. Submitting feedback...';
    }

    const metadata = {
      source: 'popup',
      locale: navigator.language || 'en',
      proofreadApplied: proofreadResult.changed
    };

    if (proofreadResult.changed) {
      metadata.originalComment = originalComment;
    }

    const manifest = chrome.runtime.getManifest?.();
    if (manifest && manifest.version) {
      metadata.extensionVersion = manifest.version;
    }

    try {
      const response = await this.sendRuntimeMessage({
        action: 'SUBMIT_FEEDBACK',
        payload: {
          url,
          is_correct: isCorrect,
          comment,
          detected_result: detectedResult,
          confidence,
          metadata
        }
      });

      if (response && !response.error) {
        this.elements.feedbackStatus.textContent =
          response.message || 'Feedback submitted. Thank you!';
        this.elements.feedbackStatus.className = 'feedback-status success';
        setTimeout(() => {
          this.toggleFeedbackModal(false);
        }, 1500);
      } else {
        this.elements.feedbackStatus.textContent =
          (response && response.error) || 'Failed to submit feedback.';
        this.elements.feedbackStatus.className = 'feedback-status error';
      }
    } catch (error) {
      this.elements.feedbackStatus.textContent =
        error.message || 'Failed to submit feedback.';
      this.elements.feedbackStatus.className = 'feedback-status error';
    } finally {
      this.elements.feedbackSubmitButton.disabled = false;
      this.elements.feedbackSubmitButton.innerHTML =
        '<span class="btn-icon">📨</span>Submit Feedback';
    }
  }

  /**
   * Proofread comment using Chrome built-in Proofreader API
   */
  async proofreadComment(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return { corrected: '', changed: false };
    }

    const aiNamespace =
      (window.ai && window.ai.languageModel) ||
      (window.chrome && window.chrome.ai && window.chrome.ai.languageModel);

    if (!aiNamespace || typeof aiNamespace.create !== 'function') {
      return { corrected: trimmed, changed: false };
    }

    try {
      const session = await aiNamespace.create({ task: 'proofreader' });

      let correctedText = trimmed;

      if (session && typeof session.proofread === 'function') {
        const result = await session.proofread({ text: trimmed });
        if (typeof result === 'string') {
          correctedText = result;
        } else if (result && typeof result === 'object') {
          if (typeof result.text === 'string' && result.text.trim()) {
            correctedText = result.text;
          } else if (
            typeof result.correctedText === 'string' &&
            result.correctedText.trim()
          ) {
            correctedText = result.correctedText;
          } else if (Array.isArray(result.corrections)) {
            const lastCorrection = result.corrections
              .map((item) => {
                if (typeof item === 'string') {
                  return item;
                }
                if (item && typeof item.text === 'string') {
                  return item.text;
                }
                return null;
              })
              .filter(Boolean)
              .pop();
            if (lastCorrection) {
              correctedText = lastCorrection;
            }
          }
        }
      } else if (session && typeof session.generate === 'function') {
        const prompt =
          'You are a grammar correction tool. Return only the corrected version of the following text.\n\n' +
          trimmed;
        const generateResult = await session.generate({ prompt });
        if (generateResult && typeof generateResult.output === 'string') {
          correctedText = generateResult.output.trim();
        }
      }

      if (typeof session?.destroy === 'function') {
        session.destroy();
      }

      correctedText = correctedText || trimmed;
      const changed = correctedText.trim() !== trimmed;
      return { corrected: correctedText, changed };
    } catch (error) {
      console.warn('Proofreader API unavailable:', error);
      return { corrected: trimmed, changed: false };
    }
  }

  /**
   * Helper: promisified runtime message
   */
  async sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
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
