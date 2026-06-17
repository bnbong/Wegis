/**
 * Wegis Content Script
 * Collects links from web pages and performs phishing site detection.
 *
 * Detection results are normalized "verdict" objects (see lib/wegis-core.js):
 *   { verdict, confidence, reasonCodes, language, inputUrl, finalUrl,
 *     redirectChain, sourceType, message }
 * so "analysis unavailable" is never confused with "confirmed phishing".
 */

class QshingDefender {
  constructor() {
    this.linkCollector = new LinkCollector();
    this.checkedUrls = new Map(); // url -> verdict result
    this.blockedUrls = new Set(); // hard-blocked (blockPhishing on)
    this.warnUrls = new Set(); // flagged but not hard-blocked (warn-only)
    this.phishingDetails = new Map();
    this.qrOverlays = []; // { overlay, element }
    this.isEnabled = true;
    this.linkBlockingSetup = false; // attach click/keydown guards only once

    // Crayon "erase" branding (visual layer only).
    this.crayonStylesInjected = false;

    // User settings, kept in sync with chrome.storage.
    this.settings = {
      blockPhishing: true,
      showWarnings: true,
      checkDownloads: true,
      scanQRCodes: true
    };

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
      this.linkCollector.scanQRCodes = this.settings.scanQRCodes;

      // Initial link collection
      const links = await this.linkCollector.collectAllLinks();
      console.log(`Found total of ${links.length} links.`);

      // QR-decoded URLs must NOT be checked as plain links first (that would
      // cache a non-strict result the QR high-risk path then reuses). Exclude
      // them here and route them exclusively through processQRObjects().
      const qrUrls = new Set(
        this.linkCollector.getQRObjects().map((q) => q.decodedUrl)
      );
      await this.checkLinks(links.filter((url) => !qrUrls.has(url)));
      await this.processQRObjects();

      // Start dynamic content detection
      this.linkCollector.startObserving();

      // Setup link click blocking
      this.setupLinkBlocking();
    } catch (error) {
      console.error('Error starting protection features:', error);
    }
  }

  /**
   * Re-scan the current page on demand (popup "Scan Again"): reset the in-page
   * state, then re-collect, re-check and re-apply verdicts so new results show
   * up as crayon erase / blocking. Returns the number of links found.
   */
  async rescan() {
    if (!this.isEnabled) {
      return 0;
    }
    this.removeAllWarnings({ restoreLinks: true });
    this.checkedUrls.clear();
    this.linkCollector.scanQRCodes = this.settings.scanQRCodes;

    const links = await this.linkCollector.collectAllLinks();
    const qrUrls = new Set(
      this.linkCollector.getQRObjects().map((q) => q.decodedUrl)
    );
    await this.checkLinks(links.filter((url) => !qrUrls.has(url)));
    await this.processQRObjects();
    return links.length;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Receive new link detection messages
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'QSHING_NEW_LINKS') {
        // Exclude QR-decoded URLs from the plain-link batch (see startProtection).
        const qrUrls = new Set(
          this.linkCollector.getQRObjects().map((q) => q.decodedUrl)
        );
        this.checkLinks(
          (event.data.links || []).filter((url) => !qrUrls.has(url))
        );
        this.processQRObjects();
      }
    });

    // Live settings updates.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') {
        return;
      }
      for (const key of Object.keys(this.settings)) {
        if (changes[key]) {
          this.settings[key] = changes[key].newValue !== false;
        }
      }
      if (changes.qshingEnabled) {
        this.isEnabled = changes.qshingEnabled.newValue !== false;
      }
      if (changes.scanQRCodes) {
        this.linkCollector.scanQRCodes = this.settings.scanQRCodes;
      }
      if (changes.showWarnings) {
        if (this.settings.showWarnings) {
          // Re-show crayon visuals without re-running the network checks.
          this.reapplyWarnings();
        } else {
          // Hide the visual layer but keep blocking intact.
          this.removeAllWarnings({ restoreLinks: false });
        }
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
          this.checkSingleUrl(request.url, request.sourceType).then(
            (result) => {
              sendResponse(result);
            }
          );
          return true;

        case 'RESCAN':
          // Popup "Scan Again": re-check the page and apply the verdicts here
          // (erase/block), then report how many links were found.
          this.rescan().then((count) => sendResponse({ links: count }));
          return true;

        case 'TOGGLE_PROTECTION':
          this.isEnabled = request.enabled;
          if (!this.isEnabled) {
            this.linkCollector.stopObserving();
            // Protection off: fully restore the page (hrefs + blocklist).
            this.removeAllWarnings({ restoreLinks: true });
          } else {
            this.startProtection();
          }
          sendResponse({ success: true });
          break;
      }
    });
  }

  /**
   * Check a batch of standard links via the background worker.
   */
  async checkLinks(urls) {
    if (!urls || urls.length === 0) {
      return;
    }

    const uncheckedUrls = urls.filter((url) => !this.checkedUrls.has(url));
    if (uncheckedUrls.length === 0) {
      return;
    }

    console.log(`Checking ${uncheckedUrls.length} new links...`);
    const results = await this.requestBatch(uncheckedUrls, 'link');
    results.forEach((result) => this.processVerdict(result));
  }

  /**
   * Check QR-derived URLs as a high-risk source, then overlay warnings on the
   * QR images/canvases themselves so users don't scan them with a phone.
   */
  async processQRObjects() {
    const qrObjects = this.linkCollector.getQRObjects();
    if (!qrObjects || qrObjects.length === 0) {
      return;
    }

    // Map each decoded URL back to the element(s) that produced it.
    const urlToElements = new Map();
    for (const { element, decodedUrl } of qrObjects) {
      if (!urlToElements.has(decodedUrl)) {
        urlToElements.set(decodedUrl, []);
      }
      urlToElements.get(decodedUrl).push(element);
    }

    const results = await this.requestBatch([...urlToElements.keys()], 'qr');
    results.forEach((result) => {
      this.processVerdict(result);
      const elements =
        urlToElements.get(result.inputUrl) ||
        urlToElements.get(result.finalUrl) ||
        [];
      if (
        this.settings.showWarnings &&
        WegisCore.shouldWarn(result.verdict, 'qr')
      ) {
        elements.forEach((el) => this.addQROverlay(el, result));
      }
      // The same URL may also appear as a normal anchor on the page (e.g. a
      // phishing link that is ALSO shown as a QR). processVerdict() skips the
      // anchor erase for sourceType 'qr', so do it here for dangerous verdicts.
      if (
        this.settings.showWarnings &&
        WegisCore.shouldWarn(result.verdict, 'link')
      ) {
        this.markRiskyLink(result.inputUrl, result);
        if (result.finalUrl && result.finalUrl !== result.inputUrl) {
          this.markRiskyLink(result.finalUrl, result);
        }
      }
    });
  }

  /**
   * Send a batch of URLs to the background worker for analysis.
   */
  requestBatch(urls, sourceType) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { action: 'CHECK_BATCH_URLS', urls, sourceType },
          (response) => {
            if (chrome.runtime.lastError) {
              console.warn(
                'Batch check failed:',
                chrome.runtime.lastError.message
              );
              resolve([]);
              return;
            }
            resolve(Array.isArray(response) ? response : []);
          }
        );
      } catch (error) {
        console.error('Error requesting batch check:', error);
        resolve([]);
      }
    });
  }

  /**
   * Check a single URL (used by the runtime message handler).
   */
  async checkSingleUrl(url, sourceType = 'link') {
    const cached = this.checkedUrls.get(url);
    if (cached && Date.now() - cached.timestamp < 3600000) {
      return cached;
    }

    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'CHECK_URL', url, sourceType },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve(
              WegisCore.makeErrorVerdict(
                { inputUrl: url, sourceType },
                chrome.runtime.lastError.message
              )
            );
            return;
          }
          resolve(response);
        }
      );
    });

    this.processVerdict(result);
    return result;
  }

  /**
   * Apply a verdict: update caches, blocklist, and visual warnings according to
   * the user's blockPhishing / showWarnings settings.
   */
  processVerdict(result) {
    if (!result || (!result.inputUrl && !result.url)) {
      return;
    }
    const url = result.inputUrl || result.url;
    result.timestamp = result.timestamp || Date.now();

    this.checkedUrls.set(url, result);
    if (result.finalUrl && result.finalUrl !== url) {
      this.checkedUrls.set(result.finalUrl, result);
    }

    const block = WegisCore.shouldBlock(result.verdict, this.settings);
    const warn = WegisCore.shouldWarn(result.verdict, result.sourceType);

    if (block) {
      // Hard-block: clicks are cancelled and the href is neutralized.
      this.blockedUrls.add(url);
      if (result.finalUrl) {
        this.blockedUrls.add(result.finalUrl);
      }
      this.phishingDetails.set(url, result);
      console.warn(
        `Dangerous site (${result.verdict}): ${url}` +
          (result.finalUrl && result.finalUrl !== url
            ? ` -> ${result.finalUrl}`
            : '')
      );
    } else if (warn) {
      // Warn-only (e.g. blockPhishing off, or uncertain high-risk source):
      // keep the href but still guard the click with a pre-navigation warning.
      this.warnUrls.add(url);
      if (result.finalUrl) {
        this.warnUrls.add(result.finalUrl);
      }
      this.phishingDetails.set(url, result);
    }

    // Crayon erase is the visual layer only — gated by showWarnings. QR codes
    // get their own overlay via processQRObjects().
    if (this.settings.showWarnings && warn && result.sourceType !== 'qr') {
      this.markRiskyLink(url, result);
    }
  }

  /**
   * Mark every anchor whose (normalized) href equals the risky URL by "erasing"
   * it. Iterating + normalizing each href — rather than an `a[href*="…"]`
   * substring selector — also matches relative links (e.g. "/login") that
   * normalize to the dangerous absolute URL.
   */
  markRiskyLink(url, result) {
    document.querySelectorAll('a[href]').forEach((element) => {
      // Already-erased links keep their real href in a data attribute.
      const candidate =
        element.dataset.wegisOriginalHref || element.getAttribute('href');
      if (candidate && this.linkCollector.normalizeURL(candidate) === url) {
        this.eraseLink(element, result);
      }
    });
  }

  /**
   * Apply the Wegis 2.0 "crayon erase" treatment to a dangerous link: a diagonal
   * crayon coloring sweeps over it from the top-left corner. This is the visual
   * layer only — the hard click/keyboard blocking lives in setupLinkBlocking()
   * and the background blocking rules, so the effect never weakens security.
   * Phishing colors are darker/denser than suspicious/uncertain ones.
   */
  eraseLink(linkElement, result) {
    // Visual already drawn — nothing to do.
    if (linkElement.classList.contains('wegis-crayon-erased-link')) {
      return;
    }
    this.injectCrayonStyles();

    const block = WegisCore.shouldBlock(result.verdict, this.settings);
    const severity = this.severityOf(result.verdict);

    // Security state is set once and survives a showWarnings toggle (only the
    // crayon visual is removed when warnings are hidden).
    if (!linkElement.dataset.wegisErased) {
      linkElement.dataset.wegisErased = 'true';
      const currentHref = linkElement.getAttribute('href');
      if (currentHref !== null) {
        linkElement.dataset.wegisOriginalHref = currentHref;
      }
      linkElement.setAttribute('aria-disabled', 'true');
      // Neutralize the href only when hard-blocking (defense in depth on top of
      // the click guard); warn-only keeps the href navigable after consent.
      if (block && currentHref !== null) {
        linkElement.setAttribute('href', '#');
        linkElement.dataset.wegisHrefNeutralized = 'true';
      }
    }
    linkElement.setAttribute(
      'title',
      `Blocked by Wegis — ${this.describeVerdict(result)}`
    );

    // Diagonal crayon coloring; severity controls how dark/dense it is.
    linkElement.classList.add(
      'wegis-crayon-erased-link',
      `wegis-sev-${severity}`
    );

    // Screen-reader note (don't rely on color alone).
    if (!linkElement.querySelector('.wegis-sr-note')) {
      const sr = document.createElement('span');
      sr.className = 'wegis-sr-note';
      sr.textContent = ' (Blocked by Wegis)';
      sr.style.cssText =
        'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;';
      linkElement.appendChild(sr);
    }
  }

  /** Map a verdict to a crayon severity bucket. */
  severityOf(verdict) {
    if (verdict === WegisCore.VERDICTS.PHISHING) {
      return 'phishing';
    }
    if (verdict === WegisCore.VERDICTS.SUSPICIOUS) {
      return 'suspicious';
    }
    return 'uncertain';
  }

  /**
   * Inject the crayon stylesheet once. Kept in a single <style> node (no extra
   * CSS file) per the 2.0 plan.
   */
  injectCrayonStyles() {
    if (
      this.crayonStylesInjected ||
      document.getElementById('wegis-crayon-styles')
    ) {
      this.crayonStylesInjected = true;
      return;
    }
    // Grain mask: fractal noise thresholded to a speckled alpha, tiled over the
    // diagonal color so it reads like a real crayon (textured, not flat). White
    // fill keeps it correct under both alpha- and luminance-mask modes.
    const grain =
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.62' numOctaves='2' seed='6' result='n'/%3E%3CfeComponentTransfer in='n' result='m'%3E%3CfeFuncA type='discrete' tableValues='0 0 1 1 1'/%3E%3C/feComponentTransfer%3E%3CfeComposite in='SourceGraphic' in2='m' operator='in'/%3E%3C/filter%3E%3Crect width='64' height='64' fill='white' filter='url(%23g)'/%3E%3C/svg%3E\")";

    const style = document.createElement('style');
    style.id = 'wegis-crayon-styles';
    style.textContent = `
      .wegis-crayon-erased-link,
      .wegis-crayon-qr-overlay {
        --wegis-grain: ${grain};
      }
      .wegis-crayon-erased-link {
        position: relative !important;
        text-decoration: none !important;
      }
      /* Diagonal crayon coloring layers (the ::before is the dense 2nd pass
         used only for phishing). */
      .wegis-crayon-erased-link::before,
      .wegis-crayon-erased-link::after,
      .wegis-crayon-qr-overlay::before,
      .wegis-crayon-qr-overlay::after {
        content: "";
        position: absolute;
        inset: -1px;
        pointer-events: none;
        -webkit-mask-image: var(--wegis-grain);
        mask-image: var(--wegis-grain);
        -webkit-mask-size: 64px 64px;
        mask-size: 64px 64px;
        clip-path: polygon(0 0, 0 0, 0 0);
        animation: wegis-crayon-fill 520ms cubic-bezier(0.25, 0.7, 0.3, 1)
          forwards;
      }
      .wegis-crayon-erased-link::after,
      .wegis-crayon-qr-overlay::after {
        background: repeating-linear-gradient(
          135deg,
          var(--wegis-c) 0,
          var(--wegis-c) var(--wegis-on),
          transparent var(--wegis-on),
          transparent var(--wegis-gap)
        );
      }
      /* Second cross-hatch pass: hidden unless phishing. */
      .wegis-crayon-erased-link::before,
      .wegis-crayon-qr-overlay::before {
        display: none;
        animation-delay: 95ms;
        background: repeating-linear-gradient(
          112deg,
          var(--wegis-c) 0,
          var(--wegis-c) var(--wegis-on),
          transparent var(--wegis-on),
          transparent var(--wegis-gap)
        );
      }
      .wegis-sev-phishing.wegis-crayon-erased-link::before,
      .wegis-crayon-qr-overlay.wegis-sev-phishing::before {
        display: block;
      }
      /* Severity → color + density. Phishing is darkest and most filled. */
      .wegis-sev-phishing {
        --wegis-c: rgba(196, 18, 12, 0.92);
        --wegis-on: 7px;
        --wegis-gap: 11px;
      }
      .wegis-sev-suspicious {
        --wegis-c: rgba(232, 73, 15, 0.8);
        --wegis-on: 6px;
        --wegis-gap: 12px;
      }
      .wegis-sev-uncertain {
        --wegis-c: rgba(240, 162, 2, 0.74);
        --wegis-on: 5px;
        --wegis-gap: 14px;
      }
      /* Diagonal reveal from the top-left corner. */
      @keyframes wegis-crayon-fill {
        from { clip-path: polygon(0 0, 0 0, 0 0); }
        to   { clip-path: polygon(0 0, 220% 0, 0 220%); }
      }
      .wegis-crayon-qr-overlay {
        position: absolute;
        box-sizing: border-box;
        z-index: 2147483646;
        overflow: hidden;
        pointer-events: none;
        background: rgba(255, 255, 255, 0.34);
      }
      @media (prefers-reduced-motion: reduce) {
        .wegis-crayon-erased-link::before,
        .wegis-crayon-erased-link::after,
        .wegis-crayon-qr-overlay::before,
        .wegis-crayon-qr-overlay::after {
          animation: none !important;
          clip-path: polygon(0 0, 220% 0, 0 220%) !important;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    this.crayonStylesInjected = true;
  }

  /**
   * Overlay a warning directly on a QR code element so the user is stopped
   * before they scan it with a phone.
   */
  addQROverlay(element, result) {
    if (!element || element.dataset.wegisQrErased) {
      return;
    }
    element.dataset.wegisQrErased = '1';
    this.injectCrayonStyles();

    const severity = this.severityOf(result.verdict);
    const rect = element.getBoundingClientRect();

    // Crayon coloring that sweeps diagonally over the QR so it can't be casually
    // scanned. QR codes are always treated as at least "suspicious" density so
    // the code is meaningfully obscured.
    const overlay = document.createElement('div');
    overlay.className = `wegis-crayon-qr-overlay wegis-sev-${
      severity === 'uncertain' ? 'suspicious' : severity
    }`;
    overlay.style.cssText = `
      left: ${rect.left + window.scrollX}px;
      top: ${rect.top + window.scrollY}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
    `;
    overlay.setAttribute('role', 'img');
    overlay.setAttribute(
      'aria-label',
      `Blocked by Wegis — ${this.describeVerdict(result)}`
    );

    document.body.appendChild(overlay);
    this.qrOverlays.push({ overlay, element });
  }

  /**
   * Human-readable verdict summary for tooltips/modals.
   */
  describeVerdict(result) {
    const labels = {
      [WegisCore.VERDICTS.PHISHING]: 'Phishing site detected',
      [WegisCore.VERDICTS.SUSPICIOUS]: 'Suspicious site',
      [WegisCore.VERDICTS.UNKNOWN]: 'Could not be verified',
      [WegisCore.VERDICTS.UNSUPPORTED_LANGUAGE]:
        'Language not supported — could not be verified',
      [WegisCore.VERDICTS.ERROR]: 'Analysis failed — treat with caution'
    };
    let text = labels[result.verdict] || result.verdict;
    if (result.confidence) {
      text += ` (Confidence: ${(result.confidence * 100).toFixed(1)}%)`;
    }
    if (result.finalUrl && result.finalUrl !== result.inputUrl) {
      text += `\nResolves to: ${result.finalUrl}`;
    }
    return text;
  }

  /**
   * Setup link blocking. Listeners are attached once for the page's lifetime —
   * they read the live blockedUrls/warnUrls sets, so toggling protection off/on
   * must NOT re-attach them (that would stack duplicate handlers).
   */
  setupLinkBlocking() {
    if (this.linkBlockingSetup) {
      return;
    }
    this.linkBlockingSetup = true;

    // Resolve the URL that an anchor should be guarded against, or null. Handles
    // erased links whose href was neutralized to '#' (uses the stored original),
    // and links that are flagged by URL even when not visually erased (e.g.
    // showWarnings off).
    const guardedUrl = (anchor) => {
      if (!anchor) {
        return null;
      }
      // For erased links the href may be neutralized to "#", so recover the
      // original from the data attribute. Either way, the blockedUrls/warnUrls
      // sets are the authoritative source of truth — a leftover data attribute
      // alone must never block (e.g. after "Continue" or protection off).
      const candidate = anchor.dataset.wegisErased
        ? anchor.dataset.wegisOriginalHref || anchor.getAttribute('href')
        : anchor.getAttribute('href');
      if (!candidate) {
        return null;
      }
      const normalized = this.linkCollector.normalizeURL(candidate);
      if (
        normalized &&
        (this.blockedUrls.has(normalized) || this.warnUrls.has(normalized))
      ) {
        return normalized;
      }
      return null;
    };

    const handleClick = (event) => {
      const target = event.target.closest('a');
      const url = guardedUrl(target);
      if (url) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.showBlockingWarning(url, target);
      }
    };

    // Covers left click, middle click and ctrl/cmd-click (auxclick + click).
    document.addEventListener('click', handleClick, true);
    document.addEventListener('auxclick', handleClick, true);

    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter') {
          return;
        }
        const active = document.activeElement;
        if (!active || active.tagName !== 'A') {
          return;
        }
        const url = guardedUrl(active);
        if (url) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.showBlockingWarning(url, active);
        }
      },
      true
    );

    // Pre-download warning for risky file links (in-page; the background
    // downloads guard is the authoritative layer).
    document.addEventListener(
      'click',
      (event) => {
        if (!this.settings.checkDownloads) {
          return;
        }
        // Check every anchor and let evaluateDownloadRisk() decide — an
        // extension suffix selector misses query strings (photos.zip?token=…).
        const target = event.target.closest('a[href], a[download]');
        if (!target) {
          return;
        }

        const href = target.getAttribute('href');
        if (!href) {
          return;
        }

        if (this.isHighRiskDownload(href, target)) {
          event.preventDefault();
          this.showDownloadWarning(this.linkCollector.normalizeURL(href));
        }
      },
      true
    );
  }

  /**
   * Show blocking warning
   */
  showBlockingWarning(url) {
    const result = this.phishingDetails.get(url) || this.checkedUrls.get(url);
    const confidence = result ? result.confidence : 0;
    const description = result
      ? this.describeVerdict(result)
      : 'This link is suspected to be a phishing site.';

    this.showModal({
      title: 'Blocked Dangerous Site',
      titleColor: '#e8483f',
      rows: [
        { text: description, css: 'white-space:pre-line;' },
        {
          text: `Confidence: ${(confidence * 100).toFixed(1)}%`,
          css: 'font-weight:bold;color:#e8483f;'
        },
        {
          text: url,
          css: 'word-break:break-all;background:#fff6e3;padding:10px;border-radius:8px;font-family:monospace;font-size:13px;'
        }
      ],
      buttons: [
        { label: 'Close', color: '#4d96ff', onClick: (close) => close() },
        {
          label: 'Continue at your own risk',
          color: '#e8483f',
          onClick: (close) => {
            close();
            this.allowNavigationToUrl(url);
          }
        }
      ]
    });
  }

  /**
   * Show download warning dialog
   */
  showDownloadWarning(url) {
    const risk = WegisCore.evaluateDownloadRisk({ url });
    const reasonNote = risk.reasons.includes('deceptive_double_extension')
      ? 'This file uses a deceptive double extension (e.g. invoice.pdf.exe) and may be malware.'
      : 'Executable and archive files may contain malicious code. Only download from trusted sources.';

    this.showModal({
      title: 'File Download Warning',
      titleColor: '#ff9f1c',
      rows: [
        { text: 'Please check the file you are about to download.' },
        // filename is attacker-controllable (download attr / URL).
        {
          text: `Filename: ${risk.filename || 'unknown'}`,
          css: 'font-weight:bold;'
        },
        {
          text: `Extension: .${risk.extension || 'unknown'} (risk: ${risk.risk})`,
          css: 'font-weight:bold;'
        }
      ],
      note: reasonNote,
      buttons: [
        { label: 'Cancel', color: '#9b8b78', onClick: (close) => close() },
        {
          label: 'Download',
          color: '#5fbf66',
          onClick: (close) => {
            close();
            window.open(url, '_blank', 'noopener');
          }
        }
      ]
    });
  }

  /**
   * Render a modal entirely from createElement + textContent (page/API-derived
   * strings must never reach innerHTML). Clicking the backdrop dismisses it.
   *
   * @param {{ title, titleColor, rows: {text,css?}[], note?: string,
   *   buttons: {label,color,onClick:(close)=>void}[] }} spec
   */
  showModal(spec) {
    // Crayon theme constants (inline so the modal resists arbitrary page CSS).
    const FONT =
      "'Comic Sans MS','Chalkboard SE','Chalkboard','Marker Felt','Segoe Print','Comic Neue',system-ui,sans-serif";
    // Straight crayon-textured border (grain mask), used as a border-image.
    const BORDER =
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120' preserveAspectRatio='none'%3E%3Cfilter id='wb'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.5' numOctaves='2' seed='4' result='n'/%3E%3CfeComponentTransfer in='n' result='m'%3E%3CfeFuncA type='discrete' tableValues='0 0 1 1 1 1'/%3E%3C/feComponentTransfer%3E%3CfeComposite in='SourceGraphic' in2='m' operator='in'/%3E%3C/filter%3E%3Cg fill='%23c2b291' filter='url(%23wb)'%3E%3Crect x='0' y='0' width='120' height='13'/%3E%3Crect x='0' y='107' width='120' height='13'/%3E%3Crect x='0' y='0' width='13' height='120'/%3E%3Crect x='107' y='0' width='13' height='120'/%3E%3C/g%3E%3C/svg%3E\")";
    // Faint dark grain layered over colored buttons.
    const GRAIN =
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90'%3E%3Cfilter id='wn'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2' seed='3'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.12 0'/%3E%3C/filter%3E%3Crect width='90' height='90' filter='url(%23wn)'/%3E%3C/svg%3E\")";
    const edge = (w) =>
      `border:${w}px solid transparent;border-image:${BORDER} 14 / ${w}px / 0 round;`;

    const el = (tag, text, css) => {
      const node = document.createElement(tag);
      if (text !== null && text !== undefined) {
        node.textContent = text;
      }
      if (css) {
        node.style.cssText = css;
      }
      return node;
    };

    const modal = el(
      'div',
      null,
      `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(74,63,53,0.55);z-index:2147483647;display:flex;justify-content:center;align-items:center;font-family:${FONT};`
    );
    const card = el(
      'div',
      null,
      `background:#fffdf5;color:#4a3f35;font-family:${FONT};padding:26px 28px;max-width:480px;width:90%;box-sizing:border-box;text-align:center;border-radius:18px 12px 20px 10px / 10px 20px 12px 18px;${edge(5)}`
    );
    modal.appendChild(card);

    const close = () => {
      if (modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }
    };
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        close();
      }
    });

    card.appendChild(
      el(
        'h2',
        spec.title,
        `font-family:${FONT};font-weight:700;font-size:22px;color:${spec.titleColor};margin:0 0 16px;`
      )
    );
    (spec.rows || []).forEach((row) => {
      card.appendChild(
        el(
          'p',
          row.text,
          `font-family:${FONT};margin:10px 0;line-height:1.5;font-size:15px;${row.css || ''}`
        )
      );
    });
    if (spec.note) {
      const box = el(
        'div',
        null,
        `background:#fff6e3;padding:14px;margin:15px 0;border-radius:12px 8px 14px 7px / 7px 14px 8px 12px;${edge(3)}`
      );
      box.appendChild(
        el(
          'p',
          spec.note,
          `font-family:${FONT};margin:0;color:#8a6d1f;font-size:14px;`
        )
      );
      card.appendChild(box);
    }

    const actions = el(
      'div',
      null,
      'margin-top:22px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;'
    );
    (spec.buttons || []).forEach((b) => {
      const btn = el(
        'button',
        b.label,
        `font-family:${FONT};font-weight:700;font-size:14px;color:#fff;cursor:pointer;padding:10px 18px;${edge(4)}` +
          `background-color:${b.color};background-image:${GRAIN},linear-gradient(135deg,rgba(255,255,255,0.34) 0%,rgba(255,255,255,0) 48%),repeating-linear-gradient(135deg,rgba(0,0,0,0.13) 0,rgba(0,0,0,0.13) 3px,rgba(255,255,255,0.05) 3px,rgba(255,255,255,0.05) 9px);background-size:90px 90px,auto,auto;`
      );
      btn.addEventListener('click', () => b.onClick(close));
      actions.appendChild(btn);
    });
    card.appendChild(actions);

    document.body.appendChild(modal);
  }

  /**
   * Allow navigation after user confirmation. Unblocks BOTH the original and
   * the resolved final URL (a redirect/shortener verdict blocks both), so an
   * approved shortener isn't re-blocked by the lingering final-URL rule.
   */
  allowNavigationToUrl(url) {
    const result = this.phishingDetails.get(url) || this.checkedUrls.get(url);
    const urls = new Set([url]);
    if (result) {
      if (result.inputUrl) {
        urls.add(result.inputUrl);
      }
      if (result.finalUrl) {
        urls.add(result.finalUrl);
      }
    }
    urls.forEach((u) => {
      this.blockedUrls.delete(u);
      this.warnUrls.delete(u);
      this.phishingDetails.delete(u);
    });

    // Un-erase any on-page anchors for these URLs so the link works after the
    // user has explicitly consented (matched by data attribute, since the href
    // may have been neutralized to "#").
    document.querySelectorAll('[data-wegis-erased]').forEach((el) => {
      const orig = el.dataset.wegisOriginalHref || el.getAttribute('href');
      if (orig && urls.has(this.linkCollector.normalizeURL(orig))) {
        this.restoreErasedLink(el);
      }
    });

    chrome.runtime.sendMessage(
      { action: 'ALLOW_PHISHING_URL', urls: [...urls] },
      () => {
        void chrome.runtime.lastError; // ignore inactive worker
        window.open(url, '_blank', 'noopener');
      }
    );
  }

  /**
   * Identify high-risk download files using shared risk evaluation.
   */
  isHighRiskDownload(url, element) {
    const filename = (element && element.getAttribute('download')) || undefined;
    const risk = WegisCore.evaluateDownloadRisk({ url, filename });
    return risk.risk === 'high' || risk.risk === 'medium';
  }

  /**
   * Remove the crayon visuals and QR overlays.
   *
   * @param {{ restoreLinks?: boolean }} options
   *   restoreLinks=false (showWarnings turned off): strip the visual layer but
   *     keep links neutralized + the blocklist intact, so blocking continues.
   *   restoreLinks=true (protection turned off): fully restore hrefs and clear
   *     the blocklist so pages behave normally again.
   */
  removeAllWarnings(options = {}) {
    const restoreLinks = options.restoreLinks !== false;

    if (restoreLinks) {
      // Full restore: bring back the href + drop the blocking state on EVERY
      // link still carrying it — matched by the data attribute, not the crayon
      // class, so a link whose visual was already stripped (showWarnings off)
      // is still restored and never left as href="#".
      document.querySelectorAll('[data-wegis-erased]').forEach((el) => {
        this.restoreErasedLink(el);
      });
    } else {
      // Hide the visual layer only; keep the blocking/neutralization intact.
      document.querySelectorAll('.wegis-crayon-erased-link').forEach((el) => {
        this.unstyleCrayonLink(el);
      });
    }

    this.qrOverlays.forEach(({ overlay, element }) => {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (element && element.dataset) {
        delete element.dataset.wegisQrErased;
      }
    });
    this.qrOverlays = [];

    if (restoreLinks) {
      this.blockedUrls.clear();
      this.warnUrls.clear();
      this.phishingDetails.clear();
    }
  }

  /**
   * Remove the crayon visual layer from a link (class, severity, SR note) while
   * keeping the security state (neutralized href + data attributes) so blocking
   * continues when warnings are merely hidden.
   */
  unstyleCrayonLink(el) {
    el.classList.remove(
      'wegis-crayon-erased-link',
      'wegis-sev-phishing',
      'wegis-sev-suspicious',
      'wegis-sev-uncertain'
    );
    const sr = el.querySelector('.wegis-sr-note');
    if (sr) {
      sr.remove();
    }
  }

  /**
   * Fully restore an erased link: remove the visual, bring back the original
   * href, and drop every blocking/a11y attribute.
   */
  restoreErasedLink(el) {
    this.unstyleCrayonLink(el);
    if (
      el.dataset.wegisHrefNeutralized &&
      el.dataset.wegisOriginalHref !== undefined
    ) {
      el.setAttribute('href', el.dataset.wegisOriginalHref);
    }
    el.removeAttribute('aria-disabled');
    el.removeAttribute('title');
    delete el.dataset.wegisErased;
    delete el.dataset.wegisOriginalHref;
    delete el.dataset.wegisHrefNeutralized;
  }

  /**
   * Re-draw crayon visuals for already-flagged links/QR (e.g. when the user
   * re-enables showWarnings) using cached verdicts.
   */
  reapplyWarnings() {
    this.phishingDetails.forEach((result, url) => {
      if (
        result.sourceType !== 'qr' &&
        WegisCore.shouldWarn(result.verdict, result.sourceType)
      ) {
        this.markRiskyLink(url, result);
      }
    });
    this.processQRObjects();
  }

  /**
   * Load settings
   */
  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        'qshingEnabled',
        'blockPhishing',
        'showWarnings',
        'checkDownloads',
        'scanQRCodes'
      ]);
      this.isEnabled = result.qshingEnabled !== false;
      this.settings = {
        blockPhishing: result.blockPhishing !== false,
        showWarnings: result.showWarnings !== false,
        checkDownloads: result.checkDownloads !== false,
        scanQRCodes: result.scanQRCodes !== false
      };
      this.linkCollector.scanQRCodes = this.settings.scanQRCodes;
    } catch (error) {
      console.error('Error loading settings:', error);
      this.isEnabled = true;
    }
  }
}

// Execute on page load
new QshingDefender();
