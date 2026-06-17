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

test('shouldBlock respects blockPhishing and only blocks dangerous verdicts', () => {
  assert.equal(
    Core.shouldBlock(VERDICTS.PHISHING, { blockPhishing: true }),
    true
  );
  assert.equal(Core.shouldBlock(VERDICTS.SUSPICIOUS, {}), true);
  assert.equal(
    Core.shouldBlock(VERDICTS.PHISHING, { blockPhishing: false }),
    false
  );
  assert.equal(Core.shouldBlock(VERDICTS.UNKNOWN, {}), false);
  assert.equal(Core.shouldBlock(VERDICTS.SAFE, {}), false);
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
