// ESLint flat config — tuned to catch REAL errors (undefined vars, unused
// assignments, unreachable code), not style-war rules; the codebase's terse
// idiom (semicolonned one-liners, inline styles) is left alone. The renderer
// runs as Babel-in-browser JSX with shared window.* globals across <script>
// tags, so cross-file identifiers resolve at runtime — the renderer override
// below declares those globals instead of fighting no-undef per file.
'use strict';
const js = require('@eslint/js');

// Globals the renderer files share via window.* assignment across script tags
// (see renderer/index.html load order) plus the CDN libraries it loads.
const rendererGlobals = {
  React: 'readonly', ReactDOM: 'readonly', Babel: 'readonly',
  d3: 'readonly', lucide: 'readonly', markdownit: 'readonly',
  window: 'readonly', document: 'readonly', navigator: 'readonly',
  fetch: 'readonly', AbortController: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  getComputedStyle: 'readonly', MutationObserver: 'readonly',
  ResizeObserver: 'readonly', requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly', localStorage: 'readonly',
  URL: 'readonly', Blob: 'readonly', FileReader: 'readonly',
};

const nodeGlobals = {
  require: 'readonly', module: 'writable', exports: 'writable',
  process: 'readonly', __dirname: 'readonly', __filename: 'readonly',
  Buffer: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly',
  fetch: 'readonly', AbortController: 'readonly', URL: 'readonly',
  URLSearchParams: 'readonly', structuredClone: 'readonly',
};

module.exports = [
  {
    ignores: [
      'node_modules/**', 'dist/**',
      // Compiled design-system bundle (generated output, not source).
      'renderer/design/_ds_bundle.js',
      // Renderer JSX is validated by the Babel parse step in CI (eslint's
      // default parser can't read JSX without extra plugins; the runtime
      // Babel transform is the authoritative parse anyway).
      'renderer/**/*.jsx',
      // Ad-hoc e2e/manual scripts: mixed Node + executeJavaScript(browser)
      // contexts in one file — not lintable under a single global set.
      'e2e-*.js', 'test-codex-install.js',
    ],
  },
  // Vitest test files (ESM — vitest's own API requires import syntax).
  {
    files: ['tests/**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  // Main-process / lib / hooks (Node CommonJS).
  {
    files: ['*.js', 'lib/**/*.js', 'assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Codebase idiom: intentional empty catch = fail-open hooks.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Unused function args are common in IPC handler signatures (_e);
      // caught errors are frequently intentionally ignored (fail-open).
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Sanitizers here legitimately match control chars (path/name cleaning).
      'no-control-regex': 'off',
      // Benign escaped-slash style in regexes throughout; not worth the churn.
      'no-useless-escape': 'off',
    },
  },
  // Plain-JS renderer files (non-JSX): browser globals.
  {
    files: ['renderer/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: rendererGlobals,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
