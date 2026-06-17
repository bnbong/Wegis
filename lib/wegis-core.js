/**
 * Wegis Core — shared, side-effect-free helpers used by the background service
 * worker, the content scripts, and the Node test suite.
 *
 * Exposed as `globalThis.WegisCore` for the service worker (importScripts) and
 * content scripts, and as `module.exports` for the Node test suite.
 *
 * Keep everything here PURE (no DOM, no chrome.*, no network) so it stays
 * testable without a browser.
 */
(function () {
  /**
   * Verdict taxonomy. Replaces the old boolean `result`, so that "analysis
   * unavailable" is never conflated with "confirmed phishing".
   */
  const VERDICTS = Object.freeze({
    SAFE: 'safe',
    PHISHING: 'phishing',
    SUSPICIOUS: 'suspicious',
    UNKNOWN: 'unknown',
    UNSUPPORTED_LANGUAGE: 'unsupported_language',
    ERROR: 'error'
  });

  const VERDICT_VALUES = Object.freeze(Object.values(VERDICTS));

  /**
   * Well-known URL shorteners / redirectors. Links on these hosts are resolved
   * to their final destination before analysis, since the shortener domain
   * itself tells us nothing about safety.
   */
  const KNOWN_SHORTENERS = Object.freeze(
    new Set([
      'bit.ly',
      'tinyurl.com',
      't.co',
      'goo.gl',
      'ow.ly',
      'is.gd',
      'buff.ly',
      'buly.kr',
      'me2.do',
      'durl.kr',
      'url.kr',
      'han.gl',
      'vo.la',
      'abr.ge',
      'rb.gy',
      'cutt.ly',
      'shorturl.at',
      't.ly',
      'lnkd.in',
      'youtu.be',
      'a.co',
      'amzn.to',
      'l.facebook.com',
      'lm.facebook.com',
      'naver.me',
      'kko.to',
      'forms.gle',
      'g.page'
    ])
  );

  /** Executable / installer extensions — highest download risk. */
  const EXECUTABLE_EXTENSIONS = Object.freeze(
    new Set([
      'exe',
      'msi',
      'dmg',
      'pkg',
      'apk',
      'ipa',
      'bat',
      'cmd',
      'com',
      'scr',
      'jar',
      'vbs',
      'vbe',
      'js',
      'jse',
      'ps1',
      'sh',
      'app',
      'deb',
      'rpm',
      'lnk',
      'reg',
      'hta',
      'msc'
    ])
  );

  /** Container / document extensions that are commonly weaponised. */
  const RISKY_DOCUMENT_EXTENSIONS = Object.freeze(
    new Set([
      'pdf',
      'zip',
      'rar',
      '7z',
      'tar',
      'gz',
      'iso',
      'img',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'docm',
      'xlsm',
      'pptm'
    ])
  );

  /** Extensions that frequently appear as the "decoy" half of a double ext. */
  const DECOY_EXTENSIONS = Object.freeze(
    new Set([
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'txt',
      'jpg',
      'jpeg',
      'png',
      'gif',
      'mp3',
      'mp4',
      'csv',
      'html'
    ])
  );

  function safeUrl(value, base) {
    try {
      return new URL(value, base);
    } catch (_) {
      return null;
    }
  }

  function getHost(url) {
    const parsed = safeUrl(url);
    return parsed ? parsed.hostname.toLowerCase() : '';
  }

  /**
   * Returns true when the host (or a parent domain of it) is a known shortener.
   */
  function isShortenerHost(hostOrUrl) {
    if (!hostOrUrl) {
      return false;
    }
    let host = hostOrUrl;
    if (host.includes('/') || host.includes(':')) {
      host = getHost(hostOrUrl);
    }
    host = String(host)
      .toLowerCase()
      .replace(/^www\./, '');
    if (!host) {
      return false;
    }
    if (KNOWN_SHORTENERS.has(host)) {
      return true;
    }
    // Match parent domains too (e.g. "x.bit.ly").
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      if (KNOWN_SHORTENERS.has(parts.slice(i).join('.'))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Extract the lower-cased file extension from a URL or filename, ignoring
   * query strings and fragments. Returns '' when there is none.
   */
  function getFileExtension(urlOrName) {
    if (!urlOrName) {
      return '';
    }
    let pathname = String(urlOrName);
    const parsed = safeUrl(urlOrName);
    if (parsed) {
      pathname = parsed.pathname;
    } else {
      // Strip query/fragment for bare filenames.
      pathname = pathname.split('?')[0].split('#')[0];
    }
    const base = pathname.split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) {
      return '';
    }
    return base.slice(dot + 1).toLowerCase();
  }

  function getFilenameFromUrl(url) {
    const parsed = safeUrl(url);
    const pathname = parsed ? parsed.pathname : String(url).split('?')[0];
    return decodeURIComponent(pathname.split('/').pop() || '');
  }

  /**
   * Detects "double extension" disguises such as `invoice.pdf.exe`, where a
   * benign-looking extension precedes a dangerous executable one.
   */
  function hasDeceptiveDoubleExtension(filename) {
    if (!filename) {
      return false;
    }
    const base = String(filename).split('/').pop().split('?')[0];
    const parts = base.split('.');
    if (parts.length < 3) {
      return false;
    }
    const last = parts[parts.length - 1].toLowerCase();
    const prev = parts[parts.length - 2].toLowerCase();
    return EXECUTABLE_EXTENSIONS.has(last) && DECOY_EXTENSIONS.has(prev);
  }

  /**
   * Parse a Content-Disposition header into a filename, if present.
   */
  function filenameFromContentDisposition(header) {
    if (!header || typeof header !== 'string') {
      return '';
    }
    const star = header.match(/filename\*=(?:[^']*'[^']*')?([^;]+)/i);
    if (star && star[1]) {
      try {
        return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ''));
      } catch (_) {
        return star[1].trim().replace(/^["']|["']$/g, '');
      }
    }
    const plain = header.match(/filename=("?)([^";]+)\1/i);
    return plain && plain[2] ? plain[2].trim() : '';
  }

  /**
   * Evaluate the risk of a download from whatever signals are available:
   * final URL, filename, MIME type and Content-Disposition. Extension checks
   * are case-insensitive and query-string aware.
   *
   * @returns {{ risk: 'high'|'medium'|'low', extension: string, reasons: string[] }}
   */
  function evaluateDownloadRisk(input = {}) {
    const { url = '', mime = '', contentDisposition = '' } = input;
    const filename =
      input.filename ||
      filenameFromContentDisposition(contentDisposition) ||
      getFilenameFromUrl(url);
    const extension = getFileExtension(filename) || getFileExtension(url);
    const reasons = [];
    let risk = 'low';

    if (hasDeceptiveDoubleExtension(filename)) {
      reasons.push('deceptive_double_extension');
      risk = 'high';
    }
    if (EXECUTABLE_EXTENSIONS.has(extension)) {
      reasons.push('executable_extension');
      risk = 'high';
    } else if (RISKY_DOCUMENT_EXTENSIONS.has(extension)) {
      reasons.push('risky_document_extension');
      if (risk !== 'high') {
        risk = 'medium';
      }
    }

    const normalizedMime = String(mime).toLowerCase();
    const executableMimes = [
      'application/x-msdownload',
      'application/x-msdos-program',
      'application/x-executable',
      'application/vnd.microsoft.portable-executable',
      'application/x-apple-diskimage',
      'application/vnd.android.package-archive'
    ];
    if (executableMimes.some((m) => normalizedMime.includes(m))) {
      reasons.push('executable_mime');
      risk = 'high';
    }
    if (
      normalizedMime === 'application/octet-stream' &&
      !EXECUTABLE_EXTENSIONS.has(extension)
    ) {
      reasons.push('opaque_octet_stream');
      if (risk === 'low') {
        risk = 'medium';
      }
    }

    return { risk, extension, filename, reasons };
  }

  function clampConfidence(value) {
    let confidence = Number(value);
    if (!Number.isFinite(confidence)) {
      return 0;
    }
    // Accept either 0..1 or 0..100 and normalise to 0..1.
    if (confidence > 1) {
      confidence = confidence / 100;
    }
    return Math.min(Math.max(confidence, 0), 1);
  }

  /**
   * Normalise an API response into the canonical verdict shape. Supports both
   * the new contract (`verdict`, `reasonCodes`, `language`, ...) and the legacy
   * boolean contract (`result`), so the extension keeps working against either
   * server version.
   *
   * @param {object} apiData raw parsed JSON from the server (may be wrapped in
   *   `{ data: {...}, message }`).
   * @param {object} context { inputUrl, finalUrl, redirectChain, sourceType }
   */
  function normalizeVerdict(apiData, context = {}) {
    const envelope = apiData && typeof apiData === 'object' ? apiData : {};
    const data =
      envelope.data && typeof envelope.data === 'object'
        ? envelope.data
        : envelope;

    let verdict =
      typeof data.verdict === 'string' ? data.verdict.toLowerCase().trim() : '';

    if (!verdict) {
      if (typeof data.result === 'boolean') {
        verdict = data.result ? VERDICTS.PHISHING : VERDICTS.SAFE;
      } else {
        verdict = VERDICTS.UNKNOWN;
      }
    }
    if (!VERDICT_VALUES.includes(verdict)) {
      verdict = VERDICTS.UNKNOWN;
    }

    const reasonCodes = Array.isArray(data.reasonCodes)
      ? data.reasonCodes
      : Array.isArray(data.reason_codes)
        ? data.reason_codes
        : [];

    const language = data.language || data.lang || context.language || null;

    // When the server reports it could not analyze the page because of an
    // unsupported language, "analysis unavailable" must never surface as a
    // dangerous verdict. This takes priority over however the verdict was
    // expressed — new `verdict`, legacy `result: true`, or `suspicious` — so a
    // non-English page is downgraded to the explicit unsupported state rather
    // than being flagged as phishing.
    if (
      data.languageSupported === false &&
      (isDangerousVerdict(verdict) || verdict === VERDICTS.UNKNOWN)
    ) {
      verdict = VERDICTS.UNSUPPORTED_LANGUAGE;
    }

    return {
      verdict,
      confidence: clampConfidence(data.confidence),
      reasonCodes,
      language,
      inputUrl: context.inputUrl || data.inputUrl || null,
      finalUrl: context.finalUrl || data.finalUrl || context.inputUrl || null,
      redirectChain: context.redirectChain || data.redirectChain || [],
      sourceType: context.sourceType || 'link',
      message: envelope.message || data.message || ''
    };
  }

  /** Build an explicit error/uncertain verdict for failure modes. */
  function makeErrorVerdict(context = {}, error = '') {
    return {
      verdict: VERDICTS.ERROR,
      confidence: 0,
      reasonCodes: ['analysis_failed'],
      language: context.language || null,
      inputUrl: context.inputUrl || null,
      finalUrl: context.finalUrl || context.inputUrl || null,
      redirectChain: context.redirectChain || [],
      sourceType: context.sourceType || 'link',
      error: error ? String(error) : 'analysis_failed',
      message: ''
    };
  }

  function isDangerousVerdict(verdict) {
    return verdict === VERDICTS.PHISHING || verdict === VERDICTS.SUSPICIOUS;
  }

  function isUncertainVerdict(verdict) {
    return (
      verdict === VERDICTS.UNKNOWN ||
      verdict === VERDICTS.UNSUPPORTED_LANGUAGE ||
      verdict === VERDICTS.ERROR
    );
  }

  const HIGH_RISK_SOURCES = Object.freeze(
    new Set(['qr', 'download', 'shortener'])
  );

  function isHighRiskSource(sourceType) {
    return HIGH_RISK_SOURCES.has(sourceType);
  }

  /**
   * Should navigation to this verdict be hard-blocked? Honors the
   * `blockPhishing` setting. Uncertain verdicts are never hard-blocked (to
   * avoid false positives) — they are surfaced as warnings instead.
   */
  function shouldBlock(verdict, settings = {}) {
    if (settings.blockPhishing === false) {
      return false;
    }
    return isDangerousVerdict(verdict);
  }

  /**
   * Should we surface a warning for this verdict? Dangerous verdicts always
   * warn; uncertain verdicts warn only in high-risk contexts (QR / download /
   * shortener) so we fail safe without spamming on ordinary links.
   */
  function shouldWarn(verdict, sourceType) {
    if (isDangerousVerdict(verdict)) {
      return true;
    }
    if (isUncertainVerdict(verdict) && isHighRiskSource(sourceType)) {
      return true;
    }
    return false;
  }

  // Public surface only — the bulk constant Sets above stay module-private.
  const WegisCore = {
    VERDICTS,
    isShortenerHost,
    getHost,
    getFileExtension,
    getFilenameFromUrl,
    hasDeceptiveDoubleExtension,
    filenameFromContentDisposition,
    evaluateDownloadRisk,
    normalizeVerdict,
    makeErrorVerdict,
    isDangerousVerdict,
    isUncertainVerdict,
    isHighRiskSource,
    shouldBlock,
    shouldWarn
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WegisCore;
  }
  globalThis.WegisCore = WegisCore;
})();
