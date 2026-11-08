import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import lineBaseline from './tools/max-lines-baseline.json' with { type: 'json' };

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'coverage/**', 'tools/agent-probe/*.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: [
      'src/core/**',
      'src/main/**',
      'src/preload/**',
      'tests/**',
      'tools/**',
      '*.{js,mjs,ts}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['resources/**/*.cjs', 'tests/**/*.cjs'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // core/ is plain Node: it must run in Docker and in CI without Electron.
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'src/core não pode importar electron.' }],
          patterns: [
            { group: ['electron/*'], message: 'src/core não pode importar electron.' },
            {
              group: ['**/main/**', '**/renderer/**', '**/preload/**'],
              message: 'src/core não depende das camadas do Electron.',
            },
          ],
        },
      ],
    },
  },
  {
    // The renderer never touches Node: everything goes through the preload contract.
    files: ['src/renderer/**'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'O renderer usa apenas window.api.' }],
          patterns: [
            {
              group: ['node:*', '@core/*', '**/core/**', '**/main/**'],
              message: 'O renderer não acessa Node.',
            },
          ],
        },
      ],
    },
  },
  {
    // Playwright scripts: Node code with callbacks that run inside the page.
    files: ['tools/**', 'tests/e2e/**', 'tests/smoke/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Tests feed raw terminal escape sequences to the parsers.
    files: ['tests/**'],
    rules: { 'no-control-regex': 'off' },
  },
  // One subject per file: past the limit, a file is split by subject. The files that were already
  // past it are listed with their size, which may only go down (tests/core/maxLines.test.ts).
  {
    files: ['src/**/*.{ts,tsx}'],
    // The texts of each language are one dictionary per language, not code to split.
    ignores: ['src/shared/i18n/**'],
    rules: { 'max-lines': ['error', { max: lineBaseline.limit }] },
  },
  ...Object.entries(lineBaseline.files).map(([file, max]) => ({
    files: [file],
    rules: { 'max-lines': ['error', { max }] },
  })),
  prettier,
);
