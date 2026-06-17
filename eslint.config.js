const js = require('@eslint/js');
const globals = require('globals');

const prettier = require('eslint-plugin-prettier');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  js.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    plugins: {
      prettier
    },
    rules: {
      'prettier/prettier': ['error'],
      'no-var': ['error'],
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-console': 'off',
      'prefer-const': 'error',
      eqeqeq: 'error',
      curly: 'error',
      'no-new': 'off'
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.es2021,
        ...globals.serviceworker,
        chrome: 'readonly',
        browser: 'readonly',
        LinkCollector: 'readonly',
        WegisCore: 'readonly',
        importScripts: 'readonly',
        jsQR: 'readonly'
      }
    }
  },
  {
    files: ['background/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker
      }
    }
  },
  {
    files: ['content/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    }
  },
  {
    // Shared UMD core: runs in browser, service worker AND Node (CommonJS),
    // so it needs both browser/worker and node globals.
    files: ['lib/wegis-core.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.node
      }
    }
  },
  {
    // Ignores must be in a separate block to apply globally:
    // https://eslint.org/docs/latest/use/configure/configuration-files#globally-ignoring-files-with-ignores
    ignores: [
      'eslint.config.js',
      'node_modules/**/*',
      'dist/**/*',
      'build/**/*',
      '**/*.min.js',
      '*.generated.js',
      '*.log'
    ]
  }
];
