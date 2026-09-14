import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import DossierPanel from '@/components/dossier-panel'
import { dossier } from '@/services/dossierApi'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { timeAgo as fmtTimeAgo } from '@/lib/timeAgo'
import './dossier-page.css'

const EVM_CA_RE = /^0x[a-fA-F0-9]{40}$/
const SOL_CA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function detectChainFromCa(raw) {
  const s = String(raw || '').trim()
  if (EVM_CA_RE.test(s)) return { chain: 'eth', ca: s.toLowerCase() }
  if (SOL_CA_RE.test(s) && !s.startsWith('0x')) return { chain: 'sol', ca: s }
  return null
}

// Locale-aware compact number formatter. Uses the user's i18n language so
// 1.5K / 1.5М / 1.5万 render correctly with the right thousand separators.
function makeFmtCompact(locale) {
  let nf = null
  try {
    nf = new Intl.NumberFormat(locale || 'en', {
      notation: 'compact',
      maximumFractionDigits: 1,
    })
  } catch {
    nf = null
  }
  return (n) => {
    if (n == null) return '—'
    const v = Number(n)
    if (!Number.isFinite(v)) return '—'
    if (nf) return nf.format(v)
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B'
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M'
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K'
    return v.toFixed(0)
  }
}

const KIND_CATEGORIES = {
  breakouts: ['price_breakout', 'trending_gainer'],
  volume: ['volume_spike'],
  rugs: ['liquidity_drain', 'price_breakdown', 'safety_flip', 'safety_honeypot'],
  smart: ['smart_money', 'flow_accumulation', 'flow_distribution'],
}
// Translation-key map for category cards. Default English strings live with the
// t() call so en.json acts as the source of truth.
const CATEGORY_META = {
  breakouts: {
    titleKey: 'dossier.category.breakouts.title',
    titleDefault: 'Breaking out',
    subtitleKey: 'dossier.category.breakouts.subtitle',
    subtitleDefault: 'Price rips + volume that looks real',
    accent: 'bull',
  },
  volume: {
    titleKey: 'dossier.category.volume.title',
    titleDefault: 'Volume surge',
    subtitleKey: 'dossier.category.volume.subtitle',
    subtitleDefault: 'Unusual turnover vs 1h ago',
    accent: 'cyan',
  },
  rugs: {
    titleKey: 'dossier.category.rugs.title',
    titleDefault: 'Rug & scam alerts',
    subtitleKey: 'dossier.category.rugs.subtitle',
    subtitleDefault: 'Liquidity drains, honeypots, safety flips',
    accent: 'bear',
  },
  smart: {
    titleKey: 'dossier.category.smart.title',
    titleDefault: 'Smart money moving',
    subtitleKey: 'dossier.category.smart.subtitle',
    subtitleDefault: 'Tagged funds & MMs accumulating or distributing',
    accent: 'amber',
  },
}

function TokenAvatar({ logo, symbol }) {
  const [failed, setFailed] = useState(false)
  const letter = (symbol || '?').slice(0, 1).toUpperCase()
  if (logo && !failed) {
    return <img className="sig-avatar" src={logo} alt="" onError={() => setFailed(true)} />
  }
  return <div className="sig-avatar sig-avatar-fallback" aria-hidden>{letter}</div>
}

function SignalCard({ sig, onOpen }) {
  const { t, i18n } = useTranslation()
  const { fmtPriceShort } = useCurrency()
  const sym = sig.token?.symbol || (sig.ca || '').slice(0, 6)
  const rawPrice = sig.market?.priceUsd
  const rawMcap = sig.market?.mcap
  const price = (rawPrice != null && Number.isFinite(Number(rawPrice))) ? fmtPriceShort(rawPrice) : null
  const mcap = (rawMcap != null && Number.isFinite(Number(rawMcap))) ? fmtPriceShort(rawMcap) : null
  const change = sig.market?.change24h
  const up = (change ?? 0) >= 0
  // Use Intl.NumberFormat for the %-change so locales with comma decimals render
  // correctly ("1,3%" in fr/ru, "1.3%" in en).
  let changeStr = ''
  if (change != null && Number.isFinite(change)) {
    try {
      const nf = new Intl.NumberFormat(i18n.language || 'en', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
        signDisplay: 'exceptZero',
      })
      changeStr = `${nf.format(change)}%`
    } catch {
      changeStr = `${up ? '+' : ''}${change.toFixed(1)}%`
    }
  }
  return (
    <button className="signal-card" onClick={() => onOpen(sig.chain, sig.ca)}>
      <div className="sig-header">
        <TokenAvatar logo={sig.token?.logo} symbol={sym} />
        <div className="sig-identity">
          <div className="sig-sym">{sym} <span className="sig-chain">{sig.chain}</span></div>
          <div className="sig-meta mono">
            {price && <span>{price}</span>}
            {mcap && <><span className="dot">·</span><span>{t('dossier.signal.mcShort', 'mc')} {mcap}</span></>}
            {changeStr && <><span className="dot">·</span><span className={up ? 'bull' : 'bear'}>{changeStr}</span></>}
          </div>
        </div>
        <div className="sig-score-wrap">
          <div className={`sig-score score-${sig.score >= 80 ? 'hi' : sig.score >= 60 ? 'mid' : 'low'}`}>{Math.round(sig.score || 0)}</div>
          <div className="sig-ago mono">{fmtTimeAgo(sig.detectedAt, t)}</div>
        </div>
      </div>
      <div className="sig-narrative">{sig.narrative}</div>
    </button>
  )
}

function CategoryColumn({ categoryKey, signals, onOpen }) {
  const { t } = useTranslation()
  const meta = CATEGORY_META[categoryKey]
  const kinds = KIND_CATEGORIES[categoryKey]
  const list = signals.filter((s) => kinds.includes(s.kind)).slice(0, 6)
  return (
    <div className={`category-col accent-${meta.accent}`}>
      <div className="category-head">
        <div className="category-title">{t(meta.titleKey, meta.titleDefault)}</div>
        <div className="category-subtitle">{t(meta.subtitleKey, meta.subtitleDefault)}</div>
      </div>
      {list.length === 0 ? (
        <div className="category-empty">{t('dossier.category.empty', 'nothing firing right now')}</div>
      ) : (
        <div className="category-list">
          {list.map((s) => <SignalCard key={s.id} sig={s} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  )
}

function PinnedRail({ watchlist, navigate }) {
  const { t } = useTranslation()
  if (!watchlist.list.length) return null
  return (
    <section className="pinned-rail">
      <h3 className="landing-heading">{t('dossier.watchlist.title', 'Watchlist')}</h3>
      <div className="pinned-grid">
        {watchlist.list.slice(0, 12).map((p) => (
          <button key={`${p.chain}-${p.ca}`} className="pinned-card" onClick={() => navigate(`/dossier/${p.chain}/${p.ca}`)}>
            {p.logo ? <img className="pinned-avatar" src={p.logo} alt="" onError={(e) => e.target.style.display = 'none'} /> : <div className="pinned-avatar pinned-avatar-fallback">{(p.symbol || '?').slice(0, 1).toUpperCase()}</div>}
            <div className="pinned-meta">
              <div className="pinned-sym">{p.symbol || (p.ca || '').slice(0, 6)}</div>
              <div className="pinned-chain mono">{p.chain}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

function DossierLanding({ navigate, watchlist }) {
  const { t, i18n } = useTranslation()
  const fmtCompact = useMemo(() => makeFmtCompact(i18n.language), [i18n.language])
  const fmtConfidence = useMemo(() => {
    try {
      return new Intl.NumberFormat(i18n.language || 'en', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    } catch {
      return null
    }
  }, [i18n.language])
  const [signals, setSignals] = useState([])
  const [takes, setTakes] = useState([])
  const [topTokens, setTopTokens] = useState([])
  const [health, setHealth] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [s, tk, h] = await Promise.allSettled([
          // 4 category columns render <=6 each (<=24 total). 40 covers the
          // worst category skew without shipping 100 rows the UI never reads.
          dossier.signals({ limit: 40 }),
          dossier.brainAnnotations({ limit: 10 }),
          dossier.health(),
        ])
        if (cancelled) return
        if (s.status === 'fulfilled') setSignals(s.value.signals || [])
        if (tk.status === 'fulfilled') setTakes(tk.value.annotations || [])
        if (h.status === 'fulfilled') setHealth(h.value)
      } catch (_) {}
    }
    load()
    const iv = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      load()
    }, 20000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const openToken = (chain, ca) => navigate(`/dossier/${chain}/${ca}`)

  return (
    <div className="dossier-landing">
      <div className="landing-hero">
        <div>
          <div className="hero-eyebrow">{t('dossier.hero.eyebrow', '24/7 market intelligence')}</div>
          <h2 className="hero-title">{t('dossier.hero.title', 'The Mind is cooking.')}</h2>
          <p className="hero-sub">
            {t(
              'dossier.hero.sub',
              "Every signal below is live — breakouts, volume surges, smart-money rotation, rug warnings — all powered by the Spectre Data API and the Spectre Brain. Click any card to dive into the full dossier."
            )}
          </p>
        </div>
        <div className="landing-stats">
          <div className="landing-stat">
            <span className="label">{t('dossier.stats.tokens', 'Tokens cooked')}</span>
            <span className="value mono">{fmtCompact(health?.counts?.tokens)}</span>
          </div>
          <div className="landing-stat">
            <span className="label">{t('dossier.stats.safety', 'Safety checks')}</span>
            <span className="value mono">{fmtCompact(health?.counts?.safety)}</span>
          </div>
          <div className="landing-stat">
            <span className="label">{t('dossier.stats.signals24h', 'Signals (24h)')}</span>
            <span className="value mono">{fmtCompact(signals.length)}</span>
          </div>
          <div className="landing-stat">
            <span className="label">{t('dossier.stats.brainEvents', 'Brain events')}</span>
            <span className="value mono">{fmtCompact(health?.counts?.events)}</span>
          </div>
        </div>
      </div>

      <PinnedRail watchlist={watchlist} navigate={navigate} />

      <div className="category-grid">
        <CategoryColumn categoryKey="breakouts" signals={signals} onOpen={openToken} />
        <CategoryColumn categoryKey="volume" signals={signals} onOpen={openToken} />
        <CategoryColumn categoryKey="smart" signals={signals} onOpen={openToken} />
        <CategoryColumn categoryKey="rugs" signals={signals} onOpen={openToken} />
      </div>

      <section className="landing-takes-section">
        <div className="landing-takes-head">
          <h3>{t('dossier.takes.title', 'Spectre Brain — recent takes')}</h3>
          <div className="hero-sub">
            {t('dossier.takes.sub', "What the mind just noticed across every token we're watching.")}
          </div>
        </div>
        {takes.length === 0 && (
          <div className="category-empty">
            {t('dossier.takes.empty', 'No takes yet — the mind is still listening.')}
          </div>
        )}
        <div className="landing-takes">
          {takes.map((a, i) => {
            const conf = Number(a.confidence || 0)
            const confStr = fmtConfidence ? fmtConfidence.format(conf) : conf.toFixed(2)
            return (
              <button key={i} className={`landing-take ${a.kind}`} onClick={() => a.ca && openToken(a.chain, a.ca)}>
                <div className="body">{a.body}</div>
                <div className="meta mono">
                  {a.kind} · {a.chain}/{(a.ca || '').slice(0, 10)} · {t('dossier.takes.confShort', 'conf')} {confStr} · {fmtTimeAgo(a.createdAt, t)}
                </div>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function useWatchlist() {
  const [list, setList] = useState(() => {
    try { return JSON.parse(localStorage.getItem('spectre-dossier-watchlist') || '[]') } catch { return [] }
  })
  const persist = (next) => {
    setList(next)
    try { localStorage.setItem('spectre-dossier-watchlist', JSON.stringify(next)) } catch {}
  }
  const has = (chain, ca) => list.some((x) => x.chain === chain && x.ca?.toLowerCase() === ca?.toLowerCase())
  const toggle = (entry) => {
    if (has(entry.chain, entry.ca)) persist(list.filter((x) => !(x.chain === entry.chain && x.ca?.toLowerCase() === entry.ca?.toLowerCase())))
    else persist([{ ...entry, addedAt: Date.now() }, ...list].slice(0, 50))
  }
  return { list, has, toggle }
}

export default function DossierPage({ chain, ca }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [chainHint, setChainHint] = useState('eth')
  const debounceRef = useRef(null)
  const inputRef = useRef(null)
  const watchlist = useWatchlist()

  // Keyboard "/" focuses the search bar (when not already in an input).
  useEffect(() => {
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onChangeQuery = useCallback((val) => {
    setQuery(val)
    const guess = detectChainFromCa(val)
    if (guess) navigate(`/dossier/${guess.chain}/${guess.ca}`)
  }, [navigate])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) { setResults([]); return }
    if (detectChainFromCa(q)) return
    debounceRef.current = setTimeout(async () => {
      try {
        const d = await dossier.search(q)
        setResults(d.results || [])
      } catch (_) {}
    }, 220)
    return () => debounceRef.current && clearTimeout(debounceRef.current)
  }, [query])

  const handleSubmit = useCallback((e) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    const guess = detectChainFromCa(q)
    if (guess) { navigate(`/dossier/${guess.chain}/${guess.ca}`); return }
    if (results[0]) navigate(`/dossier/${results[0].chain}/${results[0].ca}`)
  }, [query, results, navigate])

  const activeKey = useMemo(() => `${chain || ''}-${ca || ''}`, [chain, ca])

  return (
    <div className="dossier-page">
      <div className="dossier-page-header">
        {chain && ca && (
          <button type="button" className="dossier-back" onClick={() => navigate('/dossier')}>
            <span aria-hidden>←</span> {t('dossier.back', 'Back to Dossier')}
          </button>
        )}
        <div className="dossier-page-title">
          <h1>{t('dossier.title', 'Spectre Dossier')}</h1>
          <p className="subtitle">{t('dossier.subtitle', '24/7 token intel — one source of truth.')}</p>
        </div>

        <form className="dossier-searchbar" onSubmit={handleSubmit}>
          <select
            className="dossier-chain-select"
            value={chainHint}
            onChange={(e) => setChainHint(e.target.value)}
            aria-label={t('dossier.search.chainAria', 'Chain')}
          >
            <option value="eth">ETH</option>
            <option value="base">Base</option>
            <option value="sol">SOL</option>
            <option value="bsc">BSC</option>
            <option value="arb">ARB</option>
            <option value="poly">POLY</option>
          </select>
          <input
            ref={inputRef}
            className="dossier-search-input"
            placeholder={t('dossier.search.placeholder', 'Paste a contract address or search by symbol / name…')}
            value={query}
            onChange={(e) => onChangeQuery(e.target.value)}
            autoFocus
          />
          <span className="dossier-search-shortcut mono">/</span>
          <button type="submit" className="dossier-search-btn">{t('dossier.search.go', 'Go')}</button>
        </form>

        {query.trim() && !detectChainFromCa(query) && results.length > 0 && (
          <div className="dossier-search-dropdown">
            {results.slice(0, 8).map((r) => (
              <button key={`${r.chain}-${r.ca}`} className="dossier-search-row" onClick={() => { setQuery(''); navigate(`/dossier/${r.chain}/${r.ca}`) }}>
                {r.logo && <img src={r.logo} alt="" />}
                <div className="info">
                  <div className="sym">{r.symbol || r.name} <span className="chain">{r.chain}</span></div>
                  <div className="ca mono">{r.ca}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {chain && ca ? (
        <DossierPanel key={activeKey} chain={chain} ca={ca} watchlist={watchlist} />
      ) : (
        <DossierLanding navigate={navigate} watchlist={watchlist} />
      )}
    </div>
  )
}
