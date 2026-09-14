import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))

// Vite doesn't auto-populate process.env from .env; the dev-server proxy `headers`
// block reads process.env directly, so we must lift .env into it manually here.
Object.assign(process.env, loadEnv('development', path.resolve(__dirname, '../..'), ''))

// Auto-detect ports from .claude/launch.json (supports parallel worktrees)
function getLaunchConfig() {
  try {
    const launchPath = path.resolve(__dirname, '../../.claude/launch.json')
    return JSON.parse(readFileSync(launchPath, 'utf8'))
  } catch {
    return { configurations: [] }
  }
}

// PR-1 (perf): make the Vite-injected entry stylesheet non-render-blocking.
// Browsers block ALL painting on any pending head stylesheet, so the inline
// boot skeleton never painted at TTFB - first paint waited for the full entry
// CSS to download (measured prod FCP 9.8s cold). The media="print" trick
// downloads the CSS without blocking paint, then flips to media="all" onload.
// Zero FOUC window: the opaque #boot-skeleton overlays the viewport and
// main.jsx gates the React mount on this stylesheet being loaded.
function nonBlockingEntryCss() {
  return {
    name: 'spectre-non-blocking-entry-css',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet"([^>]*?)\shref="(\/assets\/[^"]+\.css)"([^>]*)>/g,
        (m, pre, href, post) =>
          `<link rel="preload" as="style"${pre} href="${href}"${post}>` +
          `<link rel="stylesheet"${pre} href="${href}"${post} media="print" onload="this.media='all'">` +
          `<noscript><link rel="stylesheet"${pre} href="${href}"${post}></noscript>`
      )
    },
  }
}

const launch = getLaunchConfig()
// A second worktree's Express server routinely owns 3001, and the proxy then
// sends this app's /api calls to a checkout that does not have its routes —
// which surfaces as an endpoint 404ing in dev while existing on disk. Let the
// port be named explicitly so a worktree can run its own server beside it.
const API_PORT = Number(process.env.RESEARCH_API_PORT)
  || launch.configurations.find(c => c.name === 'server')?.port || 3001
const TRADING_PORT = launch.configurations.find(c => c.name === 'trading')?.port || 5181
const DASHBOARD_API_BASE = (process.env.DASHBOARD_API_BASE_URL || process.env.X_DASH_BASE || 'http://5.78.199.87:8092').replace(/\/+$/, '')
const DASHBOARD_API_KEY = process.env.XDASH_API_TOKEN || process.env.DASHBOARD_API_KEY || process.env.X_DASH_API_KEY || ''
// Canonical auth scheme per the X Dash backend is `Authorization: Bearer <token>`
// (it also accepts X-API-Key). Send both so the proxy works regardless.
const DASHBOARD_AUTH_HEADERS = DASHBOARD_API_KEY
  ? { 'Authorization': `Bearer ${DASHBOARD_API_KEY}`, 'x-api-key': DASHBOARD_API_KEY }
  : {}

export default defineConfig({
  root: __dirname,
  envDir: path.resolve(__dirname, '../..'),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // PR-1 (perf): registerSW.js was injected as a synchronous parser-blocking
      // <script> in <head> - the body (incl. the boot skeleton) could not parse
      // until it was fetched and run. 'script-defer' adds the defer attribute;
      // registration semantics are unchanged (it already waits for window load).
      injectRegister: 'script-defer',
      manifest: false, // Use existing /public/manifest.json
      workbox: {
        // PRECACHE: only the small static shell (HTML + icons + images). The
        // previous '**/*.{js,css,...}' glob precached EVERY route chunk on the
        // first visit - vendor-three (939KB), recharts, d3, lightweight-charts,
        // every page - ~918 entries / ~145MB downloaded before the user did
        // anything. JS/CSS/fonts now load on demand via runtimeCaching below
        // (StaleWhileRevalidate), so the cold first paint pulls only what the
        // current route needs; repeat navigation is still served from cache.
        // index.html stays precached + revisioned so deploys update atomically.
        // PNGs are excluded too: public/ holds large marketing/hero images
        // (~120MB) that the first visit doesn't need - images go to
        // runtimeCaching (CacheFirst) and cache on first actual use.
        globPatterns: ['**/*.{html,ico,svg,webmanifest}'],
        globIgnores: ['**/charting_library/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
        runtimeCaching: [
          {
            // App JS/CSS chunks - cached on first real use, then served from
            // cache (revalidated in background). Vite content-hashes filenames
            // so a new deploy is a cache miss that self-populates; the
            // vite:preloadError handler in main.jsx remains the stale-chunk
            // safety net.
            // 🪤 /charting_library/** is excluded here as well as from
            // globPatterns above. globIgnores only keeps TradingView out of the
            // PRECACHE - this rule was still catching every one of its ~40
            // same-origin bundles at runtime. Two ways that broke the chart:
            // the 300-entry LRU evicts by write, so the app's own chunks and
            // TV's bundles knocked each other out mid-boot; and StaleWhileRevalidate
            // serves the cached STABLE-named charting_library.js loader first, so
            // after a library upgrade it asks for a library.<oldhash>.js that no
            // longer exists - the widget never constructs and the pane sits on
            // "LOADING TRADINGVIEW" forever (nothing surfaces that inner 404).
            // The bundles are content-hashed and now served immutable
            // (apps/research/vercel.json), so the HTTP cache is the right owner.
            urlPattern: ({ request, url }) =>
              url.origin === self.location.origin &&
              !url.pathname.startsWith('/charting_library/') &&
              (request.destination === 'script' || request.destination === 'style'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'app-assets',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          },
          {
            // Self-hosted fonts (immutable, content-hashed) - CacheFirst.
            urlPattern: ({ request, url }) =>
              url.origin === self.location.origin && request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-fonts',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            // Same-origin images (logos, hero/marketing PNGs) - cache on first
            // use instead of precaching ~120MB upfront.
            urlPattern: ({ request, url }) =>
              url.origin === self.location.origin && request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-images',
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          },
          {
            urlPattern: /^https:\/\/assets\.coingecko\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              // 2026-05-28: bumped cache name to v2 so the previous
              // 'token-logos' cache (which could wedge a broken response for
              // BTC/ETH/SOL for up to 7d if the first write happened during
              // an upstream blip) is abandoned on next SW update. Also dropped
              // TTL from 7d to 24h so a future bad write self-heals fast.
              cacheName: 'token-logos-v2',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 }
            }
          },
          {
            // NetworkFirst caches /api/* responses but emits noisy "no-response"
            // errors in the browser console when the underlying fetch fails or
            // returns 4xx/5xx — workbox treats those as un-cacheable. Skip the
            // known-problematic paths so the console stays clean:
            //   /api/market/*  → auth-gated, 401 for anon users (by design)
            //   /api/data-api/* → upstream Spectre Data API, 403 unauth (by design)
            //   /api/fear-greed/movers → known slow cold-start
            //   /api/binance-ticker → Binance blocks Vercel IPs, allorigins
            //     fallback is flaky (see .claude/rules/data-sources.md section H)
            urlPattern: ({ url }) => {
              if (!url.pathname.startsWith('/api/')) return false
              if (url.pathname.startsWith('/api/market/')) return false
              if (url.pathname.startsWith('/api/data-api/')) return false
              if (url.pathname === '/api/fear-greed/movers') return false
              if (url.pathname === '/api/binance-ticker') return false
              // Auth state must always be live - never served from a (up to 5min)
              // stale SW cache. These also carry the rolling Set-Cookie (session
              // refresh + resume token), which the SW cache path would swallow.
              if (url.pathname === '/api/auth-gate') return false
              if (url.pathname === '/api/beta-access') return false
              // Per-user data must never be served from the (up to 5min) stale SW
              // cache. Cross-device watchlist sync GETs /api/user/watchlists-research
              // on load; a stale cached body (missing another device's change) gets
              // union-merged and pushed back, CLOBBERING that change on the server.
              // Personal data is not safely cacheable here - always go to network.
              if (url.pathname.startsWith('/api/user/')) return false
              return true
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-data',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 5 }
            }
          }
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        skipWaiting: true,
        clientsClaim: true,
        // Without this, every deploy leaves the previous build's precache
        // entries in CacheStorage forever. After ~3 deploys the browser holds
        // 3 generations of index.html + hashed JS, and clients with a stale
        // SW serve old index.html → request old JS chunk hashes that no
        // longer exist on Vercel → black screen until the user hard-refreshes.
        // Sweeping the old precache on activation is the standard fix.
        cleanupOutdatedCaches: true
      },
      devOptions: { enabled: false }
    }),
    nonBlockingEntryCss()
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __TRADING_PORT__: TRADING_PORT,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'react': path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
      'react-router-dom': path.resolve(__dirname, '../../node_modules/react-router-dom'),
      // Force ONE copy of three. drei pulls a nested stats-gl/three@0.170 while
      // the ConstellationEngine + @react-three/fiber use root three@0.182 — two
      // copies break R3F (the "Multiple instances of Three.js" warning): the
      // reconciler's instanceof checks fail and the R3F store/invalidate target
      // the wrong instance, freezing the canvas at its 300×150 default.
      'three': path.resolve(__dirname, '../../node_modules/three'),
    },
    dedupe: ['react', 'react-dom', 'react-router-dom', 'three'],
  },
  // Privy's Solana module + react-grid-layout need pre-bundling at dev time
  // Force React through root node_modules to prevent duplicate instances from war-room/spectre-forge
  optimizeDeps: {
    // Pre-bundle @privy-io/react-auth (+ its Solana module) at server start.
    // Otherwise Vite first DISCOVERS this huge dep tree when the lazy
    // privy-provider-lazy chunk loads ~2s after first paint, re-optimizes deps
    // mid-session, and the in-flight dynamic import 504s -> "Failed to fetch
    // dynamically imported module". Pre-bundling moves that work to boot so the
    // chunk loads cleanly. (@reown/appkit stays excluded - it ships pre-bundled
    // ESM and breaks esbuild's optimizer.)
    include: ['@privy-io/react-auth', '@solana-program/memo', 'react-grid-layout', 'react', 'react-dom', 'react-router-dom'],
    exclude: ['@phosphor-icons/webcomponents', '@reown/appkit', '@reown/appkit-ui', '@reown/appkit-core', '@reown/appkit-common', '@reown/appkit-wallet'],
  },
  build: {
    // Keep the ~1.8MB Privy wallet chunk (and its web3 `core` sibling) OUT of
    // every modulepreload dep list. Vite emits `<link rel="modulepreload">`
    // for a dynamic import's whole dep graph at the CALL SITE, which fires
    // before the import itself - so the app-level gate in privy-boundary
    // (which defers the actual `import()` until after the app has painted)
    // was being bypassed by the preload link: measured landing at ~540ms,
    // right through the middle of the first render, on the boot critical
    // path. Filtering the dep here means the bytes are fetched only when the
    // gated import actually runs. Nothing above the fold needs the wallet
    // stack, and the app is fully interactive on the Privy stub until then.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((d) => !/privy-provider-lazy|(^|\/)core-[A-Za-z0-9_-]+\.js$/.test(d)),
    },
    rollupOptions: {
      output: {
        // PR-2 (perf): FUNCTION form, not object form. The object form let
        // Rollup colocate shared internals (Vite's __vitePreload helper, the
        // react-dom/client facade) INTO vendor chunks - the entry chunk ended
        // up statically importing vendor-three (939KB raw), so EVERY page
        // booted through three.js even though only /world uses it. The
        // function form assigns ONLY the named packages to vendor chunks;
        // shared helpers stay in the entry.
        //
        // NOTE: do NOT add cases for @solana/web3.js, @privy-io/react-auth,
        // ethers, or buffer. Their modules reference Node's `Buffer` global at
        // top-level evaluation. The Buffer polyfill in main.jsx (window.Buffer
        // = Buffer) only runs after main.jsx body executes, which is too late
        // if those packages are in standalone vendor chunks that the entry
        // imports - ESM evaluates leaf modules first, so they crash with
        // "Buffer is not defined" before the polyfill is set up, taking down
        // the whole app (blank black page). Keeping them bundled with their
        // consumer chunks is fine because those load lazily after main.jsx.
        manualChunks(id) {
          // Vite/Rollup virtual helper modules (preload helper, modulepreload
          // polyfill, commonjs helpers) are imported by EVERY chunk. Without an
          // explicit home, Rollup colocates them INTO one of the manual vendor
          // chunks - the entry then statically imports vendor-three (939KB raw)
          // just to reach a 1KB helper, putting three.js back on every page's
          // boot path. Pin them to a tiny dedicated chunk instead.
          // IMPORTANT: match ONLY these specific virtuals. A blanket \0 test
          // also catches commonjs PROXY modules (\0...?commonjs-proxy) for
          // buffer/@solana/@walletconnect - hoisting those into an entry-
          // imported chunk evaluates them before main.jsx sets window.Buffer
          // (the documented blank-black-page landmine).
          if (id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill') || id.includes('commonjsHelpers')) {
            return 'chunk-helpers'
          }
          if (id.startsWith('\0')) return undefined
          if (!id.includes('node_modules')) return undefined
          const m = id.match(/node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?((?:@[^\\/]+[\\/])?[^\\/]+)/)
          const pkgName = m ? m[1].replace(/\\/g, '/') : ''
          // Tiny react-ecosystem utilities used EAGERLY (zustand -> use-sync-
          // external-store, react-i18next -> react-is, react-dom -> scheduler).
          // Without a pin Rollup colocated them inside vendor-recharts, which
          // dragged recharts onto every page's boot path.
          if (pkgName === 'scheduler' || pkgName === 'react-is' || pkgName === 'use-sync-external-store' || pkgName === 'prop-types') {
            return 'vendor-react'
          }
          // The full d3 transitive family (recharts depends on d3-shape/scale/
          // array/time; force-graphs use d3-force/zoom). One lazy chunk keeps
          // any of it from being colocated into - or pulling in - the entry.
          if (pkgName.startsWith('d3-') || pkgName === 'internmap') return 'vendor-d3'
          // Small pure-JS libs shared between recharts and the wallet stacks
          // (eventemitter3, redux family via @reown/appkit, clsx...). Pinning
          // them keeps vendor-recharts recharts-only so nothing eager ever
          // needs to import it. All Buffer-free - safe to evaluate pre-entry.
          switch (pkgName) {
            case 'eventemitter3':
            case 'clsx':
            case 'reselect':
            case 'redux':
            case '@reduxjs/toolkit':
            case 'redux-thunk':
            case 'immer':
            case 'react-redux':
            case 'es-toolkit':
            case 'decimal.js-light':
            case 'tiny-invariant':
              return 'vendor-shared'
          }
          switch (pkgName) {
            case 'react':
            case 'react-dom':
            case 'react-router':
            case 'react-router-dom':
              return 'vendor-react'
            case 'zustand':
              return 'vendor-zustand'
            case 'i18next':
            case 'react-i18next':
              return 'vendor-i18n'
            case 'framer-motion':
              return 'vendor-motion'
            case 'remotion':
            case '@remotion/player':
              return 'vendor-remotion'
            case 'html2canvas':
              return 'vendor-html2canvas'
            case 'd3-force':
            case 'd3-zoom':
            case 'd3-selection':
              return 'vendor-d3'
            case 'three':
            case '@react-three/fiber':
            case '@react-three/drei':
              return 'vendor-three'
            case 'recharts':
              return 'vendor-recharts'
            case 'lightweight-charts':
              return 'vendor-lightweight-charts'
            default:
              return undefined
          }
        },
      },
    },
    // Strip console.log/warn in production (keep console.error for debugging)
    minify: 'esbuild',
    target: 'es2020',
  },
  // The ConstellationEngine's physics worker (components/constellation/
  // sim.worker.js) is an ES module — it `import`s from d3-force and is created
  // via `new Worker(new URL('./sim.worker.js', import.meta.url), { type:'module' })`.
  // Vite defaults worker.format to 'iife', which can't carry ESM imports; force
  // 'es' so the prod worker chunk keeps its imports. The worker still gets the
  // vendor-d3 split via the same manualChunks rules.
  worker: {
    format: 'es',
  },
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
    pure: process.env.NODE_ENV === 'production' ? ['console.log', 'console.warn'] : [],
  },
  server: {
    port: 5180,
    host: '0.0.0.0',
    open: true,
    proxy: {
      '/data-api': {
        // Spectre Data Bridge (institutional scores, discovery, etc.)
        // Backend expects /v1/* paths directly and requires X-API-Key header.
        // See apps/research/src/pages/ventures/components/ventures-api.js
        target: 'http://204.168.244.18:3850',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/data-api/, ''),
        headers: {
          // Same key, two historical names: serverless handlers read
          // SPECTRE_DATA_API_KEY, this proxy grew up as _BRIDGE_KEY. Accept
          // either so a dev who sets the canonical name gets working
          // data-api panels instead of a silent 401 wall (Gleb 2026-06-12).
          'X-API-Key': process.env.SPECTRE_DATA_BRIDGE_KEY
            || process.env.SPECTRE_DATA_API_KEY
            || 'spectre_dev_internal_key_change_me',
        },
      },
      '/spectre-market-api': {
        // Browser-safe bridge to the deployed Spectre API. Keep this before
        // the generic /api proxy so local dev does not require localhost:3001.
        target: 'https://api.spectreai.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/spectre-market-api/, '/api'),
      },
      '/api/deriv-agg': {
        target: 'http://localhost:3847',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/deriv-agg/, '/api/derivatives')
      },
      /* /api/coingecko/* MUST go through our Express server so the
         COINGECKO_API_KEY header is added (Pro plan = 500/min) and the
         shared cgFetch queue + retry-on-429 work. The previous direct
         proxy to api.coingecko.com sent unauthenticated requests and
         got rate-limited on the 4th-5th drawer. The /api catch-all
         below (-> localhost:${API_PORT}) handles this now. */
      '/polymarket-gamma': {
        target: 'https://gamma-api.polymarket.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/polymarket-gamma/, ''),
      },
      // Spectre-DERIVED X Dash endpoints (constellation, leaderboard-rollup,
      // track-record, momentum-origin) live in LOCAL Express — they call the
      // Hetzner data API, they are NOT on the dashboard service (which 404s
      // them, rewriting /api/xdash/constellation -> /api/constellation). Route
      // these to localhost so dev gets real data. MUST sit before /api/xdash.
      '/api/xdash/constellation': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/api/xdash/leaderboard-rollup': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/api/xdash/track-record': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/api/xdash/momentum-origin': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/api/xdash/early-runners': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      // leaderboard + thesis are LOCAL Express-computed (Hetzner-derived), NOT on
      // the dashboard upstream (which 404s them) - route to localhost like the
      // derived endpoints above. Must stay before /api/xdash. (leaderboard-rollup
      // above is matched first, so it keeps its own rule.)
      // bootstrap is served by the box, but our Express wrapper is not a pass-
      // through: it runs postProcessBootstrapMentions and the zeroed-window
      // backfill. Proxying straight to the upstream skipped BOTH in dev, so the
      // board rendered differently here than on prod (where vercel.json routes it
      // through the serverless twin). Route it to localhost for parity.
      '/api/xdash/bootstrap': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/api/xdash/leaderboard': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/api/xdash/thesis': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/api/xdash': {
        target: DASHBOARD_API_BASE,
        changeOrigin: true,
        // The upstream keeps most routes under /api/* (so /api/xdash/bootstrap
        // -> /api/bootstrap) but the leaderboard bundle lives under
        // /api/xdash/leaderboard-bundle - preserve that path, strip /xdash
        // from everything else.
        rewrite: (path) => (
          path.startsWith('/api/xdash/leaderboard-bundle')
            ? path
            : path.replace(/^\/api\/xdash/, '/api')
        ),
        headers: { ...DASHBOARD_AUTH_HEADERS },
      },
      '/api/x-beta': {
        target: DASHBOARD_API_BASE,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/x-beta/, '/api'),
        headers: { ...DASHBOARD_AUTH_HEADERS },
      },
      // Momentum / Potential Gainers — the upstream path IS /api/momentum/*,
      // so this proxy hits the dashboard API directly with NO rewrite. Must
      // sit before the generic /api entry (more specific paths win first).
      '/api/momentum': {
        target: DASHBOARD_API_BASE,
        changeOrigin: true,
        headers: { ...DASHBOARD_AUTH_HEADERS },
      },
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true
      },
      '/og': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true
      },
      '/coingecko': {
        target: process.env.COINGECKO_API_KEY
          ? 'https://pro-api.coingecko.com/api/v3'
          : 'https://api.coingecko.com/api/v3',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/coingecko/, ''),
        headers: process.env.COINGECKO_API_KEY
          ? { 'x-cg-pro-api-key': process.env.COINGECKO_API_KEY }
          : {},
      },
      '/tweets-api': {
        target: 'https://api.spectreai.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tweets-api/, '')
      },
      '/spectre-api': {
        target: 'https://us-central1-third-opus-411016.cloudfunctions.net/SearchEngineApiV4',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/spectre-api/, '')
      }
    }
  }
})
// force vercel rebuild 1776029329
// vercel rebuild 1776029780
