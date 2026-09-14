/**
 * Static prerenderer for GEO-critical routes.
 *
 * After `npm run build`, runs a lightweight static server over the built
 * dist/ directory, spins up headless Chromium via Puppeteer, visits each
 * target route, waits for react-helmet-async to populate <title> and
 * <meta name="description">, then writes the fully-rendered HTML back to
 * dist/{route}.html.
 *
 * Why: AI crawlers like GPTBot, ClaudeBot, and PerplexityBot do not
 * reliably execute JavaScript. Without prerendering they see only the
 * generic index.html and never index our per-route meta or content.
 *
 * Output layout:
 *   /                     -> dist/index.html (overwritten in place)
 *   /facts                -> dist/facts.html
 *   /vs/nansen            -> dist/vs/nansen.html
 *   /research-zone/bitcoin -> dist/research-zone/bitcoin.html
 *
 * Vercel serves these via explicit rewrites in vercel.json. See the
 * `"rewrites"` block for the mapping from /facts -> /facts.html etc.
 */

import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Browser launcher with Vercel-aware fallback.
 *
 * Local dev: uses `puppeteer` (bundles its own Chrome).
 * Vercel build: uses `puppeteer-core` + `@sparticuz/chromium` (a precompiled
 * Chromium that runs in the Vercel build sandbox without system libs).
 *
 * The historical bug: `puppeteer.launch()` fails on Vercel with code 127
 * because Vercel's build image lacks libnspr4 / libdrm / etc. that bundled
 * Chrome needs. @sparticuz/chromium ships a Chromium binary statically
 * linked against everything it needs, so it just works.
 */
async function launchBrowser() {
  const isServerless = !!(process.env.VERCEL || process.env.NOW_BUILDER || process.env.AWS_LAMBDA_FUNCTION_VERSION)
  if (isServerless) {
    const [{ default: chromium }, { default: puppeteerCore }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core'),
    ])
    // Pass through chromium's own args/viewport/headless mode. Newer
    // @sparticuz/chromium versions expose `headless: 'shell'` (not boolean)
    // and the `defaultViewport` is required for proper rendering.
    return puppeteerCore.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })
  }
  const { default: puppeteer } = await import('puppeteer')
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DIST_DIR = path.resolve(__dirname, '..', 'dist')
const PORT = 4509
const PER_ROUTE_TIMEOUT_MS = 20_000
// Settle wait after the Helmet <title> mutation is detected. The waitForFunction
// below already blocks until per-route meta is populated, so this is just a small
// buffer for any trailing async meta (og:image etc.), not a blanket render delay.
const RENDER_WAIT_MS = 400
// Number of pages rendered concurrently against the same browser instance.
// Each route boots the full SPA bundle in a headless tab, so prerender is
// CPU-bound and embarrassingly parallel - the Vercel build sandbox runs on
// 30 cores / 60GB, where 6 tabs left most cores idle. Scale to the available
// CPU count, capped at 12 (each Chromium tab is ~100-200MB, well within RAM).
// Routes block all API/external requests, so there's no backend contention.
// Override with PRERENDER_CONCURRENCY if needed.
const DEFAULT_CONCURRENCY = Math.min(12, Math.max(4, os.cpus()?.length || 4))
const CONCURRENCY = Math.max(1, Number(process.env.PRERENDER_CONCURRENCY) || DEFAULT_CONCURRENCY)

// Routes to prerender. Keep the list curated - every route adds build time.
// Rule of thumb: include marketing surfaces, press-kit content, comparison
// pages, and the highest-value token long-tail pages.
const ROUTES = [
  '/',
  '/website2',
  '/website2/api',
  '/facts',
  '/vs/nansen',
  '/vs/arkham',
  '/vs/tradingview',
  '/vs/messari',
  '/vs/cryptoquant',
  '/vs/dextools',
  '/fear-greed',
  '/liquidation-heatmap',
  '/economic-calendar',
  '/intelligence',
  '/research-zone/bitcoin',
  '/research-zone/ethereum',
  '/research-zone/solana',
  '/research-zone/ripple',
  '/research-zone/dogecoin',
  '/research-zone/chainlink',
  '/research-zone/uniswap',
  '/research-zone/avalanche-2',
  '/research-zone/arbitrum',
  '/how-to/trade-crypto-non-custodially',
  '/how-to/use-mcp-server-with-claude',
  '/how-to/read-crypto-fear-and-greed-index',
  '/glossary/fear-and-greed-index',
  '/glossary/liquidation',
  '/glossary/funding-rate',
  '/glossary/open-interest',
  '/glossary/cvd',
  '/glossary/order-book-depth',
  '/glossary/whale-tracking',
  '/glossary/exchange-flows',
  '/glossary/on-chain-analytics',
  '/glossary/mvrv',
  '/glossary/realised-price',
  '/glossary/dormant-supply',
  '/glossary/stablecoin-supply',
  '/glossary/mcp-server',
  '/glossary/x402',
  '/glossary/ai-agent',
  '/glossary/monarch-ai',
  '/glossary/daily-brief',
  '/glossary/narrative',
  '/glossary/mindshare',
  '/glossary/kol-tracking',
  '/glossary/social-sentiment',
  '/glossary/non-custodial',
  '/glossary/privy-wallet',
  '/glossary/jupiter',
  '/glossary/zero-x',
  '/glossary/api',
  '/glossary/websocket',
  '/glossary/intelligence-hub',
  '/glossary/spect-token',
]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

function mimeFor(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'
}

async function readFileSafe(p) {
  try {
    const stat = await fs.stat(p)
    if (stat.isDirectory()) return readFileSafe(path.join(p, 'index.html'))
    return { data: await fs.readFile(p), mime: mimeFor(p) }
  } catch {
    return null
  }
}

function createStaticServer() {
  return http.createServer(async (req, res) => {
    const url = req.url.split('?')[0]
    // Try exact file match first
    const direct = await readFileSafe(path.join(DIST_DIR, url === '/' ? '/index.html' : url))
    if (direct) {
      res.writeHead(200, { 'Content-Type': direct.mime })
      res.end(direct.data)
      return
    }
    // SPA fallback for unknown routes - serve index.html so React Router can match
    const fallback = await readFileSafe(path.join(DIST_DIR, 'index.html'))
    if (fallback) {
      res.writeHead(200, { 'Content-Type': fallback.mime })
      res.end(fallback.data)
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })
}

function outputPathFor(route) {
  if (route === '/') return path.join(DIST_DIR, 'index.html')
  // Strip trailing slash
  const clean = route.replace(/\/$/, '')
  return path.join(DIST_DIR, `${clean}.html`)
}

/**
 * Remove static meta/link tags that were overridden by react-helmet-async.
 *
 * The original index.html ships with default meta description, canonical,
 * og:*, and twitter:* tags so that non-JS crawlers see something sensible
 * even without prerendering. After prerendering, Helmet has already
 * injected the per-route versions (marked with data-rh="true"). Keeping
 * both produces confusing duplicates where Bing in particular picks the
 * wrong one.
 *
 * Strategy: for each dedupable tag pattern, if at least one data-rh="true"
 * version exists in the HTML, strip all same-type tags that DON'T carry
 * data-rh. That leaves only Helmet-managed tags, guaranteeing per-route
 * correctness in the rendered snapshot.
 */
function stripDuplicateHelmetTags(html) {
  // Each entry: { name, regex matching the full tag, check if it's the helmet-managed version }
  const dedupPatterns = [
    // name=-based meta tags
    ...['description', 'twitter:title', 'twitter:description', 'twitter:url', 'twitter:image'].map((n) => ({
      label: `meta[name="${n}"]`,
      tagRegex: new RegExp(`<meta\\b[^>]*name=["']${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'g'),
    })),
    // property=-based meta tags
    ...['og:title', 'og:description', 'og:url', 'og:image', 'og:image:secure_url'].map((p) => ({
      label: `meta[property="${p}"]`,
      tagRegex: new RegExp(`<meta\\b[^>]*property=["']${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'g'),
    })),
    // canonical link
    {
      label: 'link[rel="canonical"]',
      tagRegex: /<link\b[^>]*rel=["']canonical["'][^>]*>/g,
    },
  ]

  let out = html
  for (const { tagRegex } of dedupPatterns) {
    const tags = out.match(tagRegex) || []
    if (tags.length < 2) continue
    const hasHelmet = tags.some((t) => t.includes('data-rh="true"'))
    if (!hasHelmet) continue
    // Remove tags that do NOT have data-rh="true"
    out = out.replace(tagRegex, (match) => (match.includes('data-rh="true"') ? match : ''))
  }
  return out
}

async function prerenderRoute(browser, route) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })

  // Block external API calls so a missing backend doesn't hang or spam errors.
  // We only need the client-rendered HTML skeleton + Helmet-injected meta.
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const u = req.url()
    const isApi = u.includes('/api/')
    const isAnalytics = u.includes('posthog') || u.includes('analytics')
    const isExternal = !u.startsWith(`http://localhost:${PORT}`)
    if (isApi || isAnalytics || isExternal) return req.abort('blockedbyclient').catch(() => {})
    req.continue().catch(() => {})
  })

  const targetUrl = `http://localhost:${PORT}${route}`
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PER_ROUTE_TIMEOUT_MS })
    // Wait for react-helmet-async to mutate the title past the static default.
    // The static index.html ships with the homepage title, so for non-root
    // routes we wait for a change. For root we just wait a bit for hydration.
    if (route !== '/') {
      await page.waitForFunction(
        () => document.title && document.title.length > 10 && !document.title.startsWith('Spectre AI — Crypto Market'),
        { timeout: PER_ROUTE_TIMEOUT_MS },
      ).catch(() => {})
    }
    await new Promise((r) => setTimeout(r, RENDER_WAIT_MS))
    const rawHtml = await page.content()
    const html = stripDuplicateHelmetTags(rawHtml)
    const outPath = outputPathFor(route)
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, html, 'utf8')
    const title = await page.title()
    const rel = path.relative(DIST_DIR, outPath).replace(/\\/g, '/')
    console.log(`  [ok] ${route.padEnd(34)} -> dist/${rel}  (${title.slice(0, 60)})`)
  } catch (err) {
    console.error(`  [err] ${route}:`, err.message)
  } finally {
    await page.close().catch(() => {})
  }
}

async function main() {
  // Sanity-check dist exists
  try {
    await fs.stat(path.join(DIST_DIR, 'index.html'))
  } catch {
    console.error(`[prerender] dist/index.html not found. Run "npm run build" first.`)
    process.exit(1)
  }

  console.log(`[prerender] Starting static server on port ${PORT}...`)
  const server = createStaticServer()
  await new Promise((r) => server.listen(PORT, r))

  console.log(`[prerender] Launching headless Chromium...`)
  let browser
  try {
    browser = await launchBrowser()
  } catch (err) {
    // Any Chromium launch failure on Vercel/serverless is non-fatal.
    // Prerender is an enhancement, not a requirement - the built SPA is
    // always intact without it. Common failure modes on Vercel's build
    // image we've seen:
    //   - Missing system libs: "libnspr4.so: cannot open shared object
    //     file" (puppeteer bundling its own Chrome that needs host libs)
    //   - "Code: 127" (exec format / deps missing)
    //   - "Could not find Chrome" (puppeteer-core with no binary
    //     installed in the cache path)
    //   - "Failed to launch the browser process"
    //
    // Rather than maintain an allow-list of known-env errors, just treat
    // every launch failure as skip-and-continue. If someone wants
    // prerender on Vercel they need to configure it deliberately
    // (@sparticuz/chromium, custom build image, or offline prerender).
    console.warn('[prerender] Skipping: Chromium could not launch in this build environment.')
    console.warn('[prerender] Error:', String(err?.message || err).split('\n')[0])
    console.warn('[prerender] The built SPA is intact. For pre-rendered HTML on Vercel,')
    console.warn('[prerender] install @sparticuz/chromium + puppeteer-core, or use a custom build image.')
    server.close()
    return
  }

  console.log(`[prerender] Rendering ${ROUTES.length} routes (concurrency ${CONCURRENCY})...`)
  const start = Date.now()
  // Worker-pool over a shared queue: spin up CONCURRENCY workers, each pulls the
  // next route until the queue drains. Each worker owns one page at a time
  // (created/closed inside prerenderRoute), so peak open pages == CONCURRENCY.
  const queue = [...ROUTES]
  const worker = async () => {
    let route
    while ((route = queue.shift()) !== undefined) {
      await prerenderRoute(browser, route)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ROUTES.length) }, worker))
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`[prerender] Done in ${elapsed}s`)

  await browser.close()
  server.close()
}

main().catch((err) => {
  console.error('[prerender] Fatal:', err)
  process.exit(1)
})
