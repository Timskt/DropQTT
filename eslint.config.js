import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'src-tauri/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // A stale dependency array is how a UI keeps showing data that already
      // changed; it is the exact class tsc cannot see, so it stays an error.
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
      // Both of these are React-compiler era rules that fire on idiomatic
      // polling-hook code (setState after an await, Date.now() for a relative
      // timestamp). Making them errors would buy 10 rewrites and no safety.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // The mocked-IPC test doubles and the Tauri event payloads are genuinely
      // dynamic; forcing `any` away there buys ceremony, not safety.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Specs assign hand-built shapes onto window; typing them fully would
      // mean duplicating Tauri's own types for no gain.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['*.ts', '*.js', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
);
