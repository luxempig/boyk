import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettierPlugin from 'eslint-plugin-prettier/recommended'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'

export default defineConfig([
  globalIgnores([
    'dist',
    'dist-extension',
    'api',
    'scripts',
    // Python data pipeline and its Node tooling — not browser code.
    'pipeline',
    'chrome-extension/tests',
    'e2e',
    'playwright.config.js',
    // Tooling / worktree / build-output dirs that contain vendored or minified
    // JS. ESLint does not read .gitignore, so these (all gitignored) would
    // otherwise be traversed and produce thousands of phantom errors.
    '.worktrees',
    '.playwright-mcp',
    'playwright-report',
    'test-results',
    'coverage',
    // Deno edge functions — separate runtime/toolchain, not browser globals.
    'supabase',
    // Swift app + non-source asset dirs.
    'ios',
  ]),
  // Base configs
  js.configs.recommended,
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  // This disables conflicting rules and adds the prettier plugin
  prettierPlugin,

  // Chrome extension config (must come before general config to override)
  {
    files: ['chrome-extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        chrome: 'readonly',
      },
      sourceType: 'script',
    },
    rules: {
      'no-empty': 'warn',
      'no-case-declarations': 'off',
      'prettier/prettier': 'off',
      'simple-import-sort/imports': 'off',
      'simple-import-sort/exports': 'off',
      'unused-imports/no-unused-imports': 'off',
      'unused-imports/no-unused-vars': 'off',
    },
  },

  // Custom config
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      react,
      'react-refresh': reactRefresh,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // Modal overlays with role="dialog" legitimately need onClick/onKeyDown
      'jsx-a11y/no-noninteractive-element-interactions': [
        'warn',
        { handlers: ['onClick', 'onMouseDown', 'onMouseUp', 'onKeyPress', 'onKeyDown', 'onKeyUp'] },
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      // Catch JSX tags referencing undefined/unimported components. Plain
      // no-undef does NOT flag JSX identifiers, so without this an unimported
      // component (e.g. a missing modal import) ships and crashes at runtime.
      'react/jsx-no-undef': 'error',

      // Simple Import Sort
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // Unused Imports - check after jsx-uses-vars marks them as used
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^[A-Z_]', args: 'after-used', argsIgnorePattern: '^_' },
      ],
    },
  },
])
