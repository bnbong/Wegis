/**
 * Module for collecting all types of links from web pages
 */
class LinkCollector {
  constructor() {
    this.observer = null;
    // Cache decoded QR results keyed by image src to avoid re-decoding.
    this.qrCodeCache = new Map();
    // Latest QR objects: { element, decodedUrl } — consumed by the defender to
    // attach on-image warning overlays.
    this.lastQRObjects = [];
    // Toggled by the content script from the user's scanQRCodes setting.
    this.scanQRCodes = true;
    // Performance guard: max number of fresh QR decodes per scan.
    this.MAX_QR_SCANS = 40;
    this.MAX_QR_DIMENSION = 1024;
  }

  /**
   * Start collecting all links
   */
  async collectAllLinks() {
    const qrObjects = await this.collectQRObjects();

    // Clickable / scannable surfaces only: text URLs, anchors, QR codes.
    const allLinks = [
      ...new Set([
        ...this.collectURLs(),
        ...this.collectHyperlinks(),
        ...qrObjects.map((q) => q.decodedUrl)
      ])
    ];

    console.log('Collected links:', allLinks.length);
    return allLinks;
  }

  /**
   * Return the QR objects discovered in the most recent scan, each carrying
   * the source element so the defender can overlay a warning on it.
   */
  getQRObjects() {
    return this.lastQRObjects;
  }

  /**
   * Collect general URL links
   */
  collectURLs() {
    const urlPattern =
      /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;
    const textContent = document.body.innerText;
    const matches = textContent.match(urlPattern) || [];

    return [...new Set(matches)];
  }

  /**
   * Collect hyperlinks (a tags)
   */
  collectHyperlinks() {
    const links = [];
    const anchorElements = document.querySelectorAll('a[href]');

    anchorElements.forEach((anchor) => {
      const href = anchor.getAttribute('href');
      if (href && this.isValidURL(href)) {
        links.push(this.normalizeURL(href));
      }
    });

    return [...new Set(links)];
  }

  /**
   * Scan the page for QR codes and return rich objects:
   *   { element, decodedUrl }
   * Covers <img> (incl. <picture> via currentSrc), <canvas>, and elements with
   * a CSS background-image. Cross-origin images that taint the local canvas are
   * decoded in the service worker, which can fetch the bytes directly.
   */
  async collectQRObjects() {
    if (!this.scanQRCodes) {
      this.lastQRObjects = [];
      return [];
    }
    if (typeof jsQR === 'undefined') {
      console.warn('QR code library not available');
      this.lastQRObjects = [];
      return [];
    }

    const candidates = this.getQRCandidateElements();
    const objects = [];
    let freshScans = 0;

    for (const candidate of candidates) {
      if (freshScans >= this.MAX_QR_SCANS) {
        break;
      }
      const cacheKey = candidate.src || null;
      let decoded;

      if (cacheKey && this.qrCodeCache.has(cacheKey)) {
        decoded = this.qrCodeCache.get(cacheKey);
      } else {
        decoded = await this.decodeQRFromCandidate(candidate);
        freshScans++;
        if (cacheKey) {
          this.qrCodeCache.set(cacheKey, decoded);
        }
      }

      if (decoded && this.isValidURL(decoded)) {
        objects.push({
          element: candidate.element,
          decodedUrl: this.normalizeURL(decoded)
        });
      }
    }

    this.lastQRObjects = objects;
    return objects;
  }

  /**
   * Build the list of QR scan candidates from images, canvases and CSS
   * background images, skipping tiny elements unlikely to hold a scannable QR.
   */
  getQRCandidateElements() {
    const candidates = [];
    const minSize = 40;

    document.querySelectorAll('img').forEach((element) => {
      const w = element.naturalWidth || element.width || 0;
      const h = element.naturalHeight || element.height || 0;
      if (w && h && (w < minSize || h < minSize)) {
        return;
      }
      candidates.push({
        element,
        type: 'img',
        src: element.currentSrc || element.src || null
      });
    });

    document.querySelectorAll('canvas').forEach((element) => {
      if (element.width < minSize || element.height < minSize) {
        return;
      }
      candidates.push({ element, type: 'canvas', src: null });
    });

    // Inline CSS background images (best-effort).
    document
      .querySelectorAll('[style*="background-image"]')
      .forEach((element) => {
        const src = this.extractBackgroundImageUrl(element);
        if (src) {
          candidates.push({ element, type: 'bg', src });
        }
      });

    return candidates;
  }

  extractBackgroundImageUrl(element) {
    try {
      const bg =
        element.style.backgroundImage ||
        getComputedStyle(element).backgroundImage;
      const match = bg && bg.match(/url\(["']?([^"')]+)["']?\)/i);
      if (match && match[1]) {
        return new URL(match[1], window.location.href).toString();
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  /**
   * Decode a single QR candidate, falling back to the service worker for
   * cross-origin images.
   */
  async decodeQRFromCandidate(candidate) {
    try {
      if (candidate.type === 'canvas') {
        return this.decodeViaCanvasElement(candidate.element);
      }
      if (candidate.type === 'img') {
        const local = this.decodeViaLocalCanvas(candidate.element);
        if (local) {
          return local;
        }
      }
      // Cross-origin <img>, tainted canvas, or CSS background: ask the worker.
      if (candidate.src) {
        return await this.decodeViaServiceWorker(candidate.src);
      }
    } catch (_) {
      // Non-QR content or a tainted canvas: try the worker before giving up.
      if (candidate.src) {
        return this.decodeViaServiceWorker(candidate.src);
      }
    }
    return null;
  }

  /** Decode directly from an on-page <canvas>. */
  decodeViaCanvasElement(canvasElement) {
    const ctx = canvasElement.getContext('2d');
    const imageData = ctx.getImageData(
      0,
      0,
      canvasElement.width,
      canvasElement.height
    );
    const code = jsQR(
      imageData.data,
      canvasElement.width,
      canvasElement.height
    );
    return code ? code.data : null;
  }

  /**
   * Decode from an already-loaded <img> using a local canvas. Throws a
   * SecurityError for cross-origin images (caught upstream to trigger the
   * service-worker fallback).
   */
  decodeViaLocalCanvas(imgElement) {
    const naturalW = imgElement.naturalWidth || imgElement.width;
    const naturalH = imgElement.naturalHeight || imgElement.height;
    if (!naturalW || !naturalH) {
      return null;
    }

    const scale = Math.min(
      1,
      this.MAX_QR_DIMENSION / Math.max(naturalW, naturalH)
    );
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgElement, 0, 0, width, height);

    // Throws SecurityError if the image tainted the canvas.
    const imageData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, width, height);
    return code ? code.data : null;
  }

  /** Ask the background worker to fetch + decode a (cross-origin) image. */
  decodeViaServiceWorker(src) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { action: 'DECODE_QR_IMAGE', src },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve(null);
              return;
            }
            resolve(response && response.data ? response.data : null);
          }
        );
      } catch (_) {
        resolve(null);
      }
    });
  }

  /**
   * Setup Observer for dynamic content detection
   */
  startObserving() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      let shouldRecheck = false;

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node;
              // Check if new links or images have been added
              if (
                element.tagName === 'A' ||
                element.tagName === 'IMG' ||
                element.tagName === 'CANVAS' ||
                element.querySelector('a, img, canvas')
              ) {
                shouldRecheck = true;
              }
            }
          });
        } else if (mutation.type === 'attributes') {
          // A dynamically swapped image src / background may now hold a QR.
          const tag = mutation.target.tagName;
          if (
            tag === 'IMG' ||
            tag === 'A' ||
            mutation.attributeName === 'src' ||
            mutation.attributeName === 'style'
          ) {
            shouldRecheck = true;
          }
        }
      });

      if (shouldRecheck) {
        // Re-collect after slight delay for debounce
        setTimeout(() => {
          this.collectAllLinks().then((links) => {
            // Send new links to content script
            window.postMessage(
              {
                type: 'QSHING_NEW_LINKS',
                links
              },
              '*'
            );
          });
        }, 500);
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'href', 'style']
    });
  }

  /**
   * Stop Observer
   */
  stopObserving() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /**
   * URL validation
   */
  isValidURL(string) {
    try {
      // Convert relative URL to absolute URL
      const url = new URL(string, window.location.href);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  /**
   * Normalize URL
   */
  normalizeURL(url) {
    try {
      const urlObj = new URL(url, window.location.href);
      // Remove fragment, keep query parameters
      urlObj.hash = '';
      return urlObj.toString();
    } catch (_) {
      return url;
    }
  }
}

// Export globally
window.LinkCollector = LinkCollector;
