/**
 * Wegis Background Service Worker
 * Handles background logic for the extension
 */

// Shared pure helpers (verdict model, shortener + download risk detection) and
// the QR decoder, both reused for cross-origin QR fallback below.
importScripts('../lib/wegis-core.js', '../lib/jsqr.min.js');

const {
  VERDICTS,
  normalizeVerdict,
  makeErrorVerdict,
  isDangerousVerdict,
  isShortenerHost,
  isHighRiskSource,
  evaluateDownloadRisk,
  shouldBlock
} = self.WegisCore;

class QshingBackgroundService {
  constructor() {
    this.cache = new Map();
    this.stats = {
      blockedSites: 0,
      checkedUrls: 0,
      errorCount: 0,
      lastUpdate: Date.now()
    };

    // Live copy of user settings, kept in sync via storage.onChanged.
    this.settings = {
      qshingEnabled: true,
      blockPhishing: true,
      showWarnings: true,
      checkDownloads: true,
      scanQRCodes: true
    };
    this.whitelist = [];
    // Optional per-client API token. The server enforces X-Wegis-Token only when
    // WEGIS_API_TOKENS is configured (off by default today, on for public
    // release). Kept in storage.local; empty means "send no header" so the path
    // is ready the moment a token is issued. See wegis-client-integration.md.
    this.apiToken = '';
    // Resolves once settings + whitelist have loaded (set in init()).
    this.settingsReady = Promise.resolve();
    // Notification rate limiting.
    this.lastNotificationAt = 0;
    this.recentNotificationKeys = new Map(); // key -> timestamp
    // Fixed tuning constants (not user-configurable).
    this.CACHE_TTL_MS = 3600 * 1000; // verdict cache lifetime
    this.API_DELAY_MS = 500; // pause between per-URL batch waves
    this.MAX_BATCH_URLS = 50; // server caps /analyze/batch at 50
    this.NOTIFICATION_MIN_INTERVAL_MS = 10000; // >=10s between notifications
    this.NOTIFICATION_DEDUPE_MS = 60000; // suppress same host/file for 60s
    // 429 back-off: skip requests until this timestamp (set from Retry-After).
    this.backoffUntil = 0;
    // Max redirect hops to follow when resolving shortened / redirected URLs.
    this.MAX_REDIRECT_HOPS = 5;

    // Wegis Server API endpoints
    this.API_BASE = 'https://api.bnbong.com/api/v1/wegis-server';
    this.ENDPOINTS = {
      analyzeCheck: `${this.API_BASE}/analyze/check`,
      analyzeBatch: `${this.API_BASE}/analyze/batch`
    };

    this.init();
  }

  /**
   * Initialize service
   */
  init() {
    console.log('Wegis Background Service started');

    // Restore cached statistics
    this.restoreStatsFromStorage();

    // Load user settings and whitelist, then keep them in sync. Until this
    // resolves the in-memory settings are just defaults, so any path that acts
    // on settings (checks, downloads, notifications) must await settingsReady
    // first to avoid acting on stale "all on" defaults.
    this.settingsReady = Promise.all([
      this.loadSettings(),
      this.loadWhitelist(),
      this.loadApiToken()
    ]);
    chrome.storage.onChanged.addListener((changes, area) => {
      this.onStorageChanged(changes, area);
    });

    // Extension installation handler
    chrome.runtime.onInstalled.addListener((details) => {
      this.onInstalled(details);
    });

    // Setup message listener
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Return true for async response
    });

    // Initialize blocking rules from stored blocklist
    this.initializeBlockingRules();

    // Monitor downloads through the Chrome downloads API
    this.setupDownloadProtection();

    // Setup periodic cache cleaning
    this.setupCacheCleaning();
  }

  /**
   * Load persisted settings into the live in-memory copy.
   */
  async loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(Object.keys(this.settings));
      this.settings = {
        qshingEnabled: stored.qshingEnabled !== false,
        blockPhishing: stored.blockPhishing !== false,
        showWarnings: stored.showWarnings !== false,
        checkDownloads: stored.checkDownloads !== false,
        scanQRCodes: stored.scanQRCodes !== false
      };
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  /**
   * Load the user whitelist (domains that bypass analysis entirely).
   */
  async loadWhitelist() {
    try {
      const { whitelist } = await chrome.storage.local.get(['whitelist']);
      this.whitelist = Array.isArray(whitelist) ? whitelist : [];
    } catch (error) {
      console.error('Failed to load whitelist:', error);
      this.whitelist = [];
    }
  }

  /**
   * Load the optional per-client API token (storage.local). Absent/empty until
   * a token is issued; until then requests go out without the header.
   */
  async loadApiToken() {
    try {
      const { apiToken } = await chrome.storage.local.get(['apiToken']);
      this.apiToken = typeof apiToken === 'string' ? apiToken.trim() : '';
    } catch (error) {
      console.error('Failed to load API token:', error);
      this.apiToken = '';
    }
  }

  /**
   * Build the headers for an /analyze/* request, attaching X-Wegis-Token only
   * when a token is configured. Centralized so check + batch stay in sync.
   */
  buildApiHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (this.apiToken) {
      headers['X-Wegis-Token'] = this.apiToken;
    }
    return headers;
  }

  /**
   * React to settings / whitelist changes without needing a worker restart.
   */
  onStorageChanged(changes, area) {
    if (area === 'sync') {
      for (const key of Object.keys(this.settings)) {
        if (changes[key]) {
          this.settings[key] = changes[key].newValue !== false;
        }
      }
      // Real-time Protection toggled: off must also tear down active blocking
      // rules (they live in declarativeNetRequest and would otherwise persist).
      if (changes.qshingEnabled) {
        if (this.settings.qshingEnabled) {
          this.initializeBlockingRules();
        } else {
          this.clearAllBlocking();
        }
      }
    }
    if (area === 'local' && changes.whitelist) {
      this.whitelist = Array.isArray(changes.whitelist.newValue)
        ? changes.whitelist.newValue
        : [];
    }
    if (area === 'local' && changes.apiToken) {
      const next = changes.apiToken.newValue;
      this.apiToken = typeof next === 'string' ? next.trim() : '';
    }
  }

  /**
   * True when the URL's host (or a parent domain) is whitelisted by the user.
   */
  isWhitelisted(url) {
    if (!this.whitelist.length) {
      return false;
    }
    const host = self.WegisCore.getHost(url);
    if (!host) {
      return false;
    }
    return this.whitelist.some((domain) => {
      const d = String(domain)
        .toLowerCase()
        .replace(/^www\./, '');
      return host === d || host.endsWith(`.${d}`);
    });
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
        checkDownloads: true,
        scanQRCodes: true
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
          const result = await this.checkUrl(request.url, {
            sourceType: request.sourceType || 'link'
          });
          sendResponse(result);
          break;
        }

        case 'CHECK_BATCH_URLS': {
          const results = await this.checkBatchUrls(request.urls, {
            sourceType: request.sourceType || 'link'
          });
          sendResponse(results);
          break;
        }

        case 'DECODE_QR_IMAGE': {
          // Cross-origin QR fallback: content-script canvas was tainted, so
          // decode here where host permissions bypass CORS.
          const decoded = await this.decodeQrFromUrl(request.src);
          sendResponse(decoded);
          break;
        }

        case 'GET_SETTINGS':
          sendResponse({ settings: this.settings, whitelist: this.whitelist });
          break;

        case 'GET_STATS':
          sendResponse(this.stats);
          break;

        case 'CLEAR_CACHE':
          this.cache.clear();
          sendResponse({ success: true });
          break;

        case 'CLEAR_BLOCKING':
          await this.clearAllBlocking();
          sendResponse({ success: true });
          break;

        case 'ALLOW_PHISHING_URL': {
          // Accept a single url or an array (original + resolved final URL).
          const toAllow = Array.isArray(request.urls)
            ? request.urls
            : [request.url];
          for (const allowUrl of toAllow) {
            if (allowUrl) {
              this.cache.delete(allowUrl);
              await this.removeBlockingRule(allowUrl);
            }
          }
          sendResponse({ success: true });
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
   * Check a single URL and return a normalized verdict object.
   *
   * Flow: whitelist -> cache -> resolve redirects (when relevant) -> analyze
   * the final URL -> normalize verdict -> block both original and final URLs
   * for dangerous verdicts.
   *
   * @param {string} url
   * @param {{ sourceType?: string }} options
   */
  async checkUrl(url, options = {}) {
    const sourceType = options.sourceType || 'link';

    // Real-time Protection is the master switch — no backend request when off.
    await this.settingsReady;
    if (!this.settings.qshingEnabled) {
      return {
        ...normalizeVerdict(
          { data: { verdict: VERDICTS.SAFE } },
          { inputUrl: url, finalUrl: url, sourceType }
        ),
        url,
        strict: true,
        timestamp: Date.now()
      };
    }

    // High-risk sources (QR / download / shortener) require a "strict" check:
    // the final redirect destination must be analyzed, and a non-strict cached
    // result (e.g. from an earlier plain-link scan) must NOT be reused.
    const needStrict = isHighRiskSource(sourceType);

    // 1. Whitelisted hosts bypass analysis entirely.
    if (this.isWhitelisted(url)) {
      return this.finalizeResult(
        {
          ...normalizeVerdict(
            { data: { verdict: VERDICTS.SAFE } },
            {
              inputUrl: url,
              finalUrl: url,
              sourceType
            }
          ),
          reasonCodes: ['whitelisted']
        },
        { skipBlock: true, skipStats: true, strict: true }
      );
    }

    // 2. Serve from cache when fresh — but never serve a non-strict cached
    //    result to a strict (high-risk) request.
    const cached = this.cache.get(url);
    if (
      cached &&
      Date.now() - cached.timestamp < this.CACHE_TTL_MS &&
      (!needStrict || cached.strict)
    ) {
      return cached;
    }

    // 3. Resolve shortened / redirected URLs to their final destination.
    let finalUrl = url;
    let redirectChain = [url];
    const needsResolution =
      isShortenerHost(url) || isHighRiskSource(sourceType);
    if (needsResolution) {
      const resolved = await this.resolveUrl(url);
      finalUrl = resolved.finalUrl;
      redirectChain = resolved.redirectChain;
      // If the final destination is whitelisted, treat as safe.
      if (finalUrl !== url && this.isWhitelisted(finalUrl)) {
        return this.finalizeResult(
          {
            ...normalizeVerdict(
              { data: { verdict: VERDICTS.SAFE } },
              {
                inputUrl: url,
                finalUrl,
                redirectChain,
                sourceType
              }
            ),
            reasonCodes: ['whitelisted_final']
          },
          { skipBlock: true, skipStats: true, strict: true }
        );
      }
    }

    const context = { inputUrl: url, finalUrl, redirectChain, sourceType };

    // Honor an active 429 back-off — return "pending" (unknown), don't hammer.
    if (this.isRateLimited()) {
      return {
        ...normalizeVerdict(
          { data: { status: 'pending', source: 'pending' } },
          context
        ),
        url,
        strict: false,
        timestamp: Date.now()
      };
    }

    try {
      // navigation = the page the user is on; everything else is a discovered link.
      const reqContext = sourceType === 'navigation' ? 'navigation' : 'link';
      const data = await this.requestAnalysis(finalUrl, reqContext);
      const verdict = normalizeVerdict(data, context);
      return this.finalizeResult(verdict, { strict: needsResolution });
    } catch (error) {
      console.error(`Error checking URL (${url}):`, error);
      // Fail-closed: never silently report a failed check as "safe".
      this.stats.errorCount++;
      const verdict = makeErrorVerdict(context, error.message);
      // Cache errors only briefly so transient failures self-heal, and never
      // mark an error result as strict so a later check re-runs.
      const result = {
        ...verdict,
        url,
        strict: false,
        timestamp: Date.now()
      };
      this.cache.set(url, {
        ...result,
        timestamp: Date.now() - this.CACHE_TTL_MS + 60000
      });
      return result;
    }
  }

  /**
   * POST a single URL to /analyze/check and return the parsed JSON.
   * @param {string} targetUrl
   * @param {'navigation'|'link'} context navigation = page the user is on;
   *   link = a URL discovered on the page (QR/download/shortener/anchor).
   */
  async requestAnalysis(targetUrl, context = 'link') {
    const response = await fetch(this.ENDPOINTS.analyzeCheck, {
      method: 'POST',
      headers: this.buildApiHeaders(),
      body: JSON.stringify({ url: targetUrl, context }),
      mode: 'cors',
      credentials: 'omit'
    });

    if (response.status === 429) {
      this.applyBackoff(response);
      throw new Error('rate_limited');
    }
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API request failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return response.json();
  }

  /** True while the server has asked us to back off (429 Retry-After). */
  isRateLimited() {
    return Date.now() < this.backoffUntil;
  }

  /** Record a 429 back-off window from the response's Retry-After header. */
  applyBackoff(response) {
    const header = response.headers.get('Retry-After');
    let seconds = Number(header);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      seconds = 30; // sensible default when the header is missing/odd
    }
    this.backoffUntil = Date.now() + Math.min(seconds, 300) * 1000;
    console.warn(`Rate limited; backing off for ${seconds}s`);
  }

  /**
   * Persist a verdict to cache + stats and apply blocking rules. Centralized so
   * both single and batch paths behave identically.
   */
  async finalizeResult(verdict, opts = {}) {
    const result = {
      ...verdict,
      url: verdict.inputUrl,
      strict: Boolean(opts.strict),
      timestamp: Date.now()
    };

    // Cache against both the original and final URLs.
    this.cache.set(result.inputUrl, result);
    if (result.finalUrl && result.finalUrl !== result.inputUrl) {
      this.cache.set(result.finalUrl, result);
    }

    if (!opts.skipStats) {
      this.stats.checkedUrls++;
      // Count only true blocks (severity=block / PHISHING). A `warn`
      // (SUSPICIOUS) is not a block under the new contract.
      if (result.verdict === VERDICTS.PHISHING) {
        this.stats.blockedSites++;
      }
      this.stats.lastUpdate = Date.now();
      await this.saveStatsToStorage();
      this.notifyStatsUpdated();
    }

    // Hard-block dangerous verdicts (honoring the blockPhishing setting) on both
    // the original and the resolved final URL. For discovered links shouldBlock
    // additionally requires an authoritative source (blacklist/reputation:*), so
    // a link's model/cache signal can never produce a hard block.
    const blockGate = { source: result.source, sourceType: result.sourceType };
    if (
      !opts.skipBlock &&
      shouldBlock(result.verdict, this.settings, blockGate)
    ) {
      await this.addBlockingRule(result.inputUrl);
      if (result.finalUrl && result.finalUrl !== result.inputUrl) {
        await this.addBlockingRule(result.finalUrl);
      }
    }

    return result;
  }

  /**
   * Follow HTTP redirects to discover the final destination of a URL. Uses
   * host permissions to read cross-origin redirects; falls back to a single
   * "follow" request when intermediate Location headers are not readable.
   */
  async resolveUrl(url, maxHops = this.MAX_REDIRECT_HOPS) {
    const chain = [url];
    let current = url;
    let finalUrl = url;

    try {
      for (let hop = 0; hop < maxHops; hop++) {
        let response;
        try {
          response = await fetch(current, {
            method: 'HEAD',
            redirect: 'manual',
            credentials: 'omit',
            cache: 'no-store'
          });
        } catch {
          response = await fetch(current, {
            method: 'GET',
            redirect: 'manual',
            credentials: 'omit',
            cache: 'no-store'
          });
        }

        const isRedirect =
          response.type === 'opaqueredirect' ||
          [301, 302, 303, 307, 308].includes(response.status);

        if (!isRedirect) {
          finalUrl = response.url || current;
          if (finalUrl !== current && !chain.includes(finalUrl)) {
            chain.push(finalUrl);
          }
          return { finalUrl, redirectChain: chain, resolved: true };
        }

        const location =
          response.type === 'opaqueredirect'
            ? null
            : response.headers.get('location');

        if (!location) {
          // Cannot read the intermediate hop; do one "follow" to get the end.
          const followed = await fetch(current, {
            method: 'HEAD',
            redirect: 'follow',
            credentials: 'omit',
            cache: 'no-store'
          }).catch(() => null);
          if (followed && followed.url) {
            finalUrl = followed.url;
            if (finalUrl !== current && !chain.includes(finalUrl)) {
              chain.push(finalUrl);
            }
          }
          return { finalUrl, redirectChain: chain, resolved: true };
        }

        const next = new URL(location, current).toString();
        if (chain.includes(next)) {
          // Redirect loop guard.
          return { finalUrl: next, redirectChain: chain, resolved: true };
        }
        chain.push(next);
        current = next;
        finalUrl = next;
      }
      return { finalUrl, redirectChain: chain, resolved: true };
    } catch (error) {
      console.warn(`Redirect resolution failed for ${url}:`, error);
      return {
        finalUrl,
        redirectChain: chain,
        resolved: false,
        error: error.message
      };
    }
  }

  /**
   * Check a batch of URLs. High-risk sources (QR / download / shortener) and
   * any cache-fresh URLs are handled individually so they get redirect
   * resolution and whitelist treatment; the remainder go through the batch
   * endpoint. Everything is returned as normalized verdict objects.
   *
   * @param {string[]} urls
   * @param {{ sourceType?: string }} options
   */
  async checkBatchUrls(urls, options = {}) {
    const sourceType = options.sourceType || 'link';

    // Real-time Protection off -> no backend requests, nothing to apply.
    await this.settingsReady;
    if (!this.settings.qshingEnabled) {
      return [];
    }

    const unique = [...new Set((urls || []).filter(Boolean))];

    // High-risk sources must each take the strict single-URL path so redirects
    // are resolved and the final destination is analyzed — the batch endpoint
    // does neither.
    if (isHighRiskSource(sourceType)) {
      const out = [];
      const batchSize = 5;
      for (let i = 0; i < unique.length; i += batchSize) {
        const wave = unique.slice(i, i + batchSize);
        const settled = await Promise.allSettled(
          wave.map((url) => this.checkUrl(url, { sourceType }))
        );
        settled.forEach((res, index) => {
          out.push(
            res.status === 'fulfilled'
              ? res.value
              : {
                  ...makeErrorVerdict(
                    { inputUrl: wave[index], sourceType },
                    res.reason?.message || 'High-risk check error'
                  ),
                  url: wave[index],
                  strict: false,
                  timestamp: Date.now()
                }
          );
        });
        if (i + batchSize < unique.length) {
          await this.delay(this.API_DELAY_MS);
        }
      }
      return out;
    }

    const results = [];
    const remaining = [];

    for (const url of unique) {
      const cached = this.cache.get(url);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
        results.push(cached);
      } else if (this.isWhitelisted(url) || isShortenerHost(url)) {
        // Needs per-URL whitelist / redirect handling.
        results.push(await this.checkUrl(url, { sourceType }));
      } else {
        remaining.push(url);
      }
    }

    if (remaining.length === 0) {
      return results;
    }

    // Send the plain links to /analyze/batch in chunks of <=50 (the server caps
    // at MAX_BATCH_URLS and returns the excess as "pending"). One call per chunk.
    for (let i = 0; i < remaining.length; i += this.MAX_BATCH_URLS) {
      const chunk = remaining.slice(i, i + this.MAX_BATCH_URLS);

      // Respect an active 429 back-off — mark the rest pending, don't hammer.
      if (this.isRateLimited()) {
        chunk.forEach((u) => results.push(this.pendingResult(u, sourceType)));
        continue;
      }

      let handled = false;
      try {
        const response = await fetch(this.ENDPOINTS.analyzeBatch, {
          method: 'POST',
          headers: this.buildApiHeaders(),
          body: JSON.stringify(chunk),
          mode: 'cors',
          credentials: 'omit'
        });

        if (response.status === 429) {
          this.applyBackoff(response);
          chunk.forEach((u) => results.push(this.pendingResult(u, sourceType)));
          continue;
        }

        if (response.ok) {
          const data = await response.json();
          const items = Array.isArray(data.data)
            ? data.data
            : Array.isArray(data)
              ? data
              : null;
          if (items) {
            for (const item of items) {
              const inputUrl = item.url || item.inputUrl;
              const verdict = normalizeVerdict(
                { data: item, message: data.message },
                { inputUrl, finalUrl: item.finalUrl || inputUrl, sourceType }
              );
              results.push(
                await this.finalizeResult(verdict, { strict: false })
              );
            }
            handled = true;
          }
        }
      } catch (error) {
        console.warn('Batch endpoint failed:', error);
      }

      if (!handled) {
        // Batch failed (401/500/malformed). Do NOT fan out to per-URL /check —
        // that would turn one failed 50-URL batch into 50 /check requests and
        // defeat "avoid bursty full-page scans". Mark the chunk pending instead;
        // these links stay unverified and can be re-queried via /check when the
        // user actually navigates to one.
        chunk.forEach((u) => results.push(this.pendingResult(u, sourceType)));
      }

      if (i + this.MAX_BATCH_URLS < remaining.length) {
        await this.delay(this.API_DELAY_MS);
      }
    }
    return results;
  }

  /** A "pending" (not-yet-analyzed) result — treated as unknown, not safe. */
  pendingResult(url, sourceType) {
    return {
      ...normalizeVerdict(
        { data: { status: 'pending', source: 'pending' } },
        { inputUrl: url, finalUrl: url, sourceType }
      ),
      url,
      strict: false,
      timestamp: Date.now()
    };
  }

  /**
   * Initialize blocking rules from stored blocklist
   */
  async initializeBlockingRules() {
    try {
      await this.settingsReady;
      // Protection off (incl. at startup): make sure no dynamic rules linger.
      if (!this.settings.qshingEnabled) {
        await this.clearAllBlocking();
        return;
      }
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
   * Remove ALL dynamic blocking rules and clear the stored blocklist. Used by
   * "Reset Settings" so blocking rules don't outlive a settings reset (they live
   * in declarativeNetRequest, separate from chrome.storage).
   */
  async clearAllBlocking() {
    try {
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      if (rules.length) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: rules.map((rule) => rule.id)
        });
      }
      await chrome.storage.local.set({ blockedUrls: [] });
      this.cache.clear();
      console.log(`Cleared ${rules.length} dynamic blocking rules`);
    } catch (error) {
      console.error('Error clearing blocking rules:', error);
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
   * Monitor downloads via the Chrome downloads API. Evaluates the final URL
   * (after redirects), MIME type and filename, and cancels downloads that
   * resolve to a phishing/suspicious verdict or carry deceptive double
   * extensions.
   */
  setupDownloadProtection() {
    if (!chrome.downloads || !chrome.downloads.onCreated) {
      console.warn('chrome.downloads API unavailable; download guard disabled');
      return;
    }
    chrome.downloads.onCreated.addListener((item) => {
      this.onDownloadCreated(item);
    });
  }

  /**
   * Evaluate a newly created download item and intervene if dangerous.
   */
  async onDownloadCreated(item) {
    await this.settingsReady;
    // Real-time Protection is the top-level switch; checkDownloads is secondary.
    if (!this.settings.qshingEnabled || !this.settings.checkDownloads) {
      return;
    }

    const downloadUrl = item.finalUrl || item.url;
    if (!downloadUrl || !/^https?:/i.test(downloadUrl)) {
      return;
    }

    const risk = evaluateDownloadRisk({
      url: downloadUrl,
      filename: item.filename,
      mime: item.mime
    });

    // Ask the analysis backend about the (resolved) download URL.
    let verdict = null;
    try {
      verdict = await this.checkUrl(downloadUrl, { sourceType: 'download' });
    } catch (_) {
      verdict = null;
    }

    const dangerousVerdict = verdict && isDangerousVerdict(verdict.verdict);
    const deceptive = risk.reasons.includes('deceptive_double_extension');

    if (dangerousVerdict || deceptive) {
      try {
        await chrome.downloads.cancel(item.id);
        await chrome.downloads.erase({ id: item.id });
      } catch (error) {
        console.warn('Failed to cancel dangerous download:', error);
      }
      this.stats.blockedSites++;
      this.stats.lastUpdate = Date.now();
      await this.saveStatsToStorage();
      this.notifyStatsUpdated();
      this.notifyDownloadBlocked(downloadUrl, risk, verdict);
      return;
    }

    // Only HIGH-risk types (executables) get a system notification. Medium-risk
    // documents (PDF, office, archives) are not confirmed malicious and would be
    // noisy — they were already flagged in-page by the download click modal.
    if (risk.risk === 'high') {
      this.notifyDownloadWarning(downloadUrl, risk);
    }
  }

  /**
   * Show a system notification that a download was blocked.
   */
  notifyDownloadBlocked(url, risk, verdict) {
    this.createNotification({
      key: `blocked:${self.WegisCore.getHost(url)}:${risk.filename || url}`,
      title: '⛔ Wegis blocked a dangerous download',
      message: `${risk.filename || url}\nReason: ${
        verdict && isDangerousVerdict(verdict.verdict)
          ? verdict.verdict
          : risk.reasons.join(', ') || 'high risk'
      }`
    });
  }

  /**
   * Show a non-blocking caution notification for risky download types.
   */
  notifyDownloadWarning(url, risk) {
    this.createNotification({
      key: `caution:${self.WegisCore.getHost(url)}:${risk.filename || url}`,
      title: '⚠️ Wegis download caution',
      message: `${risk.filename || url}\nThis file type (${
        risk.extension || 'unknown'
      }) can be risky. Only keep it if you trust the source.`
    });
  }

  /**
   * Create a system notification, rate-limited to avoid spamming: at most one
   * every NOTIFICATION_MIN_INTERVAL_MS, and the same host/filename `key` is
   * suppressed for NOTIFICATION_DEDUPE_MS.
   */
  createNotification({ title, message, key }) {
    const now = Date.now();

    // Drop duplicates for the same host/file within the dedupe window.
    if (key) {
      const last = this.recentNotificationKeys.get(key);
      if (last && now - last < this.NOTIFICATION_DEDUPE_MS) {
        return;
      }
      this.recentNotificationKeys.set(key, now);
      // Trim old entries so the map can't grow unbounded.
      for (const [k, ts] of this.recentNotificationKeys) {
        if (now - ts > this.NOTIFICATION_DEDUPE_MS) {
          this.recentNotificationKeys.delete(k);
        }
      }
    }

    // Global rate limit.
    if (now - this.lastNotificationAt < this.NOTIFICATION_MIN_INTERVAL_MS) {
      return;
    }
    this.lastNotificationAt = now;

    if (!chrome.notifications || !chrome.notifications.create) {
      console.warn(`[notification] ${title}: ${message}`);
      return;
    }
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title,
        message,
        priority: 2
      });
    } catch (error) {
      console.warn('Failed to create notification:', error);
    }
  }

  /**
   * Decode a QR code from an image URL inside the service worker. Used as a
   * fallback when the content-script canvas is tainted by a cross-origin image
   * (host permissions let the worker fetch the bytes directly).
   *
   * @param {string} src image URL
   * @returns {Promise<{ data: string|null, error?: string }>}
   */
  async decodeQrFromUrl(src) {
    if (typeof jsQR === 'undefined') {
      return { data: null, error: 'jsQR unavailable' };
    }
    if (
      typeof OffscreenCanvas === 'undefined' ||
      typeof createImageBitmap === 'undefined'
    ) {
      return { data: null, error: 'OffscreenCanvas unavailable' };
    }
    try {
      const response = await fetch(src, {
        credentials: 'omit',
        cache: 'force-cache'
      });
      if (!response.ok) {
        return { data: null, error: `fetch ${response.status}` };
      }
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);

      // Downscale very large images for performance.
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      const imageData = ctx.getImageData(0, 0, width, height);
      const code = jsQR(imageData.data, width, height);
      return { data: code ? code.data : null };
    } catch (error) {
      return { data: null, error: error.message };
    }
  }

  /**
   * Restore statistics from storage
   */
  async restoreStatsFromStorage() {
    try {
      const { qshingStats } = await chrome.storage.local.get(['qshingStats']);
      if (qshingStats && typeof qshingStats === 'object') {
        this.stats = {
          ...this.stats,
          ...qshingStats
        };
        console.log('Restored stats from storage:', this.stats);
      }
    } catch (error) {
      console.error('Failed to restore stats from storage:', error);
    }
  }

  /**
   * Persist statistics to storage
   */
  async saveStatsToStorage() {
    try {
      await chrome.storage.local.set({ qshingStats: this.stats });
    } catch (error) {
      console.error('Failed to save stats to storage:', error);
    }
  }

  /**
   * Notify other extension contexts that stats were updated
   */
  notifyStatsUpdated() {
    try {
      chrome.runtime.sendMessage(
        {
          action: 'STATS_UPDATED',
          stats: this.stats
        },
        () => {
          // Ignore errors when no listeners are available
          if (chrome.runtime.lastError) {
            return;
          }
        }
      );
    } catch (error) {
      console.error('Failed to notify stats update:', error);
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
