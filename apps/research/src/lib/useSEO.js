// ════════════════════════════════════════════════════════════════════
// useSEO — lightweight, framework-free per-page SEO metadata manager
// ════════════════════════════════════════════════════════════════════
//
// Why not react-helmet-async? We want zero new dependencies for a feature
// that is mostly cosmetic for human users (AI crawlers read the static
// index.html shell, which already contains the comprehensive meta +
// JSON-LD). This hook mutates document.title and the relevant <meta>
// tags when a page mounts and restores them when it unmounts.
//
// Usage:
//   import { useSEO } from '@/lib/useSEO'
//
//   function ApiPage() {
//     useSEO({
//       title: 'Spectre AI API — 500+ Crypto Data Endpoints',
//       description: '...',
//       canonical: 'https://spectreai.io/website2/api',
//       ogImage: 'https://spectreai.io/og-image.png',
//     })
//     return (<div>...</div>)
//   }
//
// ════════════════════════════════════════════════════════════════════

import { useEffect } from 'react'

const SITE_URL = 'https://spectreai.io'
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`

function setMeta(attr, key, value) {
  if (typeof document === 'undefined' || !value) return null
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  const created = !el
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  const prev = el.getAttribute('content')
  el.setAttribute('content', value)
  return { el, prev, created }
}

function setLink(rel, href) {
  if (typeof document === 'undefined' || !href) return null
  let el = document.head.querySelector(`link[rel="${rel}"]`)
  const created = !el
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  const prev = el.getAttribute('href')
  el.setAttribute('href', href)
  return { el, prev, created }
}

function setJsonLd(id, data) {
  if (typeof document === 'undefined' || !data) return null
  let el = document.head.querySelector(`script[data-seo-id="${id}"]`)
  const created = !el
  if (!el) {
    el = document.createElement('script')
    el.type = 'application/ld+json'
    el.setAttribute('data-seo-id', id)
    document.head.appendChild(el)
  }
  const prev = el.textContent
  el.textContent = JSON.stringify(data)
  return { el, prev, created }
}

export function useSEO({
  title,
  description,
  canonical,
  keywords,
  ogTitle,
  ogDescription,
  ogImage,
  ogType = 'website',
  twitterTitle,
  twitterDescription,
  twitterImage,
  jsonLd, // { id: 'api-page', data: { ... } }
} = {}) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    const prevTitle = document.title
    if (title) document.title = title

    const ops = []
    if (description) ops.push(setMeta('name', 'description', description))
    if (keywords) ops.push(setMeta('name', 'keywords', keywords))
    if (canonical) ops.push(setLink('canonical', canonical))

    // Open Graph
    ops.push(setMeta('property', 'og:title', ogTitle || title))
    ops.push(setMeta('property', 'og:description', ogDescription || description))
    ops.push(setMeta('property', 'og:url', canonical))
    ops.push(setMeta('property', 'og:image', ogImage || DEFAULT_OG_IMAGE))
    ops.push(setMeta('property', 'og:type', ogType))

    // Twitter
    ops.push(setMeta('name', 'twitter:title', twitterTitle || ogTitle || title))
    ops.push(setMeta('name', 'twitter:description', twitterDescription || ogDescription || description))
    ops.push(setMeta('name', 'twitter:image', twitterImage || ogImage || DEFAULT_OG_IMAGE))

    // Inline JSON-LD
    let jsonLdOp = null
    if (jsonLd && jsonLd.id && jsonLd.data) {
      jsonLdOp = setJsonLd(jsonLd.id, jsonLd.data)
    }

    return () => {
      // Restore
      if (title) document.title = prevTitle
      for (const op of ops) {
        if (!op) continue
        if (op.created && op.el?.parentNode) {
          op.el.parentNode.removeChild(op.el)
        } else if (op.prev != null && op.el) {
          op.el.setAttribute('content', op.prev)
        }
      }
      if (jsonLdOp) {
        if (jsonLdOp.created && jsonLdOp.el?.parentNode) {
          jsonLdOp.el.parentNode.removeChild(jsonLdOp.el)
        } else if (jsonLdOp.prev && jsonLdOp.el) {
          jsonLdOp.el.textContent = jsonLdOp.prev
        }
      }
    }
  }, [
    title,
    description,
    canonical,
    keywords,
    ogTitle,
    ogDescription,
    ogImage,
    ogType,
    twitterTitle,
    twitterDescription,
    twitterImage,
    jsonLd?.id,
    jsonLd?.data && JSON.stringify(jsonLd.data),
  ])
}

// ────────────────────────────────────────────────────────────────────
// Centralized page presets. Pages import these to get consistent SEO.
// ────────────────────────────────────────────────────────────────────

export const SEO_PRESETS = {
  home: {
    title: 'Spectre AI — Crypto Market Intelligence Platform',
    description: 'Real-time crypto intelligence combining on-chain analytics, AI market analysis, social sentiment, and trading tools for 10,000+ tokens. 500+ API endpoints. MCP server for AI agents.',
    canonical: `${SITE_URL}/`,
    keywords: 'crypto intelligence, cryptocurrency analytics, AI crypto analysis, on-chain data, fear and greed index, crypto API, MCP server',
  },
  website2: {
    title: 'Spectre AI — The All-in-One Crypto Intelligence Platform',
    description: 'Replace Nansen, DeFiLlama, Dune, CoinGlass, LunarCrush, and Messari with one platform. Real-time data, AI insights, trading tools, and 500+ API endpoints.',
    canonical: `${SITE_URL}/website2`,
    keywords: 'crypto intelligence platform, alternative to Nansen, alternative to DeFiLlama, alternative to Dune, crypto dashboard',
  },
  api: {
    title: 'Spectre AI API — 500+ Crypto Data Endpoints, MCP Server, x402 Payments',
    description: 'Access real-time crypto market data via 500+ REST endpoints, WebSocket feeds, MCP server for AI agents, and x402 micropayments. TypeScript and Python SDKs available.',
    canonical: `${SITE_URL}/website2/api`,
    keywords: 'crypto API, cryptocurrency API, MCP server, x402 payments, crypto data endpoints, crypto WebSocket, AI agent crypto data',
    jsonLd: {
      id: 'api-page-webapi',
      data: {
        '@context': 'https://schema.org',
        '@type': 'WebAPI',
        name: 'Spectre AI API',
        description: '500+ REST API endpoints for real-time cryptocurrency market data, on-chain analytics, social intelligence, and AI-generated insights. MCP server for AI agents and x402 micropayments.',
        url: `${SITE_URL}/website2/api`,
        documentation: 'https://docs.spectreai.io',
        provider: { '@type': 'Organization', name: 'Spectre AI', url: SITE_URL },
        category: ['Financial Data', 'Cryptocurrency', 'Market Intelligence', 'AI Integration'],
      },
    },
  },
  intelligence: {
    title: 'Spectre Intelligence Hub — AI-Generated Crypto Market Analysis',
    description: 'AI-curated cryptocurrency market analysis, breaking news, daily briefs, and deep research. Updated continuously by Spectre AI agents across 10,000+ tokens.',
    canonical: `${SITE_URL}/intelligence`,
    keywords: 'crypto news, cryptocurrency analysis, AI crypto research, daily crypto brief, market analysis, breaking crypto news',
  },
  researchZone: {
    title: 'Research Zone — Deep Crypto Token Analysis | Spectre AI',
    description: 'Deep-dive token analytics with on-chain metrics, social sentiment, liquidity analysis, and AI-generated insights for any cryptocurrency.',
    canonical: `${SITE_URL}/research-zone`,
    keywords: 'crypto research, token analysis, on-chain metrics, token fundamentals, crypto due diligence',
  },
  fearGreed: {
    title: 'Crypto Fear & Greed Index — Real-Time Market Sentiment | Spectre AI',
    description: 'Multi-factor crypto market sentiment indicator aggregating volatility, volume, social sentiment, dominance, and on-chain signals. Live 0-100 reading.',
    canonical: `${SITE_URL}/fear-greed`,
    keywords: 'crypto fear and greed index, crypto sentiment, market fear, bitcoin fear and greed',
  },
  economicCalendar: {
    title: 'Crypto Economic Calendar — FOMC, CPI, Token Unlocks | Spectre AI',
    description: '657 market-moving events from 9 sources with 4-tier impact filtering. FOMC, CPI, NFP, central bank decisions, token unlocks, IPO dates.',
    canonical: `${SITE_URL}/economic-calendar`,
    keywords: 'crypto economic calendar, FOMC, CPI, token unlocks, crypto events, market calendar',
  },
  monarch: {
    title: 'Monarch AI — Conversational Crypto Analyst | Spectre AI',
    description: 'AI-powered conversational analyst with real-time market data integration. Ask any crypto question and get instant, data-backed answers.',
    canonical: `${SITE_URL}/monarch-chat`,
    keywords: 'AI crypto chat, crypto AI agent, Monarch AI, conversational crypto AI',
  },
}
