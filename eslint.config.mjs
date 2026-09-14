import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * Monorepo lint config.
 *
 * There was no working linter here before this file: the only `lint` script in
 * the repo (packages/spectre-ui) called an `eslint` binary that was never
 * installed, with an `--ext` flag that ESLint 9 removed. So nothing has ever
 * checked hook dependencies, unreachable code or undefined identifiers.
 *
 * The rule set is deliberately narrow. This is a large codebase written without
 * a linter, so turning on a standard preset would bury real findings under
 * thousands of stylistic ones and nobody would read the output. Everything here
 * catches a BUG, not a preference:
 *
 *   - hook rules: the class of bug that produces stale closures and infinite
 *     re-render loops (see the `getAccessToken` trap in .claude/rules/privy.md)
 *   - no-undef: typos and missing imports that only fail at runtime, on the one
 *     code path nobody clicked
 *   - no-unused-vars: dead imports and forgotten bindings
 *
 * Formatting rules are intentionally absent - Prettier's job, and not this PR's.
 * Add rules as the codebase gets clean enough to hold them, never the reverse.
 */

const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.vercel/**',
  '**/storybook-static/**',
  '**/public/charting_library/**',
  '**/coverage/**',
  'packages/server/content/**',
  'packages/server/data/**',
  // Every top-level dot-directory is vendored agent tooling (.agent, .cline,
  // .codebuddy, .continue, ... - 25 of them, each carrying the same 4 skill
  // scripts) plus .claude's own worktrees. None of it is ours to lint, and one
  // of the vendored scripts does not even parse.
  '.*/**',
]

/** Rules that catch bugs. Shared by every block below. */
const bugRules = {
  ...js.configs.recommended.rules,

  // `catch {}` / `catch { /* noop */ }` is a deliberate, pervasive idiom here -
  // best-effort work that must never break boot. Flagging it would be noise.
  'no-empty': ['error', { allowEmptyCatch: true }],

  // Unused function ARGS are usually signature documentation (event handlers,
  // callbacks). Unused VARIABLES are dead code worth seeing. Leading-underscore
  // opts out explicitly.
  'no-unused-vars': ['warn', {
    args: 'none',
    varsIgnorePattern: '^_',
    caughtErrors: 'none',
    ignoreRestSiblings: true,
  }],

  // The codebase logs deliberately (console.error for debuggability, per
  // .claude/rules/workflow.md). A pre-commit hook already blocks console.log
  // in research src.
  'no-console': 'off',

  // `if (false && ...)` / `{false && (...)}` is how this codebase parks a
  // block it has deliberately switched off, always with a comment saying why
  // (see useChartData.js and chart-panel.jsx - one already carries a hand-
  // written eslint-disable for exactly this). Warn so it stays visible;
  // erroring would just mean 11 disable comments.
  'no-constant-condition': 'warn',
  'no-constant-binary-expression': 'warn',
}

export default [
  { ignores },

  // ---- App source: browser + React ----
  {
    files: ['apps/*/src/**/*.{js,jsx}', 'developer-control/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        // Vite `define` constants (see each app's vite.config.js) - real at
        // build time, invisible to a static read.
        __APP_VERSION__: 'readonly',
        __TRADING_PORT__: 'readonly',
        __RESEARCH_PORT__: 'readonly',
        // Polyfilled onto window in main.jsx before anything else - the Solana
        // stack needs it. See the Buffer trap in .claude/rules/privy.md D7.
        Buffer: 'readonly',
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...bugRules,
      // A hook called conditionally or out of order is always a bug.
      'react-hooks/rules-of-hooks': 'error',
      // Warn, not error: a missing dep is usually a stale-closure bug, but this
      // codebase has deliberate omissions with a comment explaining why. Read
      // each one; do not blanket-disable.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ---- Serverless functions + shared api libs: node ----
  {
    files: ['apps/*/api/**/*.{js,mjs}', 'packages/api-shared/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: bugRules,
  },

  // ---- Express server + CommonJS tooling ----
  {
    files: ['packages/server/**/*.js', 'scripts/**/*.{js,cjs}', 'apps/*/scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: bugRules,
  },

  // ---- ESM tooling ----
  // `.mjs` is ESM by definition; parsing it as commonjs makes every `import`
  // a syntax error, which is what the first draft of this config did.
  {
    files: ['scripts/**/*.mjs', 'apps/*/scripts/**/*.mjs', 'packages/server/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: bugRules,
  },

  // ---- Code that RUNS IN A PAGE, but lives outside an app ----
  // scripts/theme-audit/* bodies are handed to Playwright page.evaluate, and
  // packages/server/public/* is served to the browser. Both are browser
  // context despite sitting in node-shaped folders.
  {
    files: [
      'scripts/theme-audit/**/*.{js,cjs}',
      'packages/server/public/**/*.js',
      'apps/*/scripts/prerender.mjs',
    ],
    languageOptions: {
      ecmaVersion: 2023,
      // `module` also parses the CommonJS files here fine (they use require(),
      // which is just a call expression); the reverse is not true - .mjs would
      // fail to parse as commonjs.
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: bugRules,
  },

  // ---- Tests: node + vitest globals come from imports, so just node ----
  {
    files: ['apps/*/tests/**/*.{js,jsx}', '**/__tests__/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: bugRules,
  },
]
