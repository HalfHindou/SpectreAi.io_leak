import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * RwaPulseCard
 * Vertical, dense version of RwaNewsStrip — used inside the Command Ops
 * intel row (ROW 2). Same data + same scoring; different layout.
 *
 * The horizontal version remains in `creatives/RwaNewsStrip.jsx`.
 */

const KW_BREAKING = ['exploit', 'hack', 'attack', 'drain', 'stolen', 'paused', 'halt', 'sec sues', 'sec charges']
const KW_PROTOCOLS = [
  'aave', 'ondo', 'maker', 'makerdao', 'sky', 'usdc', 'usdt', 'tether', 'circle',
  'blackrock', 'buidl', 'franklin', 'benji', 'centrifuge', 'maple', 'goldfinch',
  'ethena', 'usde', 'dai', 'usds', 'clearpool', 'anemoy', 'superstate', 'openeden',
  'hashnote', 'paxos', 'anzen', 'plume', 'xstocks', 'backed', 'swarm',
]
const KW_TOPICS = [
  'rwa', 'tokeniz', 'real-world asset', 'real world asset',
  'treasur', 'treasuries', 't-bill', 'tbill', 'treasury bill',
  'stablecoin', 'money market fund', 'private credit',
  'yield-bearing', 'yield bearing', 'tokenized stock', 'etf on-chain',
  'asset-backed', 'asset backed', 'on-chain bond', 'on-chain securit',
  'regulat', 'genius act', 'mica',
]

function score(title, summary) {
  const text = ((title || '') + ' ' + (summary || '')).toLowerCase()
  if (!text) return 0
  // Hard requirement: at least ONE RWA topic keyword must appear.
  // Pure crypto-hack / generic ETH news must NOT pass through.
  let hasTopic = false
  for (const k of KW_TOPICS) if (text.includes(k)) { hasTopic = true; break }
  if (!hasTopic) {
    // Also accept if a known RWA protocol is named (e.g. BUIDL, Ondo, Centrifuge)
    let hasProto = false
    for (const k of KW_PROTOCOLS) if (text.includes(k)) { hasProto = true; break }
    if (!hasProto) return 0
  }
  let s = 0
  for (const k of KW_BREAKING) if (text.includes(k)) s += 20
  for (const k of KW_PROTOCOLS) if (text.includes(k)) s += 5
  for (const k of KW_TOPICS) if (text.includes(k)) s += 3
  return s
}

function relTime(iso) {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  if (!d) return ''
  const sec = Math.max(0, Math.floor((Date.now() - d) / 1000))
  // Backend stamps fetch-time on items so anything < 5 minutes is effectively "fresh"
  if (sec < 300) return 'NOW'
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const STALE_MS = 3 * 24 * 60 * 60 * 1000

export default function RwaPulseCard({ onSeeAll }) {
  const { t } = useTranslation()
  const [items, setItems] = useState(null)
  const listRef = React.useRef(null)
  const handleSeeAll = () => {
    if (onSeeAll) return onSeeAll()
    listRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/news/rss?limit=60')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        const results = Array.isArray(json.results) ? json.results : []
        if (!cancelled) setItems(results)
      } catch {
        if (!cancelled) setItems([])
      }
    })()
    return () => { cancelled = true }
  }, [])

  const ranked = useMemo(() => {
    if (!items) return null
    const now = Date.now()
    return items
      .map(it => ({ ...it, _score: score(it.title, it.summary) }))
      .filter(it => it._score > 0)
      .filter(it => {
        const ts = new Date(it.publishedAt || 0).getTime()
        return ts && (now - ts) < STALE_MS
      })
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      })
      .slice(0, 12)
  }, [items])

  const loading = ranked === null

  return (
    <section className="rpc" aria-label={t('tokenizedAssets.pulse.ariaLabel', 'RWA Pulse')}>
      <header className="rpc__head">
        <span className="rpc__title">{t('tokenizedAssets.pulse.title', 'RWA Pulse')}</span>
        <span className="rpc__sub">{t('tokenizedAssets.pulse.subtitle', 'Top narratives moving the market')}</span>
      </header>

      {loading ? (
        <ul className="rpc__list">
          {[0, 1, 2, 3].map(i => (
            <li key={i} className="rpc__item">
              <div className={`rpc__skel-line animate-shimmer stagger-${(i % 5) + 1}`} />
              <div className={`rpc__skel-line rpc__skel-line--sub animate-shimmer stagger-${(i % 5) + 1}`} />
            </li>
          ))}
        </ul>
      ) : !ranked?.length ? (
        <div className="rpc__empty">{t('tokenizedAssets.pulse.empty', 'No recent RWA headlines.')}</div>
      ) : (
        <ul className="rpc__list" ref={listRef}>
          {ranked.map(it => {
            const breaking = it._score >= 20
            return (
              <li key={it.id || it.url} className="rpc__item">
                <div className="rpc__row1">
                  {breaking && <span className="rpc__flag">{t('tokenizedAssets.pulse.breaking', 'BREAKING')}</span>}
                  <span className="rpc__time mono">{relTime(it.publishedAt)}</span>
                </div>
                <a
                  className="rpc__title-link"
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {it.title}
                </a>
                <div className="rpc__src">{it.source || t('tokenizedAssets.pulse.newsLabel', 'News')}</div>
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" className="rpc__cta" onClick={handleSeeAll}>
        {t('tokenizedAssets.pulse.viewAllNews', 'View All News')} <span aria-hidden>&rarr;</span>
      </button>
    </section>
  )
}
