/**
 * Module for collecting all types of links from web pages
 */
class LinkCollector {
  constructor() {
    this.collectedLinks = new Set();
    this.observer = null;
    this.qrCodeCache = new Map();
  }

  /**
   * Start collecting all links
   */
  async collectAllLinks() {
    const links = {
      urls: this.collectURLs(),
      hyperlinks: this.collectHyperlinks(),
      downloadLinks: this.collectDownloadLinks(),
      socialCards: this.collectSocialCardLinks(),
      qrCodes: await this.collectQRCodes()
    };

    // Remove duplicates
    const allLinks = [
      ...new Set([
        ...links.urls,
        ...links.hyperlinks,
        ...links.downloadLinks,
        ...links.socialCards,
        ...links.qrCodes
      ])
    ];

    console.log('Collected links:', allLinks.length);
    return allLinks;
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
   * Collect download links
   */
  collectDownloadLinks() {
    const downloadLinks = [];
    const downloadExtensions = [
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'zip',
      'rar',
      '7z',
      'tar',
      'gz',
      'exe',
      'msi',
      'dmg',
      'pkg',
      'apk',
      'ipa'
    ];

    // Links with download attribute
    const downloadElements = document.querySelectorAll('a[download]');
    downloadElements.forEach((element) => {
      const href = element.getAttribute('href');
      if (href && this.isValidURL(href)) {
        downloadLinks.push({
          url: this.normalizeURL(href),
          filename: element.getAttribute('download') || '',
          type: 'download_attribute'
        });
      }
    });

    // Links presumed by file extension
    const allLinks = document.querySelectorAll('a[href]');
    allLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (href && this.isValidURL(href)) {
        const url = this.normalizeURL(href);
        const extension = this.getFileExtension(url);

        if (downloadExtensions.includes(extension.toLowerCase())) {
          downloadLinks.push({
            url,
            filename: this.getFilenameFromURL(url),
            type: 'file_extension',
            extension
          });
        }
      }
    });

    return downloadLinks.map((link) => link.url);
  }

  /**
   * Collect social card links (Open Graph, Twitter Card, etc.)
   */
  collectSocialCardLinks() {
    const socialLinks = [];

    // Open Graph
    const ogUrls = document.querySelectorAll('meta[property="og:url"]');
    ogUrls.forEach((meta) => {
      const content = meta.getAttribute('content');
      if (content && this.isValidURL(content)) {
        socialLinks.push(this.normalizeURL(content));
      }
    });

    // Twitter Card
    const twitterUrls = document.querySelectorAll('meta[name="twitter:url"]');
    twitterUrls.forEach((meta) => {
      const content = meta.getAttribute('content');
      if (content && this.isValidURL(content)) {
        socialLinks.push(this.normalizeURL(content));
      }
    });

    // Canonical URL
    const canonicalLinks = document.querySelectorAll('link[rel="canonical"]');
    canonicalLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (href && this.isValidURL(href)) {
        socialLinks.push(this.normalizeURL(href));
      }
    });

    return [...new Set(socialLinks)];
  }

  /**
   * Extract links from QR codes
   */
  async collectQRCodes() {
    if (typeof QrScanner === 'undefined' && typeof jsQR === 'undefined') {
      console.warn('QR code library not available');
      return [];
    }

    const qrLinks = [];
    const images = document.querySelectorAll('img');
    const canvases = document.querySelectorAll('canvas');

    // Scan QR codes from images
    for (const img of images) {
      try {
        const qrData = await this.scanQRFromImage(img);
        if (qrData && this.isValidURL(qrData)) {
          qrLinks.push(this.normalizeURL(qrData));
        }
      } catch (error) {
        // Ignore non-QR code images
      }
    }

    // Scan QR codes from canvas
    for (const canvas of canvases) {
      try {
        const qrData = await this.scanQRFromCanvas(canvas);
        if (qrData && this.isValidURL(qrData)) {
          qrLinks.push(this.normalizeURL(qrData));
        }
      } catch (error) {
        // Ignore non-QR code canvas
      }
    }

    return [...new Set(qrLinks)];
  }

  /**
   * Scan QR code from image
   */
  async scanQRFromImage(imgElement) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, canvas.width, canvas.height);

          if (code) {
            resolve(code.data);
          } else {
            reject(new Error('No QR code found'));
          }
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imgElement.src;
    });
  }

  /**
   * Scan QR code from canvas
   */
  async scanQRFromCanvas(canvasElement) {
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

    if (code) {
      return code.data;
    } else {
      throw new Error('No QR code found');
    }
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
      subtree: true
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

  /**
   * Extract file extension
   */
  getFileExtension(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const parts = pathname.split('.');
      return parts.length > 1 ? parts[parts.length - 1] : '';
    } catch (_) {
      return '';
    }
  }

  /**
   * Extract filename from URL
   */
  getFilenameFromURL(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      return pathname.split('/').pop() || '';
    } catch (_) {
      return '';
    }
  }
}

// Export globally
window.LinkCollector = LinkCollector;
