// ════════════════════════════════════════════════════════════════════
// Vercel Edge Middleware — SEO + Bot Signal Headers
// ════════════════════════════════════════════════════════════════════
//
// This file is intentionally a pure passthrough that ONLY adds response
// headers. We do this via rewrite() so the original route still resolves
// its real content. No prerendering happens here — the SPA shell
// (apps/research/index.html) already ships a comprehensive meta/OG/
// JSON-LD payload that AI crawlers read without running JavaScript.
//
// If you ever want real prerendering, replace the body of middleware()
// with a fetch to prerender.io or a self-hosted prerender service when
// isBot(ua) is true.
// ════════════════════════════════════════════════════════════════════

export const config = {
  matcher: [
    // Skip static assets, API routes, and Vercel internals.
    '/((?!_vercel|api/|.*\\.(?:png|jpg|jpeg|webp|svg|gif|mp4|mov|webm|woff|woff2|ttf|ico|css|js|map|txt|xml)$).*)',
  ],
}

const BOT_UAS = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandex',
  'gptbot', 'chatgpt-user', 'oai-searchbot',
  'claudebot', 'claude-searchbot', 'claude-user', 'anthropic-ai',
  'google-extended',
  'perplexitybot', 'perplexity-user',
  'applebot', 'applebot-extended',
  'meta-externalagent', 'meta-externalfetcher', 'facebookbot',
  'cohere-ai', 'youbot', 'duckassistbot', 'amazonbot', 'bytespider', 'ccbot',
  'diffbot', 'mistralai-user', 'deepseekbot', 'xai-bot',
]

function isBot(ua) {
  if (!ua) return false
  const lower = ua.toLowerCase()
  return BOT_UAS.some((sig) => lower.includes(sig))
}

function canonicalFor(pathname) {
  const clean = pathname === '/' ? '/' : pathname.replace(/\/+$/, '')
  return `https://spectreai.io${clean}`
}

export default async function middleware(request) {
  const url = new URL(request.url)
  const ua = request.headers.get('user-agent') || ''
  const bot = isBot(ua)

  // Forward the request unchanged and just inject SEO-relevant headers.
  // Using the standard Fetch API rewrite pattern for Vercel Edge.
  const response = new Response(null, {
    headers: {
      'x-middleware-next': '1',
      'Link': `<${canonicalFor(url.pathname)}>; rel="canonical"`,
      'X-Robots-Tag': 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
      ...(bot ? { 'X-Is-Bot': '1' } : {}),
    },
  })

  return response
}
