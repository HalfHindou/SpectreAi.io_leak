/**
 * XDThesis — "Spectre AI · Social Market Read" panel.
 *
 * A full-width editorial card that sits between the X Dash view tabs and the
 * view body. Renders the thesis distilled from the social corpus by the
 * Spectre Data API (/v1/social/thesis), consumed via useXDashThesis.
 *
 * Design: copies the Sectors AI-analysis card (`.sec-analysis`) language —
 * bias-aware glow + live pulse dot + "Spectre AI" badge — and the AI Market
 * panel's editorial-serif headline + bold-the-numbers thesis treatment.
 * All classes are `xd-thesis*`-prefixed; CSS lives in x-dash-page.css
 * (+ day-mode counterpart).
 *
 * Tolerates a partial / stale / fallback payload: every section renders only
 * when its data is present, and the whole card no-ops if there's nothing to
 * show.
 *
 * JSON contract consumed (see useXDashThesis for the full shape):
 *   { generated_at, reference_now, stale?,
 *     regime:{ label, fear_greed, btc_dominance, total_mcap_change_24h, summary },
 *     sectors:[ { sector, heat, social_metric_label, token_count,
 *                 driving_tokens:[{symbol, why}], read } ],
 *     big_accounts:[ { handle, followers, pushing:[symbol], gist } ],
 *     smart_money:[ { asset, action, amount_usd, read } ],
 *     convergence:[ { asset, conviction, sources_firing, social, capital_usd,
 *                     news, verdict } ],
 *     general_7d:{ headline, narrative, whats_working[], conviction_plays[],
 *                  froth_warnings[], sector_rotation[] },
 *     timeframed_24h:{ ...same shape... },
 *     proof:{ pg_win_rate_pct, pg_sample, top_fresh[] },
 *     dossier_notes:[ { asset, signals:[{claim, sentiment, severity}] } ],
 *     sources[] }
 *
 * NOTE: regime / sectors / big_accounts / smart_money / convergence / proof /
 * dossier_notes are TOP-LEVEL (shared across the 24h↔7d toggle). Only
 * general_7d / timeframed_24h switch with the toggle.
 */
import { useMemo, useState, useEffect, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeAiText } from '@/lib/sanitizeAiText'
import { findTokenSeedBySymbol } from '@/lib/xdash-token-seed'
import { useXDashThesis } from '@/hooks/useXDashThesis'
import { relativeTime, fmtUsd } from '../x-dash-utils'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import useSettingsStore from '@/store/useSettingsStore'
import XDRefinedBrief from '../xd-refined-brief'

// Bold tickers / dollar amounts / percentages so the eye catches the numbers
// first — mirrors ai-market-panel's buildThesis. Returns an HTML string; the
// input is sanitized first so it's safe to inject.
function boldenNumbers(text) {
  if (!text) return ''
  return sanitizeAiText(String(text))
    .replace(/(\$[\d,]+(?:\.\d+)?[KMBT]?)/g, '<strong>$1</strong>')
    .replace(/([+-]?\d+(?:\.\d+)?%)/g, '<strong>$1</strong>')
    .replace(/\$([A-Z][A-Z0-9]{1,9})\b/g, '<strong>$$$1</strong>')
}

// Compact follower formatter — 374K / 2.1M / 980.
function fmtFollowers(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(Math.round(n))
}

function regimeBias(label) {
  const l = String(label || '').toLowerCase()
  if (/(risk-on|bull|greed|euphoria|expansion|accumulat)/.test(l)) return 'bullish'
  if (/(risk-off|bear|fear|capitulat|defensive|contraction)/.test(l)) return 'bearish'
  return 'neutral'
}

// conviction / severity / sentiment → tone bucket.
function convictionTone(conviction) {
  const c = String(conviction || '').toLowerCase()
  if (/high/.test(c)) return 'high'
  if (/(low|weak)/.test(c)) return 'low'
  return 'med'
}
function sentimentTone(sentiment) {
  const s = String(sentiment || '').toLowerCase()
  if (/(bull|positive|pos|up|good)/.test(s)) return 'bull'
  if (/(bear|negative|neg|down|bad|risk)/.test(s)) return 'bear'
  return 'neutral'
}
function actionTone(action) {
  const a = String(action || '').toLowerCase()
  if (/(buy|accumul|bid|long|inflow|add|enter|bought)/.test(a)) return 'bull'
  if (/(sell|distribut|exit|short|outflow|dump|trim|sold)/.test(a)) return 'bear'
  return 'neutral'
}

function Chip({ tone, symbol, label, why, score, scoreLabel, onOpen }) {
  const Tag = onOpen ? 'button' : 'div'
  return (
    <Tag
      type={onOpen ? 'button' : undefined}
      className={`xd-thesis-chip xd-thesis-chip--${tone}${onOpen ? ' xd-thesis-clk' : ''}`}
      title={why || undefined}
      onClick={onOpen || undefined}
    >
      <span className="xd-thesis-chip-head">
        <span className="xd-thesis-chip-sym xd-num">{symbol || label}</span>
        {score != null && (
          <span className="xd-thesis-chip-score xd-num">{Math.round(Number(score))}{scoreLabel || ''}</span>
        )}
      </span>
      {why && <span className="xd-thesis-chip-why">{sanitizeAiText(why)}</span>}
    </Tag>
  )
}

function RotationRow({ row }) {
  const dir = String(row?.direction || '').toLowerCase()
  const tone = /(in|into|inflow|rotating-in|up)/.test(dir) && !/out/.test(dir)
    ? 'pos'
    : /(out|outflow|rotating-out|down|fade)/.test(dir)
      ? 'neg'
      : 'flat'
  const arrow = tone === 'pos' ? '↗' : tone === 'neg' ? '↘' : '→'
  return (
    <div className="xd-thesis-rot-row">
      <span className="xd-thesis-rot-sector">{sanitizeAiText(row?.sector || '')}</span>
      <span className={`xd-thesis-rot-dir xd-thesis-rot-dir--${tone}`}>
        <span className="xd-thesis-rot-arrow" aria-hidden="true">{arrow}</span>
        {sanitizeAiText(row?.direction || '')}
      </span>
      {row?.social_vs_price && (
        <span className="xd-thesis-rot-svp">{sanitizeAiText(row.social_vs_price)}</span>
      )}
    </div>
  )
}

// ── Sectors — the centerpiece: which sectors, which tokens, why ──
function SectorCard({ sector, t, canOpen, openAsset }) {
  const name = sanitizeAiText(sector?.sector || '')
  const heat = Number(sector?.heat)
  const hasHeat = Number.isFinite(heat)
  // Heat rendered as a 0–100 bar (never a "%"). Clamp + scale generously so a
  // raw score of e.g. 7/10 or 70/100 both read sensibly.
  const heatPct = hasHeat
    ? Math.max(4, Math.min(100, heat <= 10 ? heat * 10 : heat))
    : 0
  const driving = Array.isArray(sector?.driving_tokens) ? sector.driving_tokens.slice(0, 6) : []
  const metricLabel = sector?.social_metric_label ? sanitizeAiText(sector.social_metric_label) : null
  return (
    <div className="xd-thesis-sec-card">
      <div className="xd-thesis-sec-top">
        <span className="xd-thesis-sec-name">{name}</span>
        {sector?.token_count != null && (
          <span className="xd-thesis-sec-count xd-num">
            {Number(sector.token_count)} {t('xDash.thesis.tokens', 'tokens')}
          </span>
        )}
      </div>
      {hasHeat && (
        <div className="xd-thesis-sec-heat" title={metricLabel || undefined}>
          <div className="xd-thesis-sec-heat-track">
            <div className="xd-thesis-sec-heat-fill" style={{ width: `${heatPct}%` }} />
          </div>
          <span className="xd-thesis-sec-heat-val xd-num">{Math.round(heat)}</span>
          {metricLabel && <span className="xd-thesis-sec-heat-label">{metricLabel}</span>}
        </div>
      )}
      {driving.length > 0 && (
        <div className="xd-thesis-sec-tokens">
          {driving.map((dt, i) => {
            const openable = !!canOpen?.(dt)
            const Tag = openable ? 'button' : 'span'
            return (
              <Tag
                key={dt?.symbol || `dt-${i}`}
                type={openable ? 'button' : undefined}
                className={`xd-thesis-sec-token${openable ? ' xd-thesis-clk' : ''}`}
                title={dt?.why ? sanitizeAiText(dt.why) : undefined}
                onClick={openable ? () => openAsset(dt) : undefined}
              >
                <span className="xd-num">{dt?.symbol ? `$${dt.symbol}` : '-'}</span>
              </Tag>
            )
          })}
        </div>
      )}
      {sector?.read && <p className="xd-thesis-sec-read">{sanitizeAiText(sector.read)}</p>}
    </div>
  )
}

// ── Convergence — social + money + news aligned cross-check ──
function ConvergenceRow({ row, t, canOpen, openAsset }) {
  const tone = convictionTone(row?.conviction)
  const capital = fmtUsd(row?.capital_usd)
  // sources_firing may be a count or array; derive a friendly count.
  const firing = Array.isArray(row?.sources_firing)
    ? row.sources_firing.length
    : Number.isFinite(Number(row?.sources_firing))
      ? Number(row.sources_firing)
      : null
  const signals = [
    row?.social ? { key: 'social', label: t('xDash.thesis.social', 'social') } : null,
    capital ? { key: 'capital', label: capital } : null,
    row?.news ? { key: 'news', label: t('xDash.thesis.news', 'news') } : null,
  ].filter(Boolean)
  const openable = !!canOpen?.(row)
  return (
    <div className={`xd-thesis-conv-row xd-thesis-conv-row--${tone}`}>
      <div className="xd-thesis-conv-head">
        {openable ? (
          <button type="button" className="xd-thesis-conv-asset xd-num xd-thesis-clk" onClick={() => openAsset(row)}>
            {row?.asset ? `$${row.asset}` : '-'}
          </button>
        ) : (
          <span className="xd-thesis-conv-asset xd-num">
            {row?.asset ? `$${row.asset}` : '-'}
          </span>
        )}
        {row?.conviction && (
          <span className={`xd-thesis-conv-badge xd-thesis-conv-badge--${tone}`}>
            {sanitizeAiText(String(row.conviction))}
          </span>
        )}
        {firing != null && firing > 0 && (
          <span className="xd-thesis-conv-firing xd-num">
            {firing} {t('xDash.thesis.firing', 'firing')}
          </span>
        )}
      </div>
      {signals.length > 0 && (
        <div className="xd-thesis-conv-signals">
          {signals.map((s, i) => (
            <span key={s.key} className="xd-thesis-conv-sig">
              <span className="xd-thesis-conv-sig-check" aria-hidden="true">✓</span>
              <span className={s.key === 'capital' ? 'xd-num' : undefined}>{s.label}</span>
              {i < signals.length - 1 && <span className="xd-thesis-conv-sig-sep" aria-hidden="true">·</span>}
            </span>
          ))}
        </div>
      )}
      {row?.verdict && <p className="xd-thesis-conv-verdict">{sanitizeAiText(row.verdict)}</p>}
    </div>
  )
}

// ── Big accounts — handle + followers + pushing + gist ──
function BigAccountRow({ acc, t, canOpen, openAsset }) {
  const followers = fmtFollowers(acc?.followers)
  const pushing = Array.isArray(acc?.pushing) ? acc.pushing.slice(0, 5) : []
  const handle = sanitizeAiText(String(acc?.handle || ''))
  const handleAt = handle && !handle.startsWith('@') ? `@${handle}` : handle
  return (
    <div className="xd-thesis-acct-row">
      <div className="xd-thesis-acct-head">
        <span className="xd-thesis-acct-handle">{handleAt}</span>
        {followers && (
          <span className="xd-thesis-acct-followers xd-num">
            {followers} {t('xDash.thesis.followers', 'followers')}
          </span>
        )}
      </div>
      {pushing.length > 0 && (
        <div className="xd-thesis-acct-pushing">
          {pushing.map((sym, i) => {
            const openable = !!canOpen?.(sym)
            const Tag = openable ? 'button' : 'span'
            return (
              <Tag
                key={sym || `push-${i}`}
                type={openable ? 'button' : undefined}
                className={`xd-thesis-acct-tag xd-num${openable ? ' xd-thesis-clk' : ''}`}
                onClick={openable ? () => openAsset(sym) : undefined}
              >
                {sym ? `$${sym}` : '-'}
              </Tag>
            )
          })}
        </div>
      )}
      {acc?.gist && <p className="xd-thesis-acct-gist">{sanitizeAiText(acc.gist)}</p>}
    </div>
  )
}

// ── Smart money — asset + action + amount + read ──
function SmartMoneyRow({ flow, canOpen, openAsset }) {
  const tone = actionTone(flow?.action)
  const amount = fmtUsd(flow?.amount_usd)
  const openable = !!canOpen?.(flow)
  return (
    <div className={`xd-thesis-flow-row xd-thesis-flow-row--${tone}`}>
      <div className="xd-thesis-flow-head">
        {openable ? (
          <button type="button" className="xd-thesis-flow-asset xd-num xd-thesis-clk" onClick={() => openAsset(flow)}>
            {flow?.asset ? `$${flow.asset}` : '-'}
          </button>
        ) : (
          <span className="xd-thesis-flow-asset xd-num">{flow?.asset ? `$${flow.asset}` : '-'}</span>
        )}
        {flow?.action && (
          <span className={`xd-thesis-flow-action xd-thesis-flow-action--${tone}`}>
            {sanitizeAiText(String(flow.action))}
          </span>
        )}
        {amount && <span className="xd-thesis-flow-amt xd-num">{amount}</span>}
      </div>
      {flow?.read && <p className="xd-thesis-flow-read">{sanitizeAiText(flow.read)}</p>}
    </div>
  )
}

// ── Dossier — per-asset compact signal list ──
function DossierCard({ note, canOpen, openAsset }) {
  const signals = Array.isArray(note?.signals) ? note.signals.slice(0, 4) : []
  if (!signals.length) return null
  const openable = !!canOpen?.(note)
  return (
    <div className="xd-thesis-dossier-card">
      {openable ? (
        <button type="button" className="xd-thesis-dossier-asset xd-num xd-thesis-clk" onClick={() => openAsset(note)}>
          {note?.asset ? `$${note.asset}` : '-'}
        </button>
      ) : (
        <span className="xd-thesis-dossier-asset xd-num">{note?.asset ? `$${note.asset}` : '-'}</span>
      )}
      <div className="xd-thesis-dossier-signals">
        {signals.map((sig, i) => (
          <div className="xd-thesis-dossier-sig" key={`dsig-${i}`}>
            <span className={`xd-thesis-dossier-dot xd-thesis-dossier-dot--${sentimentTone(sig?.sentiment)}`} />
            <span className="xd-thesis-dossier-claim">{sanitizeAiText(sig?.claim || '')}</span>
            {sig?.severity && (
              <span className="xd-thesis-dossier-sev">{sanitizeAiText(String(sig.severity))}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function XDThesis({ timeframe = '24h', onOpenToken, refinedDesign = false }) {
  const { t } = useTranslation()
  const { data, loading, error, stale } = useXDashThesis('combined')

  /* $SYMBOL click-through. The thesis payload names assets by bare symbol
     (sometimes with a cg_id); the drawer needs a cg_id. Resolve direct ids
     first, then bare symbols via the board seed registry (every board surface
     registers its rows there). Unresolvable chips stay inert — never a
     dead-end navigation. */
  const canOpen = useCallback((item) => {
    if (!onOpenToken || !item) return false
    if (typeof item === 'string') return !!findTokenSeedBySymbol(item)?.cg_id
    if (item.cg_id || item.token_id) return true
    return !!findTokenSeedBySymbol(item.symbol || item.asset)?.cg_id
  }, [onOpenToken])
  const openAsset = useCallback((item) => {
    if (!onOpenToken || !item) return
    let id = null
    if (typeof item === 'string') {
      id = findTokenSeedBySymbol(item)?.cg_id
    } else {
      id = item.cg_id || item.token_id || findTokenSeedBySymbol(item.symbol || item.asset)?.cg_id
    }
    if (id) onOpenToken(String(id), { source: 'thesis' })
  }, [onOpenToken])
  // Panel-level collapse (persisted) - fold the whole Social Market Read down to
  // its header so users can drop straight to the table. Separate from the
  // `expanded` deep-read toggle below.
  const panelOpen = useSettingsStore((s) => s.xdMarketReadOpen)
  const togglePanel = useSettingsStore((s) => s.toggleXdMarketRead)

  // The card view follows the page timeframe by default (7D -> general_7d,
  // 24H -> timeframed_24h), but the user can override via the local toggle.
  const pageView = timeframe === '7d' ? 'general' : 'tf'
  const [view, setView] = useState(pageView)
  // Keep following the page timeframe until the user manually toggles.
  const [pinned, setPinned] = useState(false)
  // The deep read collapses by default so the panel stays compact and the
  // heatmaps + leaderboard below remain visible. Toggle to expand.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!pinned) setView(pageView)
  }, [pageView, pinned])

  const block = useMemo(() => {
    if (!data) return null
    return view === 'general' ? data.general_7d : data.timeframed_24h
  }, [data, view])

  const regime = data?.regime || null
  const bias = regimeBias(regime?.label)
  const proof = data?.proof || null
  const updatedAt = data?.reference_now || data?.generated_at || null

  // Top-level (toggle-independent) sections.
  const sectors = Array.isArray(data?.sectors) ? data.sectors.slice(0, 8) : []
  const convergence = Array.isArray(data?.convergence) ? data.convergence.slice(0, 6) : []
  const bigAccounts = Array.isArray(data?.big_accounts) ? data.big_accounts.slice(0, 8) : []
  const smartMoney = Array.isArray(data?.smart_money) ? data.smart_money.slice(0, 8) : []
  const dossierNotes = Array.isArray(data?.dossier_notes) ? data.dossier_notes.slice(0, 6) : []

  // Loading shimmer (no data yet).
  if (loading && !data) {
    return (
      <div className="xd-thesis-wrap">
        <div className="xd-thesis xd-thesis--loading">
          <div className="xd-thesis-shimmer xd-thesis-shimmer--bar animate-shimmer" />
          <div className="xd-thesis-shimmer xd-thesis-shimmer--head animate-shimmer" />
          <div className="xd-thesis-shimmer xd-thesis-shimmer--line animate-shimmer" />
          <div className="xd-thesis-shimmer xd-thesis-shimmer--line animate-shimmer" />
        </div>
      </div>
    )
  }

  // Hard error with no cached data, or a totally empty payload — render nothing
  // rather than an empty husk.
  const hasAnyContent = block || regime || sectors.length || convergence.length
    || bigAccounts.length || smartMoney.length || dossierNotes.length
  if ((error && !data) || !hasAnyContent) return null

  const headline = block?.headline ? sanitizeAiText(block.headline) : null
  const narrativeHtml = block?.narrative ? boldenNumbers(block.narrative) : null
  const marketThesisHtml = data?.market_thesis ? boldenNumbers(data.market_thesis) : null
  const whatsWorking = Array.isArray(block?.whats_working) ? block.whats_working.slice(0, 6) : []
  const convictionPlays = Array.isArray(block?.conviction_plays) ? block.conviction_plays.slice(0, 8) : []
  const frothWarnings = Array.isArray(block?.froth_warnings) ? block.froth_warnings.slice(0, 8) : []
  const sectorRotation = Array.isArray(block?.sector_rotation) ? block.sector_rotation.slice(0, 6) : []

  // Everything below the headline/narrative is the "deep read" — collapsed by default
  // so the panel stays compact and the heatmaps + leaderboard below stay visible.
  const hasProof = !!(proof && (proof.pg_win_rate_pct != null || (Array.isArray(proof.top_fresh) && proof.top_fresh.length)))
  const hasDetail = !!(sectors.length || convergence.length || bigAccounts.length || smartMoney.length
    || convictionPlays.length || frothWarnings.length || whatsWorking.length || sectorRotation.length
    || dossierNotes.length || hasProof)
  const detailTeaser = [
    sectors.length ? `${sectors.length} ${sectors.length === 1 ? 'sector' : 'sectors'}` : null,
    convergence.length ? `${convergence.length} convergence` : null,
    smartMoney.length ? 'smart money' : null,
    convictionPlays.length ? `${convictionPlays.length} conviction` : null,
    frothWarnings.length ? `${frothWarnings.length} froth` : null,
  ].filter(Boolean).slice(0, 4).join('  ·  ')

  const mcapChange = regime?.total_mcap_change_24h
  const mcapNum = Number(mcapChange)
  const hasMcap = Number.isFinite(mcapNum)

  return (
    <div className="xd-thesis-wrap">
      <div className={`xd-thesis bias-${bias}${panelOpen ? '' : ' xd-thesis--collapsed'}`}>
        <div className="xd-thesis-glow" />

        {/* Header: pulse + title + view toggle | regime + freshness + badge */}
        <div className="xd-thesis-header">
          <div className="xd-thesis-header-left">
            <span className="xd-thesis-pulse" />
            <button
              type="button"
              className="xd-sec-toggle xd-sec-toggle--thesis"
              onClick={togglePanel}
              aria-expanded={panelOpen}
              title={panelOpen
                ? t('xDash.thesis.collapse', 'Hide Social Market Read')
                : t('xDash.thesis.expand', 'Show Social Market Read')}
            >
              <svg className="xd-sec-toggle__chev" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="xd-thesis-title">
                {t('xDash.thesis.title', 'Social Market Read')}
              </span>
            </button>
            {panelOpen && (
            <div className="xd-thesis-toggle" role="tablist" aria-label={t('xDash.thesis.scopeAria', 'Read scope')}>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'tf'}
                className={`xd-thesis-toggle-btn${view === 'tf' ? ' active' : ''}`}
                onClick={() => { setView('tf'); setPinned(true) }}
              >
                {t('xDash.thesis.now', '24H')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'general'}
                className={`xd-thesis-toggle-btn${view === 'general' ? ' active' : ''}`}
                onClick={() => { setView('general'); setPinned(true) }}
              >
                {t('xDash.thesis.general', '7D')}
              </button>
            </div>
            )}
          </div>

          <div className="xd-thesis-header-right">
            {regime?.label && (
              <span className={`xd-thesis-regime xd-thesis-regime--${bias}`}>{regime.label}<InfoTip text={getMetricInfo('regime')} position="bottom" /></span>
            )}
            {regime?.fear_greed != null && (
              <span className="xd-thesis-meta-stat xd-num" title={t('xDash.thesis.fearGreed', 'Fear & Greed')}>
                {t('xDash.thesis.fg', 'FG')} {Math.round(Number(regime.fear_greed))}<InfoTip text={getMetricInfo('fearGreed')} position="bottom" />
              </span>
            )}
            {regime?.btc_dominance != null && (
              <span className="xd-thesis-meta-stat xd-num" title={t('xDash.thesis.btcDom', 'BTC Dominance')}>
                {t('xDash.thesis.dom', 'DOM')} {Number(regime.btc_dominance).toFixed(1)}%<InfoTip text={getMetricInfo('btcDominance')} position="bottom" />
              </span>
            )}
            {hasMcap && (
              <span
                className={`xd-thesis-meta-stat xd-num xd-thesis-meta-stat--${mcapNum >= 0 ? 'pos' : 'neg'}`}
                title={t('xDash.thesis.mcapChange', 'Total market cap 24h')}
              >
                {t('xDash.thesis.mcap', 'MCAP')} {mcapNum >= 0 ? '+' : ''}{mcapNum.toFixed(1)}%<InfoTip text={getMetricInfo('marketCapChange')} position="bottom" />
              </span>
            )}
            <span
              className={`xd-thesis-fresh${stale ? ' is-stale' : ''}`}
              title={updatedAt ? new Date(updatedAt).toLocaleString() : undefined}
            >
              {stale
                ? t('xDash.thesis.stale', 'stale')
                : updatedAt
                  ? t('xDash.updated', 'updated {{when}}', { when: relativeTime(updatedAt, t) })
                  : t('xDash.updatingLabel', 'updating...')}
            </span>
            <span className="xd-thesis-badge">Spectre AI</span>
          </div>
        </div>

        {refinedDesign ? (
          <XDRefinedBrief headline={headline} html={marketThesisHtml || narrativeHtml || boldenNumbers(regime?.summary)} sectors={sectors} />
        ) : (<>
        {/* Headline + the general market read (hero paragraph, always visible) */}
        {headline && <h3 className="xd-thesis-headline">{headline}</h3>}
        {marketThesisHtml && (
          <p className="xd-thesis-market" dangerouslySetInnerHTML={{ __html: marketThesisHtml }} />
        )}
        {!marketThesisHtml && narrativeHtml && (
          <p className="xd-thesis-market" dangerouslySetInnerHTML={{ __html: narrativeHtml }} />
        )}
        {!marketThesisHtml && !narrativeHtml && regime?.summary && (
          <p className="xd-thesis-market" dangerouslySetInnerHTML={{ __html: boldenNumbers(regime.summary) }} />
        )}

        </>)}

        {/* Open / close the deep read — keeps the panel compact by default so the
            heatmaps + leaderboard below stay visible without scrolling. */}
        {hasDetail && (
          <button
            type="button"
            className={`xd-thesis-expand${expanded ? ' is-open' : ''}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <span className="xd-thesis-expand-label">
              {expanded ? t('xDash.thesis.closeRead', 'Close') : t('xDash.thesis.openRead', 'Open full read')}
            </span>
            {!expanded && detailTeaser && (
              <span className="xd-thesis-expand-teaser">{detailTeaser}</span>
            )}
            <span className="xd-thesis-expand-chevron" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
          </button>
        )}

        {expanded && (
        <div className="xd-thesis-detail">

        {/* Per-window narrative (24h vs 7d specifics) — full width */}
        {narrativeHtml && (
          <p className="xd-thesis-narrative xd-thesis-section--wide" dangerouslySetInnerHTML={{ __html: narrativeHtml }} />
        )}

        {/* SECTORS — centerpiece: which sectors, which tokens, why */}
        {sectors.length > 0 && (
          <div className="xd-thesis-section xd-thesis-section--wide">
            <div className="xd-thesis-section-title">
              {t('xDash.thesis.sectors', 'Sectors in Play')}
            </div>
            <div className="xd-thesis-sec-grid">
              {sectors.map((s, i) => (
                <SectorCard key={s?.sector || `sec-${i}`} sector={s} t={t} canOpen={canOpen} openAsset={openAsset} />
              ))}
            </div>
          </div>
        )}

        {/* CONVERGENCE — social + money + news aligned */}
        {convergence.length > 0 && (
          <div className="xd-thesis-section">
            <div className="xd-thesis-section-title">
              {t('xDash.thesis.convergence', 'Social × Capital Convergence')}
            </div>
            <div className="xd-thesis-conv-grid">
              {convergence.map((c, i) => (
                <ConvergenceRow key={c?.asset || `conv-${i}`} row={c} t={t} canOpen={canOpen} openAsset={openAsset} />
              ))}
            </div>
          </div>
        )}

        {/* BIG ACCOUNTS + SMART MONEY, side by side where it fits */}
        {(bigAccounts.length > 0 || smartMoney.length > 0) && (
          <>
            {bigAccounts.length > 0 && (
              <div className="xd-thesis-section">
                <div className="xd-thesis-section-title">
                  {t('xDash.thesis.bigAccounts', 'Big Accounts')}
                </div>
                <div className="xd-thesis-acct-list">
                  {bigAccounts.map((a, i) => (
                    <BigAccountRow key={a?.handle || `acct-${i}`} acc={a} t={t} canOpen={canOpen} openAsset={openAsset} />
                  ))}
                </div>
              </div>
            )}

            {smartMoney.length > 0 && (
              <div className="xd-thesis-section">
                <div className="xd-thesis-section-title">
                  {t('xDash.thesis.smartMoney', 'Smart Money')}
                </div>
                <div className="xd-thesis-flow-list">
                  {smartMoney.map((f, i) => (
                    <SmartMoneyRow key={f?.asset ? `${f.asset}-${i}` : `flow-${i}`} flow={f} canOpen={canOpen} openAsset={openAsset} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Conviction plays (bull-green) */}
        {convictionPlays.length > 0 && (
          <div className="xd-thesis-section">
            <div className="xd-thesis-section-title xd-thesis-section-title--bull">
              {t('xDash.thesis.conviction', 'Conviction Plays')}
            </div>
            <div className="xd-thesis-chips">
              {convictionPlays.map((p, i) => (
                <Chip
                  key={p?.cg_id || p?.symbol || `conv-${i}`}
                  tone="bull"
                  symbol={p?.symbol ? `$${p.symbol}` : null}
                  label={p?.symbol}
                  why={p?.why}
                  score={p?.quality_score}
                  onOpen={canOpen(p) ? () => openAsset(p) : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {/* Froth warnings (amber/red) */}
        {frothWarnings.length > 0 && (
          <div className="xd-thesis-section">
            <div className="xd-thesis-section-title xd-thesis-section-title--bear">
              {t('xDash.thesis.froth', 'Froth Warnings')}
            </div>
            <div className="xd-thesis-chips">
              {frothWarnings.map((p, i) => (
                <Chip
                  key={p?.cg_id || p?.symbol || `froth-${i}`}
                  tone="froth"
                  symbol={p?.symbol ? `$${p.symbol}` : null}
                  label={p?.symbol}
                  why={p?.why}
                  score={p?.hype_score}
                  onOpen={canOpen(p) ? () => openAsset(p) : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {/* What's working + Sector rotation, side by side on wide screens */}
        {(whatsWorking.length > 0 || sectorRotation.length > 0) && (
          <>
            {whatsWorking.length > 0 && (
              <div className="xd-thesis-section">
                <div className="xd-thesis-section-title">
                  {t('xDash.thesis.whatsWorking', "What's Working")}
                </div>
                <div className="xd-thesis-work">
                  {whatsWorking.map((w, i) => (
                    <div className="xd-thesis-work-row" key={`work-${i}`}>
                      <span className="xd-thesis-work-name">
                        {sanitizeAiText(w?.sector_or_narrative || '')}
                      </span>
                      {w?.why && <span className="xd-thesis-work-why">{sanitizeAiText(w.why)}</span>}
                      {w?.evidence && (
                        <span className="xd-thesis-work-ev xd-num">{sanitizeAiText(w.evidence)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sectorRotation.length > 0 && (
              <div className="xd-thesis-section">
                <div className="xd-thesis-section-title">
                  {t('xDash.thesis.rotation', 'Sector Rotation')}
                </div>
                <div className="xd-thesis-rot">
                  {sectorRotation.map((r, i) => (
                    <RotationRow row={r} key={`rot-${i}`} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* DOSSIER — compact per-asset signal notes */}
        {dossierNotes.length > 0 && (
          <div className="xd-thesis-section">
            <div className="xd-thesis-section-title">
              {t('xDash.thesis.dossier', 'Dossier Signals')}
            </div>
            <div className="xd-thesis-dossier-grid">
              {dossierNotes.map((n, i) => (
                <DossierCard key={n?.asset || `dossier-${i}`} note={n} canOpen={canOpen} openAsset={openAsset} />
              ))}
            </div>
          </div>
        )}

        {/* Proof strip */}
        {proof && (proof.pg_win_rate_pct != null || (Array.isArray(proof.top_fresh) && proof.top_fresh.length > 0)) && (
          <div className="xd-thesis-proof">
            {proof.pg_win_rate_pct != null && (
              <span className="xd-thesis-proof-stat">
                <span className="xd-thesis-proof-dot" />
                {t('xDash.thesis.pgWinRate', 'PG top-10:')}{' '}
                <b className="xd-num">{Math.round(Number(proof.pg_win_rate_pct))}%</b>{' '}
                {t('xDash.thesis.winRate', 'win-rate')}
                {proof.pg_sample != null && (
                  <span className="xd-thesis-proof-sample xd-num"> · n={proof.pg_sample}</span>
                )}
              </span>
            )}
            {Array.isArray(proof.top_fresh) && proof.top_fresh.length > 0 && (
              <span className="xd-thesis-proof-fresh">
                <span className="xd-thesis-proof-fresh-label">{t('xDash.thesis.fresh', 'Fresh')}</span>
                {proof.top_fresh.slice(0, 5).map((f, i) => (
                  <span className="xd-thesis-proof-tag" key={f?.symbol || `fresh-${i}`}>
                    <span className="xd-num">{f?.symbol ? `$${f.symbol}` : '-'}</span>
                    {f?.phase && <span className="xd-thesis-proof-phase">{sanitizeAiText(f.phase)}</span>}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        </div>
        )}
      </div>
    </div>
  )
}

// Rendered directly in the page body (not inside the useMemo'd viewBody), so
// without memo it re-rendered on every search keystroke / filter change despite
// its only prop being `timeframe`.
export default memo(XDThesis)
