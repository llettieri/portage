import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import wxtAutoImports from './packages/ext/.wxt/eslint-auto-imports.mjs';

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': ['warn'],
      '@typescript-eslint/method-signature-style': ['error'],
      '@typescript-eslint/no-unused-vars': 'error',
      camelcase: ['warn'],
      indent: ['error', 2],
      'no-console': ['warn'],
      'no-duplicate-imports': ['error'],
      'no-empty': ['error'],
      'no-empty-character-class': ['error'],
      'no-empty-pattern': ['error'],
      'no-ex-assign': ['error'],
      'no-extra-boolean-cast': ['error'],
      'no-extra-semi': ['error'],
      'no-fallthrough': ['error'],
      'no-func-assign': ['error'],
      'no-global-assign': ['error'],
      'no-import-assign': ['error'],
      'no-inner-declarations': ['error'],
      'no-invalid-regexp': ['error'],
      'no-irregular-whitespace': ['error'],
      'no-loss-of-precision': ['error'],
      'no-misleading-character-class': ['error'],
      'no-mixed-spaces-and-tabs': ['error'],
      'no-new-symbol': ['error'],
      'no-nonoctal-decimal-escape': ['error'],
      'no-obj-calls': ['error'],
      'no-octal': ['error'],
      'no-prototype-builtins': ['error'],
      'no-redeclare': ['error'],
      'no-regex-spaces': ['error'],
      'no-self-assign': ['error'],
      'no-setter-return': ['error'],
      'no-shadow-restricted-names': ['error'],
      'no-sparse-arrays': ['error'],
      'no-this-before-super': ['error'],
      'no-unexpected-multiline': ['error'],
      'no-unreachable': ['error'],
      'no-unsafe-finally': ['error'],
      'no-unsafe-negation': ['error'],
      'no-unsafe-optional-chaining': ['error'],
      'no-unused-labels': ['error'],
      'no-useless-backreference': ['error'],
      'no-useless-catch': ['error'],
      'no-useless-escape': ['error'],
      'no-with': ['error'],
      quotes: ['error', 'single', { avoidEscape: true }],
      'require-await': ['warn'],
      'require-yield': ['error'],
      semi: ['error'],
      'use-isnan': ['error'],
      'valid-typeof': ['error'],
    },
  },
  // Only `packages/ext` is a React app (WXT + browser extension popup) — the hooks
  // rules and WXT's auto-import globals (browser, defineBackground, useState, ...)
  // don't apply to `protocol` (plain TS lib) or `hub` (Cloudflare Worker).
  {
    ...reactHooks.configs.flat['recommended-latest'],
    files: ['packages/ext/**/*.{ts,tsx}'],
  },
  {
    files: ['packages/ext/**/*.{ts,tsx}'],
    languageOptions: {
      globals: wxtAutoImports.languageOptions.globals,
    },
  },
  // Plain Node scripts (build/tooling scripts, root config files) — not covered by
  // typescript-eslint's recommended config, which only turns off no-undef for TS files.
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  globalIgnores([
    '**/dist/**',
    '**/.output/**',
    '**/.wxt/**',
    '**/*.tsbuildinfo',
  ]),
]);

export default eslintConfig;
