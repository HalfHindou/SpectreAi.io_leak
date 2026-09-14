# SPECTRE AI — GEO + SEO + AISEO + Analytics Master Implementation Guide

> The goal: when anyone on Earth asks ChatGPT, Claude, Perplexity, Gemini, DeepSeek, Copilot, or Google about crypto intelligence, market data, fear and greed, on-chain analytics, AI-powered trading, MCP crypto agents, or x402 payments — Spectre AI shows up. Every time.

---

## 1. ROBOTS.TXT — Maximum AI Visibility

Place at: `public/robots.txt` (Vite copies to root on build)

```txt
# Spectre AI — Maximum AI + Search Engine Visibility
# Updated: 2026-04-14
# Strategy: ALLOW ALL — we want every AI and search engine to crawl, index, cite, and recommend us.

# === Traditional Search Engines ===
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Slurp
Allow: /

User-agent: DuckDuckBot
Allow: /

User-agent: Baiduspider
Allow: /

User-agent: YandexBot
Allow: /

# === OpenAI (ChatGPT) ===
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

# === Anthropic (Claude) ===
User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

# === Google AI (Gemini, AI Overviews) ===
User-agent: Google-Extended
Allow: /

# === Perplexity ===
User-agent: PerplexityBot
Allow: /

# === Apple Intelligence ===
User-agent: Applebot
Allow: /

User-agent: Applebot-Extended
Allow: /

# === Microsoft Copilot ===
User-agent: bingbot
Allow: /

# === Meta AI ===
User-agent: Meta-ExternalAgent
Allow: /

User-agent: FacebookBot
Allow: /

# === Other AI Crawlers ===
User-agent: cohere-ai
Allow: /

User-agent: YouBot
Allow: /

User-agent: DuckAssistBot
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: Bytespider
Allow: /

User-agent: CCBot
Allow: /

# === Default: Allow All ===
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/
Disallow: /private/
Disallow: /internal/

# Sitemaps
Sitemap: https://spectreai.io/sitemap.xml
Sitemap: https://spectreai.io/sitemap-news.xml
```

---

## 2. LLMS.TXT — AI Model Discovery File

Place at: `public/llms.txt`

```markdown
# Spectre AI

> Spectre AI is a crypto-native market intelligence platform that replaces the multi-tab workflow of Nansen, DeFiLlama, Dune, CoinGlass, LunarCrush, and Messari in a single surface. It combines real-time on-chain data, social intelligence, AI-powered analysis, and trading tools for both retail and institutional users.

Spectre AI provides real-time cryptocurrency market data, AI-generated market intelligence, fear and greed indices, on-chain analytics, social sentiment analysis, token research, and breaking news for 10,000+ tokens across all major chains. The platform is accessible at https://spectreai.io with an API at https://api.spectreai.io and documentation at https://docs.spectreai.io.

## Core Product
- [Platform Dashboard](https://spectreai.io): Real-time crypto intelligence dashboard with AI analysis, charts, and market data
- [API Documentation](https://docs.spectreai.io): 500+ endpoints covering market data, on-chain analytics, social intelligence, and AI insights
- [API Access](https://spectreai.io/api): Programmatic access to all Spectre intelligence via REST API, WebSocket, MCP server, and x402 micropayments
- [Status Page](https://status.spectreai.io): Real-time platform health and uptime monitoring

## Market Intelligence
- [Fear & Greed Index](https://spectreai.io): Multi-factor crypto market sentiment indicator updated in real-time
- [Token Research](https://spectreai.io): Deep-dive token analytics with price, volume, liquidity, social sentiment, and AI-generated insights
- [Market Overview](https://spectreai.io): Total crypto market cap, BTC dominance, trending tokens, top gainers and losers
- [Intelligence Hub](https://spectreai.io/intelligence): AI-generated market analysis, breaking news, daily briefs, and deep research articles

## Developer Tools
- [MCP Server](https://mcp.spectreai.io): Model Context Protocol server for connecting AI agents to live crypto market data
- [x402 Micropayments](https://spectreai.io/api): Pay-per-request API access using HTTP 402 protocol — no API key required
- [WebSocket Feeds](https://ws.spectreai.io): Real-time streaming data from Binance, Bybit, OKX, Coinbase, and Kraken
- [TypeScript SDK](https://docs.spectreai.io): Official TypeScript SDK for Spectre API integration
- [Python SDK](https://docs.spectreai.io): Official Python SDK for Spectre API integration

## Token ($SPECT)
- [Token Info](https://spectreai.io): $SPECT is an ERC-20 utility token on Ethereum (contract: 0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6) with 1 billion total supply. Three access tiers: 500, 1,000, and 7,000 tokens for progressively unlocked platform features.

## Company
- [About](https://spectreai.io): Founded by Sunny. Backed by Google for Startups and NVIDIA Inception. Partners include TradingView and Bitquery.
- [Twitter/X](https://x.com/spectaborz): Official Spectre AI account on X

## Optional
- [Spectre Edition Articles](https://spectreai.io/intelligence): AI-curated market analysis and research articles published daily
- [Landing Page](https://spectreai.io/lp): Product overview and feature showcase
```

Also create `public/llms-full.txt` with an expanded version containing all endpoint categories, feature descriptions, and use cases.

---

## 3. INDEX.HTML — Full Meta, OG, Schema, and SEO Tags

Update `index.html` `<head>` section:

```html
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0" />

    <!-- Primary Meta Tags -->
    <title>Spectre AI — Crypto Market Intelligence Platform</title>
    <meta name="description" content="Real-time crypto intelligence platform combining on-chain analytics, AI-powered market analysis, social sentiment, and trading tools. 500+ API endpoints. MCP server for AI agents. Fear & Greed Index, token research, breaking news for 10,000+ tokens." />
    <meta name="keywords" content="crypto intelligence, cryptocurrency analytics, bitcoin market data, ethereum analytics, DeFi analytics, on-chain data, crypto fear and greed index, AI crypto analysis, token research, crypto API, MCP server crypto, x402 payments, crypto trading tools, market sentiment, crypto news, whale tracking, liquidity analysis, crypto dashboard" />
    <meta name="author" content="Spectre AI" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <meta name="googlebot" content="index, follow" />
    <meta name="bingbot" content="index, follow" />

    <!-- Canonical -->
    <link rel="canonical" href="https://spectreai.io" />

    <!-- Language / Locale -->
    <meta name="language" content="English" />
    <meta http-equiv="content-language" content="en" />
    <link rel="alternate" hreflang="en" href="https://spectreai.io" />
    <link rel="alternate" hreflang="x-default" href="https://spectreai.io" />

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://spectreai.io" />
    <meta property="og:title" content="Spectre AI — Crypto Market Intelligence Platform" />
    <meta property="og:description" content="Real-time crypto intelligence combining on-chain analytics, AI analysis, social sentiment, and trading tools in one platform. 500+ API endpoints. MCP server for AI agents." />
    <meta property="og:image" content="https://spectreai.io/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Spectre AI — Crypto Market Intelligence Platform" />
    <meta property="og:site_name" content="Spectre AI" />
    <meta property="og:locale" content="en_US" />

    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@spectaborz" />
    <meta name="twitter:creator" content="@spectaborz" />
    <meta name="twitter:title" content="Spectre AI — Crypto Market Intelligence Platform" />
    <meta name="twitter:description" content="Real-time crypto intelligence. On-chain analytics, AI analysis, social sentiment, trading tools. 500+ API endpoints. MCP server for AI agents." />
    <meta name="twitter:image" content="https://spectreai.io/og-image.png" />
    <meta name="twitter:image:alt" content="Spectre AI Dashboard" />

    <!-- Favicons -->
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#07070d" />

    <!-- iOS PWA -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Spectre AI" />

    <!-- Preconnect (performance) -->
    <link rel="preconnect" href="https://api.spectreai.io" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="dns-prefetch" href="https://api.spectreai.io" />
    <link rel="dns-prefetch" href="https://ws.spectreai.io" />

    <!-- Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

    <!-- JSON-LD Structured Data: Organization -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "Spectre AI",
      "url": "https://spectreai.io",
      "logo": "https://spectreai.io/icon-512x512.png",
      "description": "AI-powered crypto market intelligence platform combining on-chain analytics, social sentiment, and trading tools.",
      "foundingDate": "2024",
      "founder": {
        "@type": "Person",
        "name": "Sunny"
      },
      "sameAs": [
        "https://x.com/spectaborz",
        "https://github.com/spectreaibot",
        "https://docs.spectreai.io"
      ],
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "customer support",
        "url": "https://spectreai.io"
      }
    }
    </script>

    <!-- JSON-LD: SoftwareApplication -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "Spectre AI",
      "applicationCategory": "FinanceApplication",
      "applicationSubCategory": "Cryptocurrency Analytics",
      "operatingSystem": "Web",
      "url": "https://spectreai.io",
      "description": "Real-time crypto market intelligence platform with 500+ API endpoints, MCP server for AI agents, on-chain analytics, social sentiment tracking, and AI-powered market analysis for 10,000+ tokens.",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD",
        "description": "Free tier available. Premium access via $SPECT token holding."
      },
      "featureList": [
        "Real-time cryptocurrency market data for 10,000+ tokens",
        "AI-powered market analysis and intelligence",
        "On-chain analytics and whale tracking",
        "Social sentiment analysis via X/Twitter intelligence",
        "Fear and Greed Index",
        "Breaking crypto news with AI classification",
        "500+ REST API endpoints",
        "WebSocket real-time data feeds",
        "MCP server for AI agent integration",
        "x402 micropayment API access",
        "Token research and due diligence tools",
        "Multi-exchange data: Binance, Bybit, OKX, Coinbase, Kraken"
      ],
      "screenshot": "https://spectreai.io/og-image.png"
    }
    </script>

    <!-- JSON-LD: WebSite + SearchAction -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "Spectre AI",
      "url": "https://spectreai.io",
      "description": "Crypto market intelligence platform",
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://spectreai.io/search?q={search_term_string}"
        },
        "query-input": "required name=search_term_string"
      }
    }
    </script>

    <!-- JSON-LD: FAQPage (GEO-optimized for AI citation) -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is Spectre AI?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Spectre AI is a crypto-native market intelligence platform that combines real-time on-chain data, AI-powered market analysis, social sentiment tracking, and trading tools into a single dashboard. It replaces the need for multiple tools like Nansen, DeFiLlama, Dune, CoinGlass, LunarCrush, and Messari."
          }
        },
        {
          "@type": "Question",
          "name": "What is the Spectre AI API?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "The Spectre AI API provides 500+ endpoints covering real-time market data, on-chain analytics, social intelligence, and AI-generated insights for 10,000+ cryptocurrency tokens. It supports REST, WebSocket, MCP server for AI agents, and x402 micropayments for pay-per-request access without API keys."
          }
        },
        {
          "@type": "Question",
          "name": "What is the crypto Fear and Greed Index on Spectre AI?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "The Spectre AI Fear and Greed Index is a multi-factor market sentiment indicator that aggregates volatility, volume, social sentiment, dominance, and on-chain signals to produce a real-time reading of crypto market psychology on a 0-100 scale."
          }
        },
        {
          "@type": "Question",
          "name": "What is Spectre AI's MCP server?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Spectre AI's MCP (Model Context Protocol) server at mcp.spectreai.io allows AI agents and tools like Claude, ChatGPT, and custom LLM applications to access live cryptocurrency market data, analytics, and intelligence through a standardized protocol. It includes 24 tools for querying prices, sentiment, on-chain data, and more."
          }
        },
        {
          "@type": "Question",
          "name": "What is x402 payment on Spectre AI?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "x402 is an HTTP 402-based micropayment protocol that lets developers access Spectre AI's API endpoints on a pay-per-request basis using cryptocurrency, without needing traditional API keys or subscriptions. Each request is paid for individually at the time of the call."
          }
        },
        {
          "@type": "Question",
          "name": "What is the $SPECT token?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "$SPECT is an ERC-20 utility token on Ethereum (contract: 0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6) with 1 billion total supply. It unlocks three tiers of access to the Spectre AI platform: 500 tokens for basic, 1,000 for advanced, and 7,000 for full institutional-grade features."
          }
        }
      ]
    }
    </script>
</head>
```

---

## 4. SITEMAP.XML — Full Coverage

Generate dynamically or place static at `public/sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">

  <!-- Core Pages -->
  <url>
    <loc>https://spectreai.io/</loc>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
    <image:image>
      <image:loc>https://spectreai.io/og-image.png</image:loc>
      <image:title>Spectre AI Crypto Intelligence Platform</image:title>
    </image:image>
  </url>

  <url>
    <loc>https://spectreai.io/lp</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>

  <url>
    <loc>https://spectreai.io/api</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>

  <!-- Documentation -->
  <url>
    <loc>https://docs.spectreai.io/</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>

  <!-- Intelligence Hub Articles (dynamic — add per article) -->
  <!-- Generate these dynamically from your article database -->

  <!-- API Status -->
  <url>
    <loc>https://status.spectreai.io/</loc>
    <changefreq>always</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>
```

Also create `public/sitemap-news.xml` for Intelligence Hub / Spectre Edition articles (Google News sitemap format).

---

## 5. PER-PAGE SEO METADATA — SSR/Prerender Strategy

Since the app is React SPA (Vite), AI crawlers cannot execute JavaScript. You MUST implement one of:

### Option A: Prerender Service (Recommended for Speed)
Use `prerender.io`, `rendertron`, or a lightweight Express middleware that serves pre-rendered HTML to bot user-agents.

### Option B: Vite SSR Plugin
Use `vite-plugin-ssr` or `@vitejs/plugin-react` with SSR mode.

### Option C: Static Meta Tags via React Helmet (Minimum Viable)
Install `react-helmet-async` and add per-page meta:

```jsx
// In each page component
import { Helmet } from 'react-helmet-async';

// Landing Page
<Helmet>
  <title>Spectre AI — Crypto Market Intelligence Platform</title>
  <meta name="description" content="Real-time crypto intelligence dashboard. AI analysis, on-chain data, social sentiment, and trading tools for 10,000+ tokens." />
  <link rel="canonical" href="https://spectreai.io" />
</Helmet>

// /lp Landing Page
<Helmet>
  <title>Spectre AI — The All-in-One Crypto Intelligence Platform</title>
  <meta name="description" content="Replace Nansen, DeFiLlama, Dune, CoinGlass, LunarCrush, and Messari with one platform. Real-time data, AI insights, and trading tools." />
  <link rel="canonical" href="https://spectreai.io/lp" />
</Helmet>

// /api Page
<Helmet>
  <title>Spectre AI API — 500+ Crypto Data Endpoints, MCP Server, x402 Payments</title>
  <meta name="description" content="Access real-time crypto market data via 500+ REST endpoints, WebSocket feeds, MCP server for AI agents, and x402 micropayments. TypeScript and Python SDKs available." />
  <link rel="canonical" href="https://spectreai.io/api" />
</Helmet>

// Intelligence Hub
<Helmet>
  <title>Spectre Intelligence Hub — AI-Generated Crypto Market Analysis</title>
  <meta name="description" content="AI-curated cryptocurrency market analysis, breaking news, daily briefs, and deep research. Updated every 30 minutes by Spectre AI agents." />
  <link rel="canonical" href="https://spectreai.io/intelligence" />
</Helmet>
```

**CRITICAL: For AI crawlers, Option C alone is NOT enough for a React SPA. You must combine it with prerendering or SSR. At minimum, implement a prerender middleware on the Express server that detects bot user-agents and serves static HTML.**

### Express Prerender Middleware (add to server/index.js)

```javascript
import { execSync } from 'child_process';

const BOT_AGENTS = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot',
  'gptbot', 'chatgpt-user', 'oai-searchbot',
  'claudebot', 'claude-searchbot', 'claude-user',
  'google-extended', 'perplexitybot',
  'applebot', 'applebot-extended',
  'meta-externalagent', 'facebookbot',
  'cohere-ai', 'youbot', 'duckassistbot', 'amazonbot', 'bytespider', 'ccbot'
];

function isBot(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_AGENTS.some(bot => ua.includes(bot));
}

// Mount BEFORE your static file serving
app.use((req, res, next) => {
  if (isBot(req.headers['user-agent']) && !req.path.startsWith('/api/')) {
    // Serve prerendered HTML or use a prerender service
    // Option 1: prerender.io middleware
    // Option 2: local prerender cache
    // Option 3: serve static shell with all meta tags embedded
    next(); // For now, fall through — implement prerender service
  } else {
    next();
  }
});
```

---

## 6. PAGE-SPECIFIC STRUCTURED DATA

### /api Page — API Product Schema

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebAPI",
  "name": "Spectre AI API",
  "description": "500+ REST API endpoints for real-time cryptocurrency market data, on-chain analytics, social intelligence, and AI-generated insights. Includes MCP server for AI agents and x402 micropayment access.",
  "url": "https://spectreai.io/api",
  "documentation": "https://docs.spectreai.io",
  "provider": {
    "@type": "Organization",
    "name": "Spectre AI",
    "url": "https://spectreai.io"
  },
  "termsOfService": "https://docs.spectreai.io/terms",
  "category": ["Financial Data", "Cryptocurrency", "Market Intelligence", "AI Integration"],
  "offers": [
    {
      "@type": "Offer",
      "name": "Free Tier",
      "price": "0",
      "priceCurrency": "USD",
      "description": "Limited API access with rate limiting"
    },
    {
      "@type": "Offer",
      "name": "x402 Micropayments",
      "description": "Pay-per-request API access via HTTP 402 cryptocurrency micropayments"
    },
    {
      "@type": "Offer",
      "name": "$SPECT Token Access",
      "description": "Hold $SPECT tokens for tiered API access: 500 tokens (basic), 1,000 (advanced), 7,000 (institutional)"
    }
  ]
}
</script>
```

### Intelligence Hub Articles — NewsArticle Schema

For each AI-generated article, inject:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "{{article.title}}",
  "description": "{{article.summary}}",
  "datePublished": "{{article.publishedAt}}",
  "dateModified": "{{article.updatedAt}}",
  "author": {
    "@type": "Organization",
    "name": "Spectre AI Intelligence"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Spectre AI",
    "logo": {
      "@type": "ImageObject",
      "url": "https://spectreai.io/icon-512x512.png"
    }
  },
  "mainEntityOfPage": "https://spectreai.io/intelligence/{{article.slug}}",
  "articleSection": "Cryptocurrency Market Analysis",
  "keywords": "{{article.tags.join(', ')}}"
}
</script>
```

---

## 7. POSTHOG ANALYTICS — Full Setup

### Install

```bash
npm install posthog-js
```

### Initialize (src/lib/posthog.js)

```javascript
import posthog from 'posthog-js';

const POSTHOG_KEY = 'phc_YOUR_PROJECT_KEY'; // Get from PostHog dashboard
const POSTHOG_HOST = 'https://us.i.posthog.com'; // or eu.i.posthog.com

export function initPostHog() {
  if (typeof window === 'undefined') return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,

    // Session recording
    enable_recording_console_log: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '.ph-mask',
    },

    // Performance
    loaded: (posthog) => {
      if (import.meta.env.DEV) {
        posthog.debug();
      }
    },
  });

  return posthog;
}

export { posthog };
```

### Mount in App (src/main.jsx or App.jsx)

```javascript
import { initPostHog } from '@/lib/posthog';

// Initialize on app load
const ph = initPostHog();

// Track page views on navigation
function onPageChange(page, view) {
  ph?.capture('$pageview', {
    $current_url: window.location.href,
    page,
    view,
  });
}
```

### Key Events to Track

```javascript
// Token research viewed
posthog.capture('token_researched', {
  symbol: token.symbol,
  source: 'search' | 'trending' | 'watchlist',
});

// API page viewed
posthog.capture('api_page_viewed', {
  section: 'overview' | 'endpoints' | 'mcp' | 'x402' | 'pricing',
});

// Intelligence article read
posthog.capture('intelligence_article_read', {
  articleId: article.id,
  type: 'daily_brief' | 'deep_analysis' | 'breaking_news',
  readTime: seconds,
});

// Feature engagement
posthog.capture('feature_used', {
  feature: 'fear_greed' | 'watchlist' | 'screener' | 'chart' | 'ai_assistant',
});

// Conversion events
posthog.capture('cta_clicked', {
  cta: 'get_api_key' | 'connect_wallet' | 'buy_spect' | 'start_free',
  page: currentPage,
});

// Search queries (valuable for GEO content strategy)
posthog.capture('search_performed', {
  query: searchQuery,
  results_count: results.length,
  selected_result: selectedToken?.symbol || null,
});
```

### PostHog Feature Flags (for gradual rollout)

```javascript
// Check if user should see new features
if (posthog.isFeatureEnabled('intelligence-hub-v2')) {
  // Show new Intelligence Hub
}
```

### Web Vitals Tracking

```javascript
import { onCLS, onFID, onLCP, onFCP, onTTFB } from 'web-vitals';

function sendToPostHog(metric) {
  posthog.capture('web_vital', {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    page: window.location.pathname,
  });
}

onCLS(sendToPostHog);
onFID(sendToPostHog);
onLCP(sendToPostHog);
onFCP(sendToPostHog);
onTTFB(sendToPostHog);
```

---

## 8. ADDITIONAL ANALYTICS & SEARCH CONSOLE SETUP

### Google Search Console
1. Verify spectreai.io via DNS TXT record or HTML tag
2. Submit sitemap.xml
3. Submit sitemap-news.xml
4. Request indexing for all core pages

### Bing Webmaster Tools
1. Verify spectreai.io
2. Submit sitemap.xml
3. Enable IndexNow for instant URL submission on content publish

### Google Analytics 4 (alongside PostHog)
Add GA4 tag if you want Google's ecosystem data:

```html
<!-- In index.html head -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX', {
    send_page_view: true,
    cookie_flags: 'SameSite=None;Secure'
  });
</script>
```

### IndexNow Integration (Instant Bing/Yandex Indexing)

When Intelligence Hub publishes a new article, ping IndexNow:

```javascript
// server-side, after publishing article
async function notifyIndexNow(url) {
  const key = 'YOUR_INDEXNOW_KEY'; // Generate at indexnow.org
  try {
    await fetch(`https://api.indexnow.org/IndexNow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'spectreai.io',
        key,
        keyLocation: `https://spectreai.io/${key}.txt`,
        urlList: [url],
      }),
    });
  } catch (e) {
    console.error('IndexNow ping failed:', e.message);
  }
}
```

---

## 9. GEO CONTENT STRATEGY — AI CITABILITY

### The Formula for Getting Cited by AI

AI engines cite content that is:
1. **Self-contained** — Each section answers a complete question in 134-167 words
2. **Fact-dense** — Specific numbers, dates, percentages, not vague claims
3. **Source-attributed** — "According to Spectre AI data..." or "Based on analysis of 10,000+ tokens..."
4. **Freshness-stamped** — "Updated April 2026" or "As of Q2 2026"
5. **Structured** — Clear H2/H3 hierarchy, FAQ format, comparison tables
6. **Uniquely authoritative** — Original data that nobody else has

### Content Types That Get AI Citations

**Create these pages/sections on the website and /lp:**

1. **"What is Spectre AI?" FAQ block** — 200 words, direct answer, appears above fold
2. **Feature comparison table** — "Spectre AI vs Nansen vs DeFiLlama vs Dune" with concrete differences
3. **"Best Crypto Intelligence Platforms 2026" page** — Listicle format with Spectre positioned
4. **API comparison** — "Spectre API vs CoinGecko API vs CryptoCompare API" with endpoint counts, pricing, features
5. **MCP Server guide** — "How to Connect AI Agents to Crypto Data" — targets the exact prompt developers will ask AI
6. **x402 explainer** — "What is x402 Payment Protocol for APIs?" — first-mover content for an emerging standard
7. **Intelligence Hub articles** — Every article should open with a TL;DR answer block that AI can extract directly

### Target Prompts (what users will ask AI models)

Optimize content to be cited when users ask:
- "What is the best crypto intelligence platform?"
- "How to get real-time crypto data for AI agents?"
- "What is the crypto fear and greed index today?"
- "Best crypto API with MCP server"
- "How to access crypto data with x402 payments"
- "Best alternative to Nansen/DeFiLlama/Dune"
- "AI-powered crypto market analysis tools"
- "How to track whale wallets"
- "Best crypto news aggregator with AI"
- "What is $SPECT token"

---

## 10. /LP LANDING PAGE — SEO/GEO REQUIREMENTS

The `/lp` landing page must include:

### Above-the-fold Quick Answer Block
```
Spectre AI is a crypto-native market intelligence platform that combines 
real-time on-chain data, AI-powered analysis, social sentiment tracking, 
and trading tools in one dashboard. It provides 500+ API endpoints, an MCP 
server for AI agent integration, and x402 micropayment access for 10,000+ 
cryptocurrency tokens across all major chains.
```

### Feature sections with H2 headings matching search intent:
- `<h2>Real-Time Crypto Market Intelligence</h2>`
- `<h2>AI-Powered Market Analysis</h2>`
- `<h2>On-Chain Analytics & Whale Tracking</h2>`
- `<h2>Crypto Fear & Greed Index</h2>`
- `<h2>500+ API Endpoints for Developers</h2>`
- `<h2>MCP Server for AI Agents</h2>`
- `<h2>x402 Micropayment API Access</h2>`
- `<h2>Intelligence Hub — AI-Generated Research</h2>`

### Comparison Table (critical for GEO citation)
Include a structured comparison against competitors.

### Social Proof Section
- "Backed by Google for Startups and NVIDIA Inception"
- "Partners: TradingView, Bitquery"
- Real metrics: endpoint count, token coverage, uptime

---

## 11. /API PAGE — DEVELOPER SEO/GEO

The `/api` page is your second-most important GEO surface. Developers asking AI for crypto APIs need to find you.

### Required Content Blocks:

1. **Quick Answer block** (first 200 words):
   "The Spectre AI API provides 500+ REST endpoints for real-time cryptocurrency market data, on-chain analytics, social intelligence, and AI-generated insights. Access via traditional API keys, MCP server protocol for AI agents, or x402 micropayments for pay-per-request access. Available SDKs: TypeScript and Python."

2. **Endpoint categories table** with counts per category

3. **Code examples** (TypeScript, Python, curl) — AI models LOVE extracting code examples

4. **MCP server connection guide** — Exact connection string and setup steps

5. **x402 payment flow** — Step-by-step with code

6. **Pricing comparison** — vs CoinGecko, CryptoCompare, etc.

---

## 12. TECHNICAL SEO CHECKLIST

```
[x] robots.txt — All AI crawlers allowed
[x] llms.txt — AI discovery file at root
[x] llms-full.txt — Expanded version with all content
[x] sitemap.xml — All pages, hourly changefreq for dynamic
[x] sitemap-news.xml — Intelligence Hub articles
[x] Canonical URLs — On every page
[x] Hreflang — en + x-default
[x] JSON-LD — Organization, SoftwareApplication, WebSite, FAQPage, WebAPI, NewsArticle
[x] Open Graph — Full og: tags with 1200x630 image
[x] Twitter Cards — summary_large_image with @spectaborz
[x] Meta descriptions — Unique per page, 150-160 chars, keyword-rich
[x] H1 tags — One per page, keyword-targeted
[x] Image alt text — On all images
[x] Prerender/SSR — Bot detection middleware serving static HTML
[x] Core Web Vitals — LCP < 2.5s, FID < 100ms, CLS < 0.1
[x] HTTPS — All domains
[x] Mobile responsive — All pages
[x] 404 page — Custom with navigation
[x] Redirect handling — No broken links
[x] Internal linking — Cross-link between pages
[x] Breadcrumbs — Schema + visible
[ ] Google Search Console — Verify + submit sitemaps
[ ] Bing Webmaster Tools — Verify + submit sitemaps + IndexNow
[ ] PostHog — Initialize + track events
[ ] GA4 — Initialize (optional, alongside PostHog)
[ ] OG Image — Create 1200x630 branded image
[ ] Performance audit — Lighthouse score > 90
```

---

## 13. CLAUDE CODE SESSION PROMPT

Copy and paste this into a Claude Code terminal to implement everything:

```
Read SPECTRE_GEO_SEO_AISEO.md in the project root. This is the master implementation guide for SEO, GEO (Generative Engine Optimization), AISEO, and analytics.

Execute the following in order:

1. Create/update public/robots.txt with the maximum AI visibility config from the guide
2. Create public/llms.txt with the Spectre AI discovery file from the guide
3. Create public/llms-full.txt with expanded content (add all endpoint categories, feature descriptions, all pages)
4. Update index.html <head> with all meta tags, OG tags, Twitter cards, and JSON-LD structured data from the guide
5. Create public/sitemap.xml with all known pages
6. Install posthog-js and create src/lib/posthog.js with the initialization code from the guide
7. Add PostHog initialization to src/main.jsx
8. Add react-helmet-async and add per-page Helmet tags to: WelcomePage, the /lp page, the /api page, and Intelligence Hub
9. Add the bot detection middleware to server/index.js for prerender support
10. Create public/sitemap-news.xml template for Intelligence Hub articles
11. Add IndexNow ping function to server for article publishing
12. Install web-vitals and add Core Web Vitals tracking to PostHog
13. Verify all files are correctly placed and the build succeeds with npm run build

IMPORTANT CONSTRAINTS:
- Follow SPECTRE_DESIGN_LAW.md for any UI changes
- Follow CLAUDE.md for code style, imports, and git workflow
- Use @/ import aliases per CLAUDE.md rules
- Do NOT break existing functionality
- The website is in the website2 folder (not website)
- There is a /lp subpage and an /api subpage that need their own meta
- Commit all changes to prod branch
```

---

## 14. ONGOING GEO MAINTENANCE

### Weekly
- Publish 2-3 Intelligence Hub articles with proper NewsArticle schema
- Update llms.txt if new pages/features launch
- Check Google Search Console for crawl errors

### Monthly
- Update sitemap.xml with new pages
- Refresh FAQ schema with new questions from user search data (PostHog)
- Audit AI citation: ask ChatGPT, Claude, Perplexity "what is the best crypto intelligence platform" and track if Spectre appears
- Update comparison tables with latest data

### Quarterly
- Full robots.txt audit — add any new AI crawlers
- Content freshness update on all core pages (add "Updated Q2 2026" etc.)
- Competitor GEO audit — check what competitors are doing
- Performance audit — Core Web Vitals, Lighthouse
- Review PostHog funnels and optimize conversion paths

---

## 15. ENTITY AUTHORITY BUILDING (Off-Site GEO)

AI models give higher citation confidence to brands mentioned across multiple independent platforms:

1. **Wikipedia** — Create or contribute to a "Spectre AI" Wikipedia article (or ensure mention in crypto analytics category)
2. **GitHub** — Public repos, README with proper descriptions, GitHub Topics tagged
3. **Product Hunt** — Launch when ready
4. **Reddit** — r/cryptocurrency, r/defi, r/algotrading mentions
5. **YouTube** — Product demos, market analysis videos
6. **LinkedIn** — Company page with regular posts
7. **Medium / Substack** — Cross-post Intelligence Hub articles
8. **CoinGecko / CoinMarketCap** — Get $SPECT listed with full project info
9. **DeFi directories** — DefiLlama ecosystem, DappRadar
10. **Press releases** — Distributed via crypto news wires (begin generating AI citations within 14-21 days)
11. **Crypto Twitter/X** — Consistent posting, engagement, brand mentions by other accounts
12. **Academic/research citations** — Publish original data analysis that others reference
