# Wegis tests

## Automated unit tests

Pure logic in [`lib/wegis-core.js`](../lib/wegis-core.js) (verdict
normalization, shortener detection, download-risk evaluation, extension
parsing) is covered by Node's built-in test runner — no browser or extra
dependencies required:

```bash
npm test          # node --test
```

These cover the testable slices of the improvement plan:

- shortener detection (`bit.ly` and friends)
- case-insensitive, query-aware file extensions (e.g. `setup.EXE?token=…`)
- deceptive double extensions (`invoice.pdf.exe`)
- download risk from extension / MIME / Content-Disposition
- verdict normalization: legacy boolean ↔ new `verdict` contract
- non-English pages mapped to `unsupported_language`, **never** `phishing`
- fail-closed `ERROR` verdicts (no silent fail-open)
- `shouldBlock` / `shouldWarn` policy gating

## Browser fixtures (manual / integration)

DOM- and network-dependent behavior can't run headless without a browser
harness, so the following fixtures are provided for manual verification with
the unpacked extension loaded (`chrome://extensions` → Load unpacked):

| Fixture                                                  | Verifies                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`fixtures/downloads.html`](fixtures/downloads.html)     | executable / double-extension / uppercase / query-string download detection                                                       |
| [`fixtures/qr.html`](fixtures/qr.html)                   | same-origin canvas QR, cross-origin QR (service-worker decode fallback), dynamic-`src` re-scan, crayon "Blocked by Wegis" overlay |
| [`fixtures/non-english.html`](fixtures/non-english.html) | Korean/Japanese pages are not false-flagged as phishing                                                                           |

### Crayon erase (2.0) — manual checklist

With a dangerous verdict on a link, verify:

- the link gets the `wegis-crayon-erased-link` class and animated crayon strokes
- left click, ctrl/cmd click, middle click and Enter are all intercepted
- `showWarnings=false` hides the crayon but the link stays blocked
- `blockPhishing=false` keeps the href (no neutralization) but still warns before navigation
- whitelisted domains are never erased
- `prefers-reduced-motion: reduce` shows a static erase with no animation
- long / multi-line / button-styled links don't break layout

Redirect resolution (`bit.ly → final`) is best verified live, since it depends
on real HTTP redirects; the `qr.html` fixtures encode `bit.ly` URLs so the
shortener-resolution path is exercised end to end.
