/**
 * Unit tests for the shared pure logic in lib/wegis-core.js.
 * Run with:  npm test   (node --test)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const Core = require('../lib/wegis-core.js');
const { VERDICTS } = Core;

test('isShortenerHost detects known shorteners (bit.ly chain)', () => {
  assert.equal(Core.isShortenerHost('https://bit.ly/abc123'), true);
  assert.equal(Core.isShortenerHost('bit.ly'), true);
  assert.equal(Core.isShortenerHost('https://www.tinyurl.com/x'), true);
  assert.equal(Core.isShortenerHost('https://naver.me/abcd'), true);
  assert.equal(Core.isShortenerHost('https://example.com/path'), false);
  assert.equal(Core.isShortenerHost(''), false);
});

test('getFileExtension is case-insensitive and ignores query strings', () => {
  assert.equal(Core.getFileExtension('https://x.com/report.PDF'), 'pdf');
  assert.equal(
    Core.getFileExtension('https://x.com/setup.EXE?token=abc&v=2'),
    'exe'
  );
  assert.equal(Core.getFileExtension('https://x.com/file.tar.gz'), 'gz');
  assert.equal(Core.getFileExtension('https://x.com/no-extension'), '');
  assert.equal(Core.getFileExtension('invoice.zip'), 'zip');
});

test('hasDeceptiveDoubleExtension catches invoice.pdf.exe style disguises', () => {
  assert.equal(Core.hasDeceptiveDoubleExtension('invoice.pdf.exe'), true);
  assert.equal(Core.hasDeceptiveDoubleExtension('photo.jpg.scr'), true);
  assert.equal(Core.hasDeceptiveDoubleExtension('report.pdf'), false);
  assert.equal(Core.hasDeceptiveDoubleExtension('archive.tar.gz'), false);
});

test('evaluateDownloadRisk classifies executables, double-ext, and docs', () => {
  const exe = Core.evaluateDownloadRisk({ url: 'https://x.com/app.exe' });
  assert.equal(exe.risk, 'high');
  assert.ok(exe.reasons.includes('executable_extension'));

  const deceptive = Core.evaluateDownloadRisk({
    url: 'https://x.com/q?file=1',
    filename: 'invoice.pdf.exe'
  });
  assert.equal(deceptive.risk, 'high');
  assert.ok(deceptive.reasons.includes('deceptive_double_extension'));

  const pdf = Core.evaluateDownloadRisk({ url: 'https://x.com/doc.PDF?x=1' });
  assert.equal(pdf.risk, 'medium');

  const benign = Core.evaluateDownloadRisk({ url: 'https://x.com/image.png' });
  assert.equal(benign.risk, 'low');
});

test('evaluateDownloadRisk reads Content-Disposition + executable MIME', () => {
  const r = Core.evaluateDownloadRisk({
    url: 'https://x.com/download?id=42',
    contentDisposition: 'attachment; filename="update.msi"',
    mime: 'application/x-msdownload'
  });
  assert.equal(r.risk, 'high');
  assert.equal(r.filename, 'update.msi');
  assert.ok(r.reasons.includes('executable_mime'));
});

test('normalizeVerdict maps legacy boolean result', () => {
  const phishing = Core.normalizeVerdict(
    { data: { result: true, confidence: 0.9 } },
    { inputUrl: 'https://bad.example' }
  );
  assert.equal(phishing.verdict, VERDICTS.PHISHING);
  assert.equal(phishing.confidence, 0.9);

  const safe = Core.normalizeVerdict({ data: { result: false } }, {});
  assert.equal(safe.verdict, VERDICTS.SAFE);
});

test('normalizeVerdict honors the new verdict contract + context', () => {
  const v = Core.normalizeVerdict(
    {
      data: {
        verdict: 'suspicious',
        confidence: 73,
        reasonCodes: ['newly_registered'],
        language: 'ko'
      }
    },
    {
      inputUrl: 'https://bit.ly/x',
      finalUrl: 'https://target.example',
      redirectChain: ['https://bit.ly/x', 'https://target.example'],
      sourceType: 'shortener'
    }
  );
  assert.equal(v.verdict, VERDICTS.SUSPICIOUS);
  assert.equal(v.confidence, 0.73); // 0..100 normalised to 0..1
  assert.deepEqual(v.reasonCodes, ['newly_registered']);
  assert.equal(v.finalUrl, 'https://target.example');
  assert.equal(v.redirectChain.length, 2);
});

test('normalizeVerdict separates unsupported language from phishing', () => {
  // A non-English page must never be reported as phishing by default.
  const ko = Core.normalizeVerdict(
    {
      data: {
        verdict: 'phishing',
        language: 'ko',
        languageSupported: false
      }
    },
    {}
  );
  assert.equal(ko.verdict, VERDICTS.UNSUPPORTED_LANGUAGE);

  const explicit = Core.normalizeVerdict(
    { data: { verdict: 'unsupported_language', language: 'ja' } },
    {}
  );
  assert.equal(explicit.verdict, VERDICTS.UNSUPPORTED_LANGUAGE);

  // languageSupported:false takes priority over a legacy boolean result...
  const legacy = Core.normalizeVerdict(
    { data: { result: true, languageSupported: false } },
    {}
  );
  assert.equal(legacy.verdict, VERDICTS.UNSUPPORTED_LANGUAGE);

  // ...and over a "suspicious" verdict.
  const suspicious = Core.normalizeVerdict(
    { data: { verdict: 'suspicious', languageSupported: false } },
    {}
  );
  assert.equal(suspicious.verdict, VERDICTS.UNSUPPORTED_LANGUAGE);

  // A genuine safe verdict is left untouched.
  const stillSafe = Core.normalizeVerdict(
    { data: { verdict: 'safe', languageSupported: false } },
    {}
  );
  assert.equal(stillSafe.verdict, VERDICTS.SAFE);
});

test('normalizeVerdict defaults unknown shapes to UNKNOWN, never SAFE', () => {
  const v = Core.normalizeVerdict({ data: {} }, {});
  assert.equal(v.verdict, VERDICTS.UNKNOWN);
  const garbage = Core.normalizeVerdict({ data: { verdict: 'wat' } }, {});
  assert.equal(garbage.verdict, VERDICTS.UNKNOWN);
});

test('shouldBlock hard-blocks only PHISHING (block severity), never SUSPICIOUS', () => {
  assert.equal(
    Core.shouldBlock(VERDICTS.PHISHING, { blockPhishing: true }),
    true
  );
  // SUSPICIOUS == server "warn" — must NEVER be a hard interstitial.
  assert.equal(Core.shouldBlock(VERDICTS.SUSPICIOUS, {}), false);
  assert.equal(
    Core.shouldBlock(VERDICTS.PHISHING, { blockPhishing: false }),
    false
  );
  assert.equal(Core.shouldBlock(VERDICTS.UNKNOWN, {}), false);
  assert.equal(Core.shouldBlock(VERDICTS.SAFE, {}), false);
});

test('shouldBlock gates discovered links on an authoritative source', () => {
  const on = { blockPhishing: true };

  // A discovered link (sourceType=link) hard-blocks ONLY from blacklist/reputation.
  assert.equal(
    Core.shouldBlock(VERDICTS.PHISHING, on, {
      sourceType: 'link',
      source: 'blacklist'
    }),
    true
  );
  assert.equal(
    Core.shouldBlock(VERDICTS.PHISHING, on, {
      sourceType: 'link',
      source: 'reputation:google'
    }),
    true
  );
  // A link's model/cache PHISHING must NEVER hard-block (contract rule #4).
  assert.equal(
    Core.shouldBlock(VERDICTS.PHISHING, on, {
      sourceType: 'link',
      source: 'model'
    }),
    false
  );
  assert.equal(
    Core.shouldBlock(VERDICTS.PHISHING, on, {
      sourceType: 'link',
      source: 'cache'
    }),
    false
  );

  // The active page (navigation) CAN be hard-flagged by the model.
  assert.equal(
    Core.shouldBlock(VERDICTS.PHISHING, on, {
      sourceType: 'navigation',
      source: 'model'
    }),
    true
  );

  // No opts (e.g. legacy callers / unit checks): source gate is skipped.
  assert.equal(Core.shouldBlock(VERDICTS.PHISHING, on), true);
});

test('isAuthoritativeBlockSource recognizes blacklist and reputation feeds', () => {
  assert.equal(Core.isAuthoritativeBlockSource('blacklist'), true);
  assert.equal(Core.isAuthoritativeBlockSource('reputation:phishtank'), true);
  assert.equal(Core.isAuthoritativeBlockSource('model'), false);
  assert.equal(Core.isAuthoritativeBlockSource('cache'), false);
  assert.equal(Core.isAuthoritativeBlockSource(''), false);
  assert.equal(Core.isAuthoritativeBlockSource(null), false);
});

test('normalizeVerdict maps the severity/status/source contract', () => {
  const block = Core.normalizeVerdict(
    {
      data: {
        result: true,
        severity: 'block',
        status: 'final',
        source: 'blacklist',
        confidence: 1
      }
    },
    {}
  );
  assert.equal(block.verdict, VERDICTS.PHISHING);
  assert.equal(block.severity, 'block');
  assert.equal(block.source, 'blacklist');

  // warn -> SUSPICIOUS (result is false because result == block)
  const warn = Core.normalizeVerdict(
    { data: { result: false, severity: 'warn', source: 'model' } },
    {}
  );
  assert.equal(warn.verdict, VERDICTS.SUSPICIOUS);

  const allow = Core.normalizeVerdict(
    { data: { result: false, severity: 'allow', source: 'whitelist' } },
    {}
  );
  assert.equal(allow.verdict, VERDICTS.SAFE);

  // pending must be UNKNOWN, never SAFE — even though result is false.
  const pending = Core.normalizeVerdict(
    { data: { result: false, severity: 'allow', status: 'pending' } },
    {}
  );
  assert.equal(pending.verdict, VERDICTS.UNKNOWN);
  assert.equal(pending.status, 'pending');

  // non_html / blocked_private are allow/benign.
  const nonHtml = Core.normalizeVerdict(
    { data: { result: false, severity: 'allow', source: 'non_html' } },
    {}
  );
  assert.equal(nonHtml.verdict, VERDICTS.SAFE);

  // source=error -> ERROR.
  const err = Core.normalizeVerdict(
    { data: { result: false, source: 'error' } },
    {}
  );
  assert.equal(err.verdict, VERDICTS.ERROR);
});

test('shouldWarn surfaces uncertain verdicts only for high-risk sources', () => {
  // Uncertain on a plain link: stay quiet (avoid false-positive noise).
  assert.equal(Core.shouldWarn(VERDICTS.UNKNOWN, 'link'), false);
  // Uncertain on a QR / download / shortener: warn (fail safe).
  assert.equal(Core.shouldWarn(VERDICTS.UNKNOWN, 'qr'), true);
  assert.equal(Core.shouldWarn(VERDICTS.ERROR, 'download'), true);
  assert.equal(
    Core.shouldWarn(VERDICTS.UNSUPPORTED_LANGUAGE, 'shortener'),
    true
  );
  // Dangerous always warns.
  assert.equal(Core.shouldWarn(VERDICTS.PHISHING, 'link'), true);
  // Safe never warns.
  assert.equal(Core.shouldWarn(VERDICTS.SAFE, 'qr'), false);
});

test('makeErrorVerdict is an explicit ERROR state (fail-closed)', () => {
  const e = Core.makeErrorVerdict(
    { inputUrl: 'https://x.com', sourceType: 'download' },
    'network down'
  );
  assert.equal(e.verdict, VERDICTS.ERROR);
  assert.equal(e.sourceType, 'download');
  assert.equal(e.error, 'network down');
  assert.ok(Core.isUncertainVerdict(e.verdict));
  assert.equal(Core.isDangerousVerdict(e.verdict), false);
});
