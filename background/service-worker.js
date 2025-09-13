/**
 * Wegis Background Service Worker
 * Handles background logic for the extension
 */

class QshingBackgroundService {
  constructor() {
    this.cache = new Map();
    this.stats = {
      blockedSites: 0,
      checkedUrls: 0,
      lastUpdate: Date.now()
    };

    this.init();
  }

  /**
   * Initialize service
   */
  init() {
    console.log('Wegis Background Service started');

    // Extension installation handler
    chrome.runtime.onInstalled.addListener((details) => {
      this.onInstalled(details);
    });

    // Setup message listener
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Return true for async response
    });

    // Setup web request blocking
    this.setupWebRequestBlocking();

    // Initialize blocking rules from stored blocklist
    this.initializeBlockingRules();

    // Setup periodic cache cleaning
    this.setupCacheCleaning();
  }

  /**
   * Handle extension installation
   */
  async onInstalled(details) {
    if (details.reason === 'install') {
      console.log('Wegis has been installed.');

      // Save default settings
      await chrome.storage.sync.set({
        qshingEnabled: true,
        blockPhishing: true,
        showWarnings: true,
        checkDownloads: true
      });

      // Open welcome page (optional)
      // chrome.tabs.create({ url: 'options/options.html' });
    } else if (details.reason === 'update') {
      console.log('Wegis has been updated.');
    }
  }

  /**
   * Handle messages
   */
  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'CHECK_URL': {
          const result = await this.checkUrl(request.url);
          sendResponse(result);
          break;
        }

        case 'CHECK_BATCH_URLS': {
          const results = await this.checkBatchUrls(request.urls);
          sendResponse(results);
          break;
        }

        case 'GET_STATS':
          sendResponse(this.stats);
          break;

        case 'GET_CACHE_SIZE':
          sendResponse({ size: this.cache.size });
          break;

        case 'CLEAR_CACHE':
          this.cache.clear();
          sendResponse({ success: true });
          break;

        case 'BLOCK_URL':
          await this.addToBlocklist(request.url);
          sendResponse({ success: true });
          break;

        case 'UNBLOCK_URL':
          await this.removeFromBlocklist(request.url);
          sendResponse({ success: true });
          break;

        case 'GET_BLOCKED_URLS': {
          const blockedUrls = await this.getBlockedUrls();
          sendResponse(blockedUrls);
          break;
        }

        case 'TEST_API_CONNECTION': {
          const testResult = await this.testApiConnection();
          sendResponse(testResult);
          break;
        }

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error.message });
    }
  }

  /**
   * Check single URL
   */
  async checkUrl(url) {
    try {
      // Check cache
      const cached = this.cache.get(url);
      if (cached && Date.now() - cached.timestamp < 3600000) {
        return cached;
      }

      console.log(`Checking URL: ${url}`);

      // API request with enhanced error handling
      const requestBody = JSON.stringify({ url });
      console.log(
        'Sending API request to: https://api.bnbong.xyz/phishing-detection/analyze'
      );
      console.log(`Request body: ${requestBody}`);

      const response = await fetch(
        'https://api.bnbong.xyz/phishing-detection/analyze',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'Qshing-Defender-Extension/1.0.0'
          },
          body: requestBody,
          mode: 'cors',
          credentials: 'omit'
        }
      );

      console.log(`API response status: ${response.status}`);
      console.log('API response headers:', response.headers);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API error response: ${errorText}`);
        throw new Error(
          `API request failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      const result = {
        url,
        result: data.data.result,
        confidence: data.data.confidence,
        timestamp: Date.now(),
        message: data.message
      };

      // Save to cache
      this.cache.set(url, result);

      // Update statistics
      this.stats.checkedUrls++;
      if (result.result) {
        this.stats.blockedSites++;
        // Add dynamic blocking rule for phishing site
        await this.addBlockingRule(url);
      }
      this.stats.lastUpdate = Date.now();

      return result;
    } catch (error) {
      console.error(`Error checking URL (${url}):`, error);

      const errorResult = {
        url,
        result: false,
        confidence: 0,
        timestamp: Date.now(),
        error: error.message
      };

      return errorResult;
    }
  }

  /**
   * Check batch URLs
   */
  async checkBatchUrls(urls) {
    const results = [];
    const batchSize = 5; // Limit concurrent requests

    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const batchPromises = batch.map((url) => this.checkUrl(url));

      try {
        const batchResults = await Promise.allSettled(batchPromises);

        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push({
              url: batch[index],
              result: false,
              confidence: 0,
              timestamp: Date.now(),
              error: result.reason.message
            });
          }
        });

        // Delay for API rate limiting
        if (i + batchSize < urls.length) {
          await this.delay(1000);
        }
      } catch (error) {
        console.error('Error in batch URL checking:', error);
      }
    }

    return results;
  }

  /**
   * Setup declarative net request blocking
   */
  setupWebRequestBlocking() {
    console.log('Declarative net request blocking initialized');
  }

  /**
   * Initialize blocking rules from stored blocklist
   */
  async initializeBlockingRules() {
    try {
      const blockedUrls = await this.getBlockedUrls();
      for (const url of blockedUrls) {
        await this.addBlockingRule(url);
      }
      console.log(`Initialized ${blockedUrls.length} blocking rules`);
    } catch (error) {
      console.error('Error initializing blocking rules:', error);
    }
  }

  /**
   * Add dynamic blocking rule for phishing URL
   */
  async addBlockingRule(url) {
    try {
      // Get current dynamic rules
      const existingRules =
        await chrome.declarativeNetRequest.getDynamicRules();

      // Check if rule already exists
      const existingRule = existingRules.find(
        (rule) => rule.condition.urlFilter === url
      );
      if (existingRule) {
        console.log(`Blocking rule already exists for: ${url}`);
        return;
      }

      // Generate unique rule ID
      const ruleId = Date.now() + Math.floor(Math.random() * 1000);

      // Create new blocking rule
      const newRule = {
        id: ruleId,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: url,
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest']
        }
      };

      // Add the rule
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [newRule]
      });

      console.log(`Added blocking rule for: ${url}`);
    } catch (error) {
      console.error('Error adding blocking rule:', error);
    }
  }

  /**
   * Remove blocking rule for URL
   */
  async removeBlockingRule(url) {
    try {
      // Get all dynamic rules
      const rules = await chrome.declarativeNetRequest.getDynamicRules();

      // Find rule with matching URL
      const ruleToRemove = rules.find(
        (rule) => rule.condition.urlFilter === url
      );

      if (ruleToRemove) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [ruleToRemove.id]
        });
        console.log(`Removed blocking rule for: ${url}`);
      }
    } catch (error) {
      console.error('Error removing blocking rule:', error);
    }
  }

  /**
   * Add URL to blocklist
   */
  async addToBlocklist(url) {
    try {
      const result = await chrome.storage.local.get(['blockedUrls']);
      const blockedUrls = result.blockedUrls || [];

      if (!blockedUrls.includes(url)) {
        blockedUrls.push(url);
        await chrome.storage.local.set({ blockedUrls });
        // Add dynamic blocking rule
        await this.addBlockingRule(url);
        console.log(`URL added to blocklist: ${url}`);
      }
    } catch (error) {
      console.error('Error adding to blocklist:', error);
      throw error;
    }
  }

  /**
   * Remove URL from blocklist
   */
  async removeFromBlocklist(url) {
    try {
      const result = await chrome.storage.local.get(['blockedUrls']);
      const blockedUrls = result.blockedUrls || [];

      const filteredUrls = blockedUrls.filter(
        (blockedUrl) => blockedUrl !== url
      );
      await chrome.storage.local.set({ blockedUrls: filteredUrls });
      // Remove dynamic blocking rule
      await this.removeBlockingRule(url);
      console.log(`URL removed from blocklist: ${url}`);
    } catch (error) {
      console.error('Error removing from blocklist:', error);
      throw error;
    }
  }

  /**
   * Get blocked URLs list
   */
  async getBlockedUrls() {
    try {
      const result = await chrome.storage.local.get(['blockedUrls']);
      return result.blockedUrls || [];
    } catch (error) {
      console.error('Error getting blocklist:', error);
      return [];
    }
  }

  /**
   * Setup cache cleaning
   */
  setupCacheCleaning() {
    // Clean old cache entries every hour
    setInterval(() => {
      const now = Date.now();
      const maxAge = 3600000; // 1 hour

      for (const [url, data] of this.cache.entries()) {
        if (now - data.timestamp > maxAge) {
          this.cache.delete(url);
        }
      }

      console.log(
        `Cache cleaning completed. Current cache size: ${this.cache.size}`
      );
    }, 3600000);
  }

  /**
   * Test API connection
   */
  async testApiConnection() {
    try {
      console.log('Testing API connection...');

      const testUrl = 'https://example.com';
      const requestBody = JSON.stringify({ url: testUrl });

      console.log(`Test request body: ${requestBody}`);

      const response = await fetch(
        'https://api.bnbong.xyz/phishing-detection/analyze',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'Qshing-Defender-Extension/1.0.0'
          },
          body: requestBody,
          mode: 'cors',
          credentials: 'omit'
        }
      );

      console.log(`Test API response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Test API error: ${errorText}`);
        return {
          success: false,
          error: `API returned ${response.status}: ${errorText}`,
          status: response.status
        };
      }

      const data = await response.json();
      console.log('Test API response data:', data);

      return {
        success: true,
        data,
        message: 'API connection successful'
      };
    } catch (error) {
      console.error('Test API connection failed:', error);
      return {
        success: false,
        error: error.message,
        type: error.name
      };
    }
  }

  /**
   * Delay function
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Start background service
new QshingBackgroundService();
