import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

// Auto-detect ports from .claude/launch.json (supports parallel worktrees)
function getLaunchConfig() {
  try {
    const launchPath = resolve(__dirname, '../../.claude/launch.json')
    return JSON.parse(readFileSync(launchPath, 'utf8'))
  } catch {
    return { configurations: [] }
  }
}

const launch = getLaunchConfig()
const API_PORT = launch.configurations.find(c => c.name === 'server')?.port || 3001
const RESEARCH_PORT = launch.configurations.find(c => c.name === 'research')?.port || 5180

// GP6: expose the hashed chart-chunk paths to the index.html boot script so a
// #token/ deep link can <link rel="modulepreload"> them - TradingChart (~100KB)
// and lightweight-charts (~160KB) then download IN PARALLEL with the main
// bundle instead of serially after Suspense mounts. Build-only: dev serves
// unhashed sources, so the boot script's `window.__SPECTRE_CHUNKS` check
// simply finds nothing and skips. #discover never preloads them (the boot
// script is hash-gated).
function spectreChunkHints() {
  return {
    name: 'spectre-chunk-hints',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return
        let tradingChart = null
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (chunk.type !== 'chunk') continue
          if (chunk.name === 'TradingChart') tradingChart = '/' + fileName
        }
        // lightweight-charts is deliberately NOT hinted: TradingChart no longer
        // imports it statically (only the Holders placeholder pulls it, on
        // demand), so preloading it would re-add 55 kB gzip that the page never
        // executes. See the loader comment in TradingChart.jsx.
        if (!tradingChart) return
        return [{
          tag: 'script',
          injectTo: 'head-prepend', // before the authored boot script
          children: `window.__SPECTRE_CHUNKS=${JSON.stringify({ tradingChart })}`,
        }]
      },
    },
  }
}

// Dev parity for the self-hosted TradingView charting_library caching. Prod
// already sets immutable headers via apps/trading/vercel.json:58-70, but Vite's
// dev server serves public/ with no Cache-Control, so the 21MB of library
// bundles re-download on every dev/preview reload (a big slice of the TV chart's
// cold-load time locally). Mirror the prod values so dev reloads hit disk cache.
function chartingLibraryDevCache() {
  return {
    name: 'charting-library-dev-cache',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (url.startsWith('/charting_library/bundles/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        } else if (url.startsWith('/charting_library/')) {
          res.setHeader('Cache-Control', 'public, max-age=3600')
        }
        next()
      })
    },
  }
}

export default defineConfig({
  root: __dirname,
  envDir: resolve(__dirname, '../..'),
  plugins: [react(), spectreChunkHints(), chartingLibraryDevCache()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __RESEARCH_PORT__: RESEARCH_PORT,
  },
  resolve: {
    alias: {
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
    exclude: ['@phosphor-icons/webcomponents', '@reown/appkit', '@reown/appkit-ui', '@reown/appkit-core', '@reown/appkit-common', '@reown/appkit-wallet'],
  },
  server: {
    port: 5181,
    host: '0.0.0.0',
    open: true,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        // Identify the caller to the shared Express server. Both apps proxy
        // /api here, but in PROD each hits its OWN serverless handler, and
        // those have diverged (see the /api/bars delegate in
        // packages/server/index.js). Without this stamp a trading dev session
        // silently exercises the RESEARCH bars path.
        headers: { 'x-spectre-app': 'trading' }
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        // GP9 (function form): split the heavy vendors out of the entry so it
        // parses fast and stays cache-stable across deploys.
        //
        // Buffer-eval-order contract (the historical blank-page trap):
        // @privy-io + @solana/web3.js touch Node's `Buffer` global at top-level
        // evaluation. The polyfill lives in src/lib/buffer-polyfill.js as
        // main.jsx's FIRST import AND now gets its OWN 'buffer-polyfill' chunk.
        // The entry statically imports that chunk FIRST (declaration order), so
        // window.Buffer is set before the entry finishes. Every Buffer user is now
        // in a DYNAMIC chunk: @privy-io lives in privy-vendor, reachable ONLY via
        // lib/privy-provider-lazy.jsx (React.lazy), and @solana/web3.js / ethers
        // stay inside their lazy consumer chunks (walletService via the swap /
        // wallet UI). Dynamic chunks always evaluate AFTER the entry ran the
        // polyfill, so none of them can hit "Buffer is not defined".
        //
        // WHY buffer can be its OWN chunk now (it used to ride inside privy-vendor
        // because a separate sibling chunk was order-brittle - rollup hoisted
        // privy-vendor's static import first, 2026-06-08): privy-vendor is no
        // longer a STATIC sibling of the entry (it's dynamic), so there is no
        // static Buffer-touching sibling left to lose the hoist race to. The only
        // static entry siblings (react-vendor, app code) don't touch Buffer.
        //
        // three-vendor was deleted 2026-06-08: a 4.5KB orphan stub that was
        // pointlessly modulepreloaded (AuroraField is CSS-only; the sole Three
        // importer is an unmounted lazy component - it now bundles with it).
        manualChunks(id) {
          // Polyfill + the `buffer` pkg together in one chunk (buffer's body must
          // init before the polyfill assigns window.Buffer; within one chunk the
          // dependency evaluates first). This is main.jsx's import #1 → the entry
          // imports it before any other chunk.
          if (id.includes('buffer-polyfill') || /node_modules[\\/]buffer[\\/]/.test(id)) return 'buffer-polyfill'
          // TRAPPED-SHARED-MODULE FIX (the reason privy-vendor was modulepreloaded
          // after the lazy-mount change): Vite's dynamic-import `__vitePreload`
          // helper AND zustand are used BOTH by @privy-io internally AND by the
          // entry (every code-split import() + the settings store). Left
          // unassigned, rollup buries each in the biggest common consumer -
          // privy-vendor - so the entry `import{__vitePreload, create}` reaches
          // INTO privy-vendor and drags its modulepreload back onto boot. Pin them
          // to tiny neutral chunks so the boot graph never touches the wallet
          // vendor. (Same class of fix as the research app's B1 d3 un-trapping.)
          if (id.includes('vite/preload-helper')) return 'vendor-shared'
          if (/node_modules[\\/]zustand[\\/]/.test(id)) return 'vendor-zustand'
          // @privy-io/react-auth (+ /solana subpath). Reachable ONLY via dynamic
          // import now (lib/privy-provider-lazy.jsx), so this chunk never lands on
          // the entry's modulepreload list - the whole wallet stack is off boot.
          if (/node_modules[\\/]@privy-io[\\/]/.test(id)) return 'privy-vendor'
          if (/node_modules[\\/]lightweight-charts[\\/]/.test(id)) return 'lightweight-charts'
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor'
          if (/node_modules[\\/]html2canvas[\\/]/.test(id)) return 'html2canvas'
          return undefined
        },
      },
    },
    minify: 'esbuild',
    target: 'es2020',
  },
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
    pure: process.env.NODE_ENV === 'production' ? ['console.log', 'console.warn'] : [],
  },
})
