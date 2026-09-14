import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { dossier } from '@/services/dossierApi'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import DossierCandles from './dossier-candles'
import './dossier-panel.css'

function Section({ title, pill, defaultOpen = false, children, extra }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`dossier-section ${open ? 'is-open' : 'is-closed'}`}>
      <button type="button" className="dossier-section-head" onClick={() => setOpen((v) => !v)}>
        <span className="chev" aria-hidden>{open ? '▾' : '▸'}</span>
        <span className="title">{title}</span>
        {pill}
        <span className="flex" />
        {extra}
      </button>
      {open && <div className="dossier-section-body">{children}</div>}
    </section>
  )
}

/**
 * Dossier loading skeleton — mirrors the real panel layout (header, chart hero,
 * KPI grid, sections) with a staggered shimmer sweep + a live "enriching" caption.
 * Replaces the old spinner (design system: shimmer skeletons only, never spinners).
 */
function DossierSkeleton({ t }) {
  return (
    <div className="dossier-panel dossier-skeleton" aria-busy="true" aria-label="Loading dossier">
      <div className="dsk-header">
        <div className="dsk-shimmer dsk-logo" />
        <div className="dsk-header-text">
          <div className="dsk-shimmer dsk-line dsk-line-name" />
          <div className="dsk-shimmer dsk-line dsk-line-ca" />
        </div>
        <div className="dsk-shimmer dsk-pill" />
      </div>

      <div className="dsk-shimmer dsk-chart" />

      <div className="dsk-kpis">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="dsk-kpi" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="dsk-shimmer dsk-line dsk-line-label" />
            <div className="dsk-shimmer dsk-line dsk-line-value" />
          </div>
        ))}
      </div>

      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="dsk-block">
          <div className="dsk-shimmer dsk-line dsk-line-title" />
          <div className="dsk-shimmer dsk-line dsk-line-text" />
          <div className="dsk-shimmer dsk-line dsk-line-text dsk-line-text--short" />
        </div>
      ))}

      <div className="dsk-caption">
        <span className="dsk-caption-dot" />
        <span className="dsk-caption-main">{t('dossier.enriching', 'Enriching dossier…')}</span>
        <span className="dsk-caption-sub">Spectre Data API · Scanner · Brain</span>
      </div>
    </div>
  )
}

// 2026-06-16 B1 regression fix: the 30s stream poll returns a fresh object every
// tick even when nothing changed, forcing a full-panel re-render. Shallow-compare
// the few fields the panel actually renders + a couple of array lengths so the
// setter can bail (return prev). Mirrors the SSE skip-on-unchanged style in
// use-research-zone-data.js. NOT a deep equal - that would be expensive per tick.
function isSameDossier(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  const am = a.market || {}, bm = b.market || {}
  const af = a.flows || {}, bf = b.flows || {}
  const as = a.safety || {}, bs = b.safety || {}
  return (
    am.priceUsd === bm.priceUsd &&
    am.updatedAt === bm.updatedAt &&
    am.change24h === bm.change24h &&
    af.updatedAt === bf.updatedAt &&
    as.checkedAt === bs.checkedAt &&
    (a.identity?.symbol || '') === (b.identity?.symbol || '') &&
    (Array.isArray(a.brainAnnotations) ? a.brainAnnotations.length : 0) ===
      (Array.isArray(b.brainAnnotations) ? b.brainAnnotations.length : 0) &&
    (Array.isArray(af.smartMoneyTags) ? af.smartMoneyTags.length : 0) ===
      (Array.isArray(bf.smartMoneyTags) ? bf.smartMoneyTags.length : 0) &&
    (Array.isArray(as.flags) ? as.flags.length : 0) ===
      (Array.isArray(bs.flags) ? bs.flags.length : 0)
  )
}

// 2026-05-26 beta-quality fix: guard NaN/Infinity (toLocaleString and toFixed
// both render "NaN" on bad inputs — caller can't tell stale from real).
const fmt = (n) => {
  const v = Number(n)
  if (n == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
const fmtUsd = (n) => {
  const v = Number(n)
  if (n == null || !Number.isFinite(v)) return '—'
  return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
const fmtPct = (n) => {
  const v = Number(n)
  if (n == null || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}
const rel = (ts) => {
  if (!ts) return '—'
  // 2026-06-10: parse first - the spectre-api backend sends ISO strings, and
  // `Date.now() - "<iso>"` is NaN ("NaNh ago" all over the panel).
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime()
  if (!Number.isFinite(ms)) return '—'
  // 2026-05-26 beta-quality fix: clamp future timestamps to 0.
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

export default function DossierPanel({ chain, ca, initialData = null, pollMs = 30000, watchlist = null }) {
  const { t } = useTranslation()
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(null)
  const [enriching, setEnriching] = useState(false)
  const [signals, setSignals] = useState([])
  const [pools, setPools] = useState([])
  const [bmap, setBmap] = useState(null)

  const load = useCallback(async ({ firstTime = false } = {}) => {
    if (!chain || !ca) return
    try {
      setError(null)
      // First hit = blocking full enrichment so every section lands populated.
      // Subsequent polls = stream mode (instant return, enrichment runs server-side).
      const d = await dossier.lookup(chain, ca, { stream: !firstTime })
      // Skip the re-render when the poll returns byte-fresh-but-unchanged data.
      setData((prev) => (isSameDossier(prev, d) ? prev : d))
    } catch (err) {
      setError(err.message || 'Dossier error')
    } finally {
      setLoading(false)
    }
  }, [chain, ca])

  const enrichAll = useCallback(async () => {
    if (!chain || !ca || enriching) return
    setEnriching(true)
    try {
      await Promise.allSettled([
        dossier.refreshSafety(chain, ca),
        dossier.refreshSocials(chain, ca),
        dossier.refreshFlows(chain, ca),
      ])
      try { await dossier.generateLore(chain, ca, { force: true }) } catch (_) {}
    } finally {
      setEnriching(false)
      // Bypass the short-TTL cache so the post-enrichment reload is fresh.
      dossier.invalidate(chain, ca)
      load()
    }
  }, [chain, ca, enriching, load])

  useEffect(() => { load({ firstTime: true }) }, [load])

  // Fetch pool breakdown + bubblemaps link (one-time per token).
  useEffect(() => {
    if (!chain || !ca) return
    let cancelled = false
    const load = async () => {
      try {
        // Research Zone mounts this panel in ASSET mode (chain="asset",
        // ca=SYMBOL). Bubblemaps is keyed by a real chain + contract, so in
        // asset mode the request can only 404 - skip it instead of printing a
        // red line on every Dossier open.
        const wantsBmap = chain !== 'asset'
        const [p, b] = await Promise.allSettled([
          dossier.pools(chain, ca),
          wantsBmap ? dossier.bubblemaps(chain, ca) : Promise.resolve(null),
        ])
        if (cancelled) return
        if (p.status === 'fulfilled') setPools(p.value.pools || [])
        if (wantsBmap && b.status === 'fulfilled') setBmap(b.value)
      } catch (_) {}
    }
    load()
  }, [chain, ca])
  // Pull the token's own signals feed.
  const loadSigs = useCallback(async () => {
    if (!chain || !ca) return
    try {
      // No server-side filter for single-ca yet — pull recent and filter client-side.
      const d = await dossier.signals({ chain, limit: 200 })
      const mine = (d.signals || []).filter((s) => (s.ca || '').toLowerCase() === (ca || '').toLowerCase())
      setSignals(mine.slice(0, 8))
    } catch (_) {}
  }, [chain, ca])
  useEffect(() => { loadSigs() }, [loadSigs])

  // One coordinated poll driver for the per-token feeds. useAdaptivePolling
  // slows when the tab is hidden and stops entirely once the tab has been idle
  // past idleTimeout (the document.hidden || !isAppActive() gold standard),
  // replacing the raw setInterval polls that only checked document.hidden.
  const pollLookup = useCallback(() => { load({ firstTime: false }) }, [load])
  useAdaptivePolling(pollLookup, { interval: pollMs || 30000, enabled: !!pollMs })
  useAdaptivePolling(loadSigs, { interval: 30000 })

  if (loading && !data) {
    return <DossierSkeleton t={t} />
  }
  if (error && !data) return <div className="dossier-panel dossier-error">{t('dossier.unavailable', 'Dossier unavailable')}: {error}</div>
  if (!data) return null

  const { identity, market, safety, socials, lore, flows, holders, mindshare, brainAnnotations = [] } = data
  const label = identity?.symbol || identity?.name || (ca || '').slice(0, 10)
  const hasSafetyFlags = safety && (safety.isHoneypot || (safety.flags && safety.flags.length))

  return (
    <div className="dossier-panel">
      <header className="dossier-header">
        {identity?.logo && <img src={identity.logo} alt="" className="dossier-logo" />}
        <div className="dossier-title">
          <div className="dossier-name">
            <strong>{label}</strong>
            <span className="dossier-chain">{identity?.chain}</span>
          </div>
          <div className="dossier-ca mono">{identity?.ca}</div>
        </div>
        <div className="dossier-updated">
          <div className="dossier-actions">
            {watchlist && (
              <button
                className={`dossier-pin-btn ${watchlist.has(chain, ca) ? 'is-pinned' : ''}`}
                onClick={() => watchlist.toggle({ chain, ca, symbol: identity?.symbol, logo: identity?.logo })}
                title={watchlist.has(chain, ca) ? t('dossier.unpinFromWatchlist', 'Unpin from watchlist') : t('dossier.pinToWatchlist', 'Pin to watchlist')}
              >
                <span aria-hidden>{watchlist.has(chain, ca) ? '★' : '☆'}</span>
                {watchlist.has(chain, ca) ? t('dossier.pinned', 'Pinned') : t('dossier.pin', 'Pin')}
              </button>
            )}
            <button className="dossier-btn dossier-btn-primary" onClick={enrichAll} disabled={enriching}>
              {enriching ? t('dossier.enrichingShort', 'Enriching…') : t('dossier.refreshAll', 'Refresh all')}
            </button>
          </div>
          <span className="dossier-ts">{t('dossier.marketLabel', 'market')} {rel(market?.updatedAt)}</span>
        </div>
      </header>

      {/* CHART — always rendered, not collapsible (it's the hero) */}
      {market ? (
        <div className="dossier-chart-wrap">
          <DossierCandles chain={chain} ca={ca} height={260} />
          <div className="dossier-kpis dossier-kpis-compact">
            <div className="dossier-kpi"><span className="label">{t('common.price', 'Price')}</span><span className="value mono">{fmtUsd(market.priceUsd)}</span></div>
            <div className="dossier-kpi"><span className="label">{t('dossier.change24h', '24h')}</span><span className={`value mono ${(market.change24h || 0) >= 0 ? 'bull' : 'bear'}`}>{fmtPct(market.change24h)}</span></div>
            <div className="dossier-kpi"><span className="label">{t('dossier.mcap', 'Mcap')}</span><span className="value mono">{fmtUsd(market.mcap || market.fdv)}</span></div>
            <div className="dossier-kpi"><span className="label">{t('common.volume24h', 'Vol 24h')}</span><span className="value mono">{fmtUsd(market.vol24h)}</span></div>
            <div className="dossier-kpi"><span className="label">{t('common.liquidity', 'Liquidity')}</span><span className="value mono">{fmtUsd(market.liquidity)}</span></div>
            <div className="dossier-kpi"><span className="label">{t('dossier.source', 'Source')}</span><span className="value mono">{market.priceSource || '—'}</span></div>
          </div>
        </div>
      ) : (
        <div className="muted dossier-chart-empty">{t('dossier.noMarketData', 'No market data yet — worker cooking.')}</div>
      )}

      {/* PROJECT — what the team says */}
      <Section title={t('dossier.project', 'Project')} defaultOpen>
        {lore?.projectDescription ? (
          <>
            <p className="dossier-lore">{lore.projectDescription}</p>
            <div className="dossier-ts">{t('dossier.officialSources', 'official sources')} · {rel(lore.projectGeneratedAt)}</div>
          </>
        ) : lore?.narrative ? (
          <p className="dossier-lore muted-soft">{lore.narrative}</p>
        ) : (
          <div className="muted">{t('dossier.noDescription', 'No description yet.')} <button className="dossier-btn" onClick={async () => { try { await dossier.generateLore(chain, ca, { force: true }); dossier.invalidate(chain, ca); load() } catch (_) {} }}>{t('dossier.generate', 'Generate')}</button></div>
        )}
      </Section>

      {/* NARRATIVE — what the street says */}
      <Section title={t('dossier.narrative', 'Narrative')} defaultOpen pill={lore?.narrativeVerdict && <span className={`dossier-pill verdict-${lore.narrativeVerdict}`}>{t('dossier.verdict', 'verdict')}: {lore.narrativeVerdict}</span>}>
        {lore?.communityNarrative ? (
          <>
            <p className="dossier-lore">{lore.communityNarrative.replace(/\nVerdict:.*/i, '').trim()}</p>
            <div className="dossier-ts">{t('dossier.streetTake', 'street take')} · {rel(lore.narrativeGeneratedAt)}</div>
          </>
        ) : (
          <div className="muted">{t('dossier.noStreetTake', 'No street take yet.')} <button className="dossier-btn" onClick={async () => { try { await dossier.generateLore(chain, ca, { force: true }); dossier.invalidate(chain, ca); load() } catch (_) {} }}>{t('dossier.generate', 'Generate')}</button></div>
        )}
      </Section>

      {/* FLOWS — the mind's favorite, open by default */}
      <Section title={t('dossier.flows24h', 'Flows (24h)')} defaultOpen>
        {flows ? (
          <>
            <div className="dossier-kpis">
              <div className="dossier-kpi"><span className="label">{t('dossier.buys', 'Buys')}</span><span className="value bull mono">{fmt(flows.buys24h)}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.sells', 'Sells')}</span><span className="value bear mono">{fmt(flows.sells24h)}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.buyDollar', 'Buy $')}</span><span className="value bull mono">{fmtUsd(flows.buyVol24h)}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.sellDollar', 'Sell $')}</span><span className="value bear mono">{fmtUsd(flows.sellVol24h)}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.netDollar', 'Net $')}</span><span className={`value mono ${flows.netVol24h >= 0 ? 'bull' : 'bear'}`}>{fmtUsd(flows.netVol24h)}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.uniqueBuyers', 'Unique buyers')}</span><span className="value mono">{fmt(flows.uniqueBuyers24h)}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.uniqueSellers', 'Unique sellers')}</span><span className="value mono">{fmt(flows.uniqueSellers24h)}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.smartMoney', 'Smart money')}</span><span className={`value mono ${flows.smartMoneyNet24h > 0 ? 'bull' : flows.smartMoneyNet24h < 0 ? 'bear' : ''}`}>{fmtUsd(flows.smartMoneyNet24h)}</span></div>
            </div>
            {Array.isArray(flows.smartMoneyTags) && flows.smartMoneyTags.length > 0 && (
              <div className="dossier-flags">
                {flows.smartMoneyTags.map((t) => <span key={t} className="dossier-pill dossier-pill-info">{t}</span>)}
              </div>
            )}
            <div className="dossier-ts">{t('dossier.updated', 'updated')} {rel(flows.updatedAt)}</div>
          </>
        ) : (
          <div className="muted">{t('dossier.noFlowSnapshot', 'No flow snapshot yet.')} <button className="dossier-btn" onClick={async () => { try { await dossier.refreshFlows(chain, ca); dossier.invalidate(chain, ca); load() } catch (_) {} }}>{t('dossier.fetchNow', 'Fetch now')}</button></div>
        )}
      </Section>

      {/* SAFETY */}
      <Section title={t('dossier.safety', 'Safety')} defaultOpen>
        {safety ? (
          <div className="dossier-safety">
            <div className="dossier-kpis">
              <div className="dossier-kpi"><span className="label">{t('dossier.honeypot', 'Honeypot')}</span><span className={`value ${safety.isHoneypot ? 'bear' : 'bull'} mono`}>{safety.isHoneypot ? t('dossier.yes', 'YES') : t('dossier.no', 'No')}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.buySellTax', 'Buy / Sell tax')}</span><span className="value mono">{safety.buyTax != null ? safety.buyTax.toFixed(1) + '%' : '—'} / {safety.sellTax != null ? safety.sellTax.toFixed(1) + '%' : '—'}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.lpLocked', 'LP locked')}</span><span className={`value mono ${safety.lpLocked ? 'bull' : 'muted'}`}>{safety.lpLocked ? t('dossier.yesShort', 'Yes') : '—'}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.owner', 'Owner')}</span><span className={`value mono ${safety.ownerRenounced ? 'bull' : ''}`}>{safety.ownerRenounced ? t('dossier.renounced', 'renounced') : (safety.ownerShare != null ? `${safety.ownerShare.toFixed(1)}%` : '—')}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.mintable', 'Mintable')}</span><span className={`value mono ${safety.mintable ? 'bear' : 'bull'}`}>{safety.mintable ? t('dossier.yesShort', 'Yes') : t('dossier.no', 'No')}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.proxy', 'Proxy')}</span><span className={`value mono ${safety.proxy ? 'bear' : ''}`}>{safety.proxy ? t('dossier.yesShort', 'Yes') : t('dossier.no', 'No')}</span></div>
            </div>
            {hasSafetyFlags && Array.isArray(safety.flags) && safety.flags.length > 0 && (
              <div className="dossier-flags">{safety.flags.map((f) => <span key={f} className="dossier-pill dossier-pill-warn">{f}</span>)}</div>
            )}
            <div className="dossier-ts">{t('dossier.checked', 'checked')} {rel(safety.checkedAt)} · {safety.source}</div>
          </div>
        ) : (
          <div className="muted">{t('dossier.notYetChecked', 'Not yet checked.')} <button className="dossier-btn" onClick={async () => { try { await dossier.refreshSafety(chain, ca); dossier.invalidate(chain, ca); load() } catch (_) {} }}>{t('dossier.checkNow', 'Check now')}</button></div>
        )}
      </Section>

      {/* SOCIALS */}
      <Section title={t('dossier.socials', 'Socials')}>
        {socials && (socials.twitter || socials.website || socials.telegram || socials.discord || socials.github || socials.twitterBio) ? (
          <>
            <div className="dossier-socials">
              {socials.twitter && <a target="_blank" rel="noopener noreferrer" href={`https://x.com/${socials.twitter}`} className="dossier-link">X / @{socials.twitter}</a>}
              {socials.telegram && <a target="_blank" rel="noopener noreferrer" href={`https://telegram.me/${socials.telegram}`} className="dossier-link">{t('dossier.telegram', 'Telegram')}</a>}
              {socials.website && <a target="_blank" rel="noopener noreferrer" href={socials.website} className="dossier-link">{t('nav.website', 'Website')}</a>}
              {socials.discord && <a target="_blank" rel="noopener noreferrer" href={socials.discord} className="dossier-link">{t('dossier.discord', 'Discord')}</a>}
              {socials.github && <a target="_blank" rel="noopener noreferrer" href={socials.github} className="dossier-link">{t('dossier.github', 'GitHub')}</a>}
            </div>
            {socials.twitterBio && <p className="dossier-lore muted-soft">{socials.twitterBio.slice(0, 500)}{socials.twitterBio.length > 500 ? '…' : ''}</p>}
          </>
        ) : (
          <div className="muted">{t('dossier.noSocialLinks', 'No social links indexed.')} <button className="dossier-btn" onClick={async () => { try { await dossier.refreshSocials(chain, ca); dossier.invalidate(chain, ca); load() } catch (_) {} }}>{t('dossier.searchNow', 'Search now')}</button></div>
        )}
      </Section>

      {/* LIQUIDITY POOLS */}
      {pools.length > 0 && (
        <Section title={t('dossier.liquidityPools', 'Liquidity Pools')} pill={<span className="dossier-pill dossier-pill-muted mono">{pools.length}</span>}>
          <div className="dossier-pools">
            {pools.slice(0, 6).map((p, i) => (
              <div key={i} className="dossier-pool">
                <div className="pool-top">
                  <span className="pool-dex">{p.dex || '—'}</span>
                  <span className="pool-quote mono">/{p.quote || '?'}</span>
                  {Array.isArray(p.labels) && p.labels.length > 0 && p.labels.map((l) => <span key={l} className="dossier-pill dossier-pill-muted mono">{l}</span>)}
                </div>
                <div className="pool-kpis mono">
                  <span><span className="label">{t('dossier.liq', 'Liq')}</span> {fmtUsd(p.liquidity)}</span>
                  <span><span className="label">{t('dossier.vol24h', '24h vol')}</span> {fmtUsd(p.volume24h)}</span>
                  {p.pairCreatedAt && <span><span className="label">{t('common.age', 'Age')}</span> {rel(p.pairCreatedAt)}</span>}
                </div>
              </div>
            ))}
            {pools.length > 6 && <div className="muted">+{pools.length - 6} {t('dossier.morePools', 'more pools')}</div>}
          </div>
        </Section>
      )}

      {/* HOLDER CLUSTERS — BubbleMaps */}
      {bmap?.viewUrl && (
        <Section title={t('dossier.holderClusters', 'Holder Clusters')}>
          <a className="dossier-bubbles-card" href={bmap.viewUrl} target="_blank" rel="noopener noreferrer">
            <div className="bubbles-graphic">
              <span className="b b1" /><span className="b b2" /><span className="b b3" /><span className="b b4" /><span className="b b5" />
            </div>
            <div className="bubbles-copy">
              <div className="bubbles-title">{t('dossier.openOnBubbleMaps', 'Open on BubbleMaps ↗')}</div>
              <div className="bubbles-sub">{t('dossier.bubbleMapsDesc', 'Visual holder clusters, funding sources, wallet linkages — renders in a new tab (BubbleMaps blocks third-party embeds).')}</div>
            </div>
          </a>
        </Section>
      )}

      {/* HOLDERS + MINDSHARE */}
      {(holders || mindshare) && (
        <Section title={t('dossier.holdersMindshare', 'Holders & Mindshare')}>
          <div className="dossier-kpis">
            {holders && <>
              <div className="dossier-kpi"><span className="label">{t('dossier.totalHolders', 'Total holders')}</span><span className="value mono">{fmt(holders.totalHolders)}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.top10Pct', 'Top 10%')}</span><span className="value mono">{holders.top10Pct != null ? holders.top10Pct.toFixed(1) + '%' : '—'}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.devPct', 'Dev %')}</span><span className="value mono">{holders.devBalancePct != null ? holders.devBalancePct.toFixed(1) + '%' : '—'}</span></div>
            </>}
            {mindshare && <>
              <div className="dossier-kpi"><span className="label">{t('dossier.mindshare', 'Mindshare')}</span><span className="value mono">{mindshare.mindsharePct != null ? mindshare.mindsharePct.toFixed(2) + '%' : '—'}</span></div>
              <div className="dossier-kpi"><span className="label">{t('common.rank', 'Rank')}</span><span className="value mono">{fmt(mindshare.rank)}</span></div>
              <div className="dossier-kpi"><span className="label">{t('dossier.mentions24h', 'Mentions 24h')}</span><span className="value mono">{fmt(mindshare.mentions24h)}</span></div>
            </>}
          </div>
        </Section>
      )}

      {/* SCANNER SIGNALS + BRAIN TAKES */}
      {signals.length > 0 && (
        <Section title={t('dossier.scannerSignals', 'Scanner signals for this token')} pill={<span className="dossier-pill dossier-pill-muted mono">{signals.length}</span>}>
          <div className="dossier-takes">
            {signals.map((s) => (
              <div key={s.id} className={`dossier-take ${s.score >= 80 ? 'warning' : 'take'}`}>
                <div><strong>{s.kind}</strong> · {t('common.score', 'score')} {Math.round(s.score || 0)}</div>
                <div>{s.narrative}</div>
                <div className="dossier-ts mono">{rel(s.detectedAt)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {brainAnnotations.length > 0 && (
        <Section title={t('dossier.spectreBrainTakes', 'Spectre Brain takes')} pill={<span className="dossier-pill dossier-pill-muted mono">{brainAnnotations.length}</span>}>
          <div className="dossier-takes">
            {brainAnnotations.map((a, i) => (
              <div key={i} className={`dossier-take ${a.kind}`}>
                <div>{a.body}</div>
                <div className="dossier-ts mono">{a.kind} · {t('dossier.conf', 'conf')} {(a.confidence || 0).toFixed(2)} · {rel(a.createdAt)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
