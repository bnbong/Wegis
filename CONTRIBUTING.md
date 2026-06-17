# Contributing

## Development Setup

Requirements:

- Node.js 18 or higher
- npm
- Git
- Chrome with Manifest V3 support
- Optional: Python + `pre-commit`

Install dependencies:

```bash
npm install
```

Install pre-commit hooks:

```bash
pip install pre-commit
pre-commit install
```

If `pre-commit` is already available, `npm install` also runs the project
`prepare` script and installs the hook automatically.

Run checks:

```bash
npm test
npm run lint
npm run format:check
pre-commit run --all-files
```

Load the extension during development:

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project root folder containing `manifest.json`.

Notes:

- The extension uses the Wegis Server API, so live phishing analysis requires
  network access to the configured API endpoint.
- For manual browser checks, see the fixtures under `tests/fixtures/`.
