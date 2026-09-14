---
paths:
  - "package.json"
  - "apps/*/vite.config.js"
  - "apps/*/vercel.json"
  - ".env"
  - ".claude/launch.json"
  - "scripts/**"
---

# Development Workflow

## A. All Commands

### Root Scripts (`package.json`)
```bash
npm install              # Install all deps (MUST run from monorepo root)
npm run dev:research     # Research app (Vite, port 5180)
npm run dev:trading      # Trading app (Vite, port 5181)
npm run dev:server       # Express server (port 3001)
npm run dev:storybook    # spectre-ui Storybook (port 6006)
npm run build:research   # Production build - research
npm run build:trading    # Production build - trading
npm run build:ui         # Build spectre-ui library (Rollup)
npm run dev:desktop      # Electron desktop app (requires research build)
npm run build:desktop    # Build research + Electron (Mac DMG/zip)
```

### App-Specific Scripts
```bash
# Research (from apps/research/)
npm run dev:safe         # NODE_OPTIONS=--max-old-space-size=4096 (use if OOM from Remotion/Three.js)
npm run setup            # API key setup wizard (node scripts/setup-apis.mjs)
npm run remotion:studio  # Remotion video editor
npm run remotion:render  # Render Remotion video

# spectre-ui (from packages/spectre-ui/)
npm run test             # vitest
npm run test:a11y        # Storybook accessibility audit
npm run lint             # ESLint (only project with linting configured)

# Chrome extension (from packages/chrome-extension/)
npm run build            # esbuild (not Vite)
npm run watch            # Rebuild on change (fs.watch)
```

### Developer Control (standalone, NOT in workspaces)
```bash
cd developer-control && npm run dev    # Port 5182, has own serverless dev plugin
cd developer-control && npm run build  # Deployed separately to Vercel
```

---

## B. Parallel Worktree Port Setup

**BEFORE starting any dev server (`preview_start`), ALWAYS run:**
```bash
node scripts/setup-ports.js
```

This auto-detects which ports are in use and assigns a free slot to `.claude/launch.json`.

| Slot | Research | Trading | Server |
|------|----------|---------|--------|
| A    | 5180     | 5181    | 3001   |
| B    | 5182     | 5183    | 3002   |
| C    | 5184     | 5185    | 3003   |
| D    | 5186     | 5187    | 3004   |
| E    | 5188     | 5189    | 3005   |

How it works:
1. Reads `.claude/launch.json` - checks if current server port is still free
2. If free: keeps it, exits
3. If occupied: scans slots A-E, tests all 3 ports per slot
4. Writes first fully-free slot to `.claude/launch.json`

Both `vite.config.js` files read `../../.claude/launch.json` at startup to find the server port. Research also reads the trading port to inject `__TRADING_PORT__` (for iframe embedding).

**Important:** `bash` is NOT available as `runtimeExecutable` on Windows - always use `node`.

The server config in `launch.json` injects env vars inline via node `-e`:
```
node -e "process.env.PORT='3002';process.env.ADMIN_KEY='...';require('./packages/server/index.js')"
```

---

## C. Monorepo Structure

```
spectre-app/
  apps/
    research/          # @spectre/research - Vite + React, port 5180
    trading/           # @spectre/trading  - Vite + React, port 5181
  packages/
    server/            # @spectre/server   - Express, port 3001
    spectre-ui/        # @spectre/ui       - Storybook + Rollup, port 6006
    chrome-extension/  # spectre-chrome-extension (private, not in workspace scripts)
  developer-control/   # Standalone Vite app, NOT in workspaces, own Vercel deploy
  desktop/             # Electron wrapper, NOT in workspaces, own node_modules
  scripts/             # setup-ports.js, check-polymarket.js
  .env                 # Single env file at root, read by all via envDir
```

npm workspaces: `["apps/*", "packages/*"]`. Developer-control and desktop are outside workspaces.

`npm install` MUST run from the monorepo root to hoist dependencies correctly. Running inside a workspace package causes duplication.

---

## D. Vite Configuration

### Research App (`apps/research/vite.config.js`)

- Port: 5180, `host: '0.0.0.0'`, `open: true`
- Path alias: `@` -> `src/` (also in `jsconfig.json` for IDE support)
- Plugins: `@vitejs/plugin-react`, `vite-plugin-pwa`
- `envDir`: monorepo root (`../..`)
- `define`: `__APP_VERSION__`, `__TRADING_PORT__`
- Build target: `es2020`
- Production strip: `console.log`, `console.warn`, `debugger` removed via esbuild
- Manual chunks: `vendor-react`, `vendor-zustand`, `vendor-i18n`, `vendor-motion`, `vendor-remotion`, `vendor-html2canvas`, `vendor-d3`, `vendor-three`
- PWA: `registerType: 'autoUpdate'`, CacheFirst for token logos, NetworkFirst for `/api/*`
- `optimizeDeps.include`: `['@solana-program/memo', 'react-grid-layout']`

### Trading App (`apps/trading/vite.config.js`)

- Port: 5181, `host: '0.0.0.0'`, `open: true`
- **No** `@` alias (trading uses relative imports)
- Plugins: `@vitejs/plugin-react` only (no PWA)
- `envDir`: monorepo root
- Build target: `es2020`
- Manual chunks: `lightweight-charts`, `react-vendor`, `three-vendor`, `html2canvas`

### Developer Control (`developer-control/vite.config.js`)

- Port: 5182
- Custom `serverlessDev()` plugin that serves `api/*.js` files locally without Express
- Each `/api/routeName` request imports `api/{routeName}.js` on-the-fly (simulates Vercel functions)
- `envDir`: parent directory (`..` = monorepo root)

---

## E. Environment Variables

Single `.env` at monorepo root. Both Vite apps set `envDir` to `../..`. Express reads via `dotenv`.

### Server-Side Keys (NOT exposed to browser)
```
CODEX_API_KEY              # Required - Codex GraphQL
ANTHROPIC_API_KEY          # Optional - Monarch AI (Claude)
ANTHROPIC_MODEL            # Optional - model override (default: claude-sonnet-4-5-20250929)
OPENAI_API_KEY             # Optional - Monarch AI fallback
COINGECKO_API_KEY          # Optional - fallback market data
CMC_API_KEY                # Optional - CoinMarketCap Fear & Greed
FINNHUB_API_KEY            # Optional - stock analysts/earnings
CRYPTOPANIC_API_KEY        # Optional - news feed
CRYPTOCOMPARE_API_KEY      # Optional - news feed fallback
TAVILY_API_KEY             # Optional - web search tool for AI agents
PERPLEXITY_API_KEY         # Optional - AI search
TWITTER_BEARER_TOKEN       # Optional - fetch tweets
ELEVEN_LABS_API_KEY        # Optional - AI voice generation
ELEVENLABS_VOICE_ID        # Optional - override default voice
STABILITY_API_KEY          # Optional - image generation
POLYGON_API_KEY            # Optional - US market status
ADMIN_KEY                  # Optional - protects /api/env-check and admin endpoints
PORT                       # Optional - server port override (default: 3001)
```

### Frontend-Exposed Keys (must have `VITE_` prefix)
```
VITE_POSTHOG_KEY           # PostHog analytics capture key
VITE_PRIVY_APP_ID          # Privy auth (optional - app runs without it)
VITE_ETH_RPC_URL           # EVM RPC (fallback: public endpoints)
VITE_SOLANA_RPC_URL        # Solana RPC (fallback: mainnet-beta)
VITE_BSC_RPC_URL           # BSC RPC
VITE_POLYGON_RPC_URL       # Polygon RPC
VITE_ARB_RPC_URL           # Arbitrum RPC
VITE_BASE_RPC_URL          # Base RPC
```

**Rule**: only `VITE_*` vars are exposed to frontend code by Vite. All other keys stay server-side. Developer Control bypasses this with `Object.assign(process.env, loadEnv(...))` in its vite config.

---

## F. Vercel Deployment

### Research App (`apps/research/vercel.json`)

- `buildCommand`: `npm run build`, `outputDirectory`: `dist`, `framework`: `vite`
- Extensive `rewrites` array mapping URL patterns to serverless functions
- 27+ serverless functions in `apps/research/api/`
- Key rewrites: `/api/coingecko/:path` -> `cg-proxy`, `/api/stocks/*` -> `stocks`, `/api/intelligence/*` -> `intelligence-api`, `/api/calendar/*` -> `calendar-api`
- External proxies: `ext-api` -> Google Cloud Run, `spectre-api` -> Cloud Functions
- Catch-all: `/(.*) -> /index.html` (SPA fallback)

### Trading App (`apps/trading/vercel.json`)

- `cleanUrls: true`, minimal rewrites
- 9 serverless functions in `apps/trading/api/`
- Catch-all SPA fallback

### Developer Control (`developer-control/vercel.json`)

- `installCommand`: `cd ../.. && npm install` (installs from monorepo root)
- Own set of API functions: `github`, `vercel-proxy`, `health`, `claude-config`

### Dev vs Prod Gap

In dev, all 60+ routes are handled by Express. In prod, each needs its own serverless function. This is the primary source of "works in dev, breaks in prod" bugs. See `api-patterns.md` section C for the full route gap table.

---

## G. Git Worktrees

`.claude/worktrees/` contains named worktrees managed by Claude Code's `EnterWorktree`/`ExitWorktree` tools. No custom scripts - entirely handled by tool infrastructure.

Each worktree gets its own `node_modules/`, `.env`, and port slot via `setup-ports.js`.

### Git Branch Rules

- Working branch: `prod` (or feature branches like `gleb`)
- Never push directly to `main`
- Push workflow: commit on branch -> `git fetch origin main && git merge origin/main` -> `git push origin {branch}` -> `gh pr create --base main --head {branch}`

---

## H. Build Outputs

### Research
- Output: `apps/research/dist/`
- PWA service worker included
- `console.log`/`console.warn`/`debugger` stripped

### Trading
- Output: `apps/trading/dist/`

### spectre-ui
- Rollup: `dist/index.js` (CJS), `dist/index.esm.js` (ESM), `dist/index.d.ts`

### Chrome Extension
- esbuild: `packages/chrome-extension/dist/`
- 3 entry points as IIFE: content scripts (X/Twitter, DexScreener) + background service worker
- Target: `chrome120`
- Load `dist/` as "Load unpacked" in Chrome. Talks to `localhost:3001` - requires Express server.

### Desktop (Electron)
- Requires research build first (`npm run build:research`)
- `electron-builder` bundles `apps/research/dist/` as `extraResources`
- Targets: Mac (DMG + zip, arm64 + x64), Win (NSIS + portable)

---

## I. Screenshot Safety

**CRITICAL**: If Claude attempts to read a malformed or non-image file as an image, the session hangs permanently.

1. **NEVER** use `preview_screenshot` - it hangs on this project. Use `preview_snapshot`, `preview_inspect`, or `preview_eval` instead.
2. **ALWAYS** validate any screenshot file is actually a PNG before reading it:
```bash
file /tmp/screenshot.png | grep -q "PNG image" && echo "OK" || echo "FAILED"
```
3. If validation fails, do not attempt to read the file.
4. If a session becomes unresponsive after an image read, use `/clear` to recover.

---

## J. Linting & Testing

- **No ESLint** in either app or at root. Only `packages/spectre-ui/` has lint configured.
- **No Prettier** config exists anywhere.
- **No test files** in either app. Tests only in `packages/spectre-ui/` via `vitest`.
- **No CI/CD** - no `.github/` directory. Deployments via Vercel Git integration + manual `gh pr create`.
- Both Vite apps set `build.target: 'es2020'` - modern browsers only, no IE11.

---

## K. "Run App" Means All Servers

When told to "run the app" or "start dev", start all servers needed:

| Server | Command | Port |
|--------|---------|------|
| Express | `npm run dev:server` | 3001 (or launch.json slot) |
| Research | `npm run dev:research` | 5180 (or launch.json slot) |
| Trading | `npm run dev:trading` | 5181 (or launch.json slot) |
| Storybook | `npm run dev:storybook` | 6006 |

Research and trading both proxy to Express - if Express isn't running, all `/api` calls fail silently (no error page, just empty data).
