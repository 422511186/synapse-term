import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/out/**',
      '**/.packaging/**',
      '**/.tmp-*/**',
      '**/playwright-report/**',
      '**/release/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
