/**
 * Spectre LITE — Cinema mode. An immersive, one-token-at-a-time flip-through
 * over the Trending / Watchlist / Movers lists.
 *  - CRYPTO: renders the FULL Screener-LITE token detail (real chart with
 *    timeframes + candle/line/area, stats, buys/sells, live tweets) as a
 *    carousel — the same experience as /screener-lite cinema.
 *  - STOCKS: a clean immersive card carousel (stocks have no on-chain detail).
 * ← → keyboard, swipe, filmstrip, Esc. Reflects the active Lite look.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import lazy from '@/lib/lazy-with-retry'
import { getStockLogoUrl } from '@/services/stockApi'
import './lite-cinema.css'
import '@/pages/screener-lite/components/screener-lite.css'
import '@/pages/screener-lite/components/screener-lite.mobile.css'
import useBackDismiss from '@/hooks/use-back-dismiss'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useSheetDrag } from './lite-edit-sheet'
import useDockMagnify from '@/pages/screener-lite/components/use-dock-magnify'

// The real Screener-LITE detail (chart engine + hooks) — lazy so it only loads
// when cinema actually opens, keeping the Lite boot chunk lean.
const TokenDetail = lazy(() => import('@/pages/screener-lite/components/sl-token'))

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const fmtChange = (v) => { const n = num(v); return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }
const changeCls = (v) => { const n = num(v); return n > 0.01 ? 'up' : n < -0.01 ? 'down' : 'flat' }

// Trigger button dropped into the Trending / Watchlist / Movers view headers.
export function CinemaButton({ onClick, label = 'Cinema' }) {
  const { t } = useTranslation()
  return (
    <button type="button" className="lite-cinema-btn" onClick={onClick} title={t('lite.cinemabutton.title', "Cinema mode")}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M7 5v14M17 5v14M2.5 9.5h4.5M17 9.5h4.5M2.5 14.5h4.5M17 14.5h4.5" /></svg>
      {label}
    </button>
  )
}

// Chain name -> Codex numeric network id. Mirrors the map in lite-research.jsx;
// kept local so cinema has no import cycle back into the Research view.
const CHAIN_NETWORK_ID = {
  ethereum: 1, eth: 1, mainnet: 1,
  bsc: 56, binance: 56, 'binance-smart-chain': 56, bnb: 56,
  polygon: 137, matic: 137,
  base: 8453,
  arbitrum: 42161, 'arbitrum-one': 42161,
  optimism: 10,
  avalanche: 43114, avax: 43114,
  solana: 1399811149, sol: 1399811149,
}

/* A row's `id` is only sometimes a CoinGecko slug — trending rows key themselves
   by CONTRACT. Handing that to the bars router as a cgId classifies an on-chain
   token as CG-listed, which spends a CoinGecko OHLC lookup on an id CoinGecko
   has never heard of. Same refusal-to-guess rule as networkId below. */
const looksLikeContract = (v) => {
  const s = String(v || '')
  return /^0x[a-fA-F0-9]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)
}

// Map a Lite list row → the token shape the Screener-LITE detail expects.
function toDetailToken(row, market) {
  const sym = String(row.symbol || row.ticker || '').toUpperCase()
  // A row may carry its own asset class (e.g. opened from the Research view);
  // fall back to the cinema's market otherwise.
  const isStock = row.isStock != null ? !!row.isStock : market === 'stocks'
  return {
    symbol: sym,
    name: row.name || row.companyName || sym,
    logo: row.image || row.logo || (isStock ? getStockLogoUrl(sym) : null),
    cgId: row.cgId || row.cg_id || (looksLikeContract(row.id) ? null : row.id) || null,
    address: row.address || row.contract || null,
    chain: row.chain || row.chainId || row.network || null,
    // Codex wants the NUMERIC network id. Callers store whichever half they
    // happened to have, so derive the missing one here rather than letting the
    // chart default a Solana/BSC contract to Ethereum (id 1) and come back
    // empty. Undefined - never a wrong guess - when the chain is unknown.
    networkId: Number(row.networkId)
      || CHAIN_NETWORK_ID[String(row.chain || row.chainId || row.network || '').toLowerCase()]
      || undefined,
    isStock,
    price: row.price ?? row.priceUsd ?? null,
    change24h: num(row.change ?? row.change24h ?? row.changePercent),
    change7d: row.change7d != null ? num(row.change7d) : undefined,
    marketCap: num(row.marketCap ?? row.mcap),
    volume24h: num(row.volume ?? row.volume24h ?? row.totalVolume),
  }
}

// Compact backdrop presets for the in-cinema appearance panel (ids match the
// shell's BG constants so setBg/setPaperBg resolve correctly).
const CINEMA_BG_GLASS = [
  { label: 'Rotate', mode: 'mix', fill: 'linear-gradient(135deg,#3b6ea5,#6b4f8a 55%,#1c2a3a)' },
  { label: 'Void', mode: 'solid', scene: 's-void', fill: '#0a0a0e' },
  { label: 'Slate', mode: 'solid', scene: 's-slate', fill: '#1b2430' },
  { label: 'Navy', mode: 'solid', scene: 's-navy', fill: '#0e1a2b' },
  { label: 'Ocean', mode: 'scene', scene: 'ocean', fill: 'linear-gradient(135deg,#1a4d6b,#0a2a3d)' },
  { label: 'Night', mode: 'scene', scene: 'night', fill: 'linear-gradient(135deg,#1a2340,#0a0e1c)' },
]
const CINEMA_BG_PAPER = [
  { id: 'pearl', label: 'Pearl', fill: 'linear-gradient(135deg,#fbfaff,#f3f6f8)' },
  { id: 'sky', label: 'Sky', fill: 'linear-gradient(135deg,#f4f8fd,#e6f0fb)' },
  { id: 'meadow', label: 'Meadow', fill: 'linear-gradient(135deg,#f3faf5,#eff7f2)' },
  { id: 'sand', label: 'Sand', fill: 'linear-gradient(135deg,#fbf8f1,#f8f4ea)' },
]

// In-cinema appearance popover — theme, glass intensity, backdrop. Drives the
// SAME shell state as the Themes page, so changes persist app-wide.
// On phones both popovers become bottom sheets (grab handle, Done, drag-down
// to dismiss) - the fixed card under the gear covered the token hero and its
// swatches sat above the thumb. Same shell state either way.
function SheetHead({ title, headProps, onBack }) {
  const { t } = useTranslation()
  return (
    <div className="lcin-sheet-head" {...headProps}>
      <span className="lcin-sheet-grab" aria-hidden />
      <div className="lcin-sheet-headrow">
        {onBack && (
          <button type="button" className="lcin-more-back" onClick={onBack} aria-label={t('lite.sheethead.ariaBack', "Back")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
        )}
        <strong className="lcin-sheet-heading">{title}</strong>
      </div>
    </div>
  )
}

function SheetFoot({ onDone }) {
  const { t } = useTranslation()
  return (
    <div className="lcin-sheet-foot">
      <button type="button" className="lcin-sheet-done" onClick={onDone}>{t('lite.sheetfoot.done', "Done")}</button>
    </div>
  )
}

// Segmented control. The active index rides on a CSS var so the phone sheet
// can slide one thumb between equal-width segments instead of re-tinting the
// pressed button; desktop keeps its compact tinted-button look.
function Seg({ options, value, onChange, label }) {
  const i = Math.max(0, options.findIndex((o) => o.id === value))
  return (
    <div className="lcin-seg" role="radiogroup" aria-label={label} style={{ '--seg-n': options.length, '--seg-i': i }}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} className={`lcin-seg-b${o.id === value ? ' on' : ''}`} onClick={() => onChange?.(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const THEME_OPTS = [{ id: 'glass', label: 'Glass' }, { id: 'paper', label: 'Paper' }]
const GLASS_OPTS = [{ id: 'airy', label: 'Airy' }, { id: 'balanced', label: 'Balanced' }, { id: 'solid', label: 'Solid' }]

function CinemaSettings({ controls, onClose }) {
  const { t } = useTranslation()
  const { look, setLook, glassLevel, setGlassLevel, bg, setBg, paperBg, setPaperBg, bgCatalog, paperCatalog } = controls || {}
  const activeScene = !bg || bg.mode === 'mix' ? 'mix' : bg.scene
  const [moreOpen, setMoreOpen] = useState(false)
  const hasMore = (look === 'glass' ? bgCatalog : paperCatalog)?.length > 0
  const isMobile = useIsMobile()
  const sheet = useSheetDrag(onClose)
  const closing = isMobile && sheet.closing
  const dismiss = isMobile ? sheet.close : onClose
  if (moreOpen) return <CinemaBackdrops controls={controls} onClose={() => setMoreOpen(false)} onDone={onClose} />
  return (
    <>
      <div className={`lcin-set-scrim${isMobile ? ' lcin-set-scrim--sheet' : ''}${closing ? ' closing' : ''}`} onClick={dismiss} aria-hidden />
      <div ref={sheet.sheetRef} className={`lcin-set${isMobile ? ' lcin-sheet' : ''}${closing ? ' closing' : ''}`} role="dialog" aria-label={t('lite.cinemasettings.ariaCinemaAppearance', "Cinema appearance")}>
        {isMobile && <SheetHead title={t('lite.cinemasettings.title', "Appearance")} headProps={sheet.headProps} />}
        <div className="lcin-sheet-body">
        <div className="lcin-set-row">
          <span className="lcin-set-lbl">{t('lite.cinemasettings.theme', "Theme")}</span>
          <Seg label={t('lite.cinemasettings.label', "Theme")} options={THEME_OPTS} value={look} onChange={(v) => setLook?.(v)} />
        </div>
        {look === 'glass' && setGlassLevel && (
          <div className="lcin-set-row">
            <span className="lcin-set-lbl">{t("lite.lookGlass", "Glass")}</span>
            <Seg label={t('lite.cinemasettings.label2', "Glass level")} options={GLASS_OPTS} value={glassLevel} onChange={(v) => setGlassLevel?.(v)} />
          </div>
        )}
        <div className="lcin-set-row lcin-set-row--col">
          <span className="lcin-set-lbl">{t('lite.cinemasettings.backdrop', "Backdrop")}</span>
          <div className="lcin-set-swatches">
            {look === 'glass'
              ? CINEMA_BG_GLASS.map((p) => (
                <button key={p.label} type="button" className={`lcin-sw${(p.mode === 'mix' ? activeScene === 'mix' : activeScene === p.scene) ? ' on' : ''}`} title={p.label} onClick={() => setBg?.(p.mode === 'mix' ? { mode: 'mix' } : { mode: p.mode, scene: p.scene })}>
                  <span className="lcin-sw-fill" style={{ background: p.fill }} />
                  <span className="lcin-sw-lbl">{p.label}</span>
                </button>
              ))
              : CINEMA_BG_PAPER.map((p) => (
                <button key={p.id} type="button" className={`lcin-sw${(paperBg || 'pearl') === p.id ? ' on' : ''}`} title={p.label} onClick={() => setPaperBg?.(p.id)}>
                  <span className="lcin-sw-fill" style={{ background: p.fill }} />
                  <span className="lcin-sw-lbl">{p.label}</span>
                </button>
              ))}
          </div>
          {hasMore && (
            <button type="button" className="lcin-more-link" onClick={() => setMoreOpen(true)}>
              {t('lite.cinemasettings.moreBackdrops', "More backdrops")}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          )}
          <p className="lcin-set-note">{look === 'glass' ? 'Panels see-through? Turn Glass up to Solid, or pick a plain backdrop.' : 'Soft day-mode washes for Paper mode.'}</p>
        </div>
        </div>
        {isMobile && <SheetFoot onDone={sheet.close} />}
      </div>
    </>
  )
}

// The full backdrop catalog (all Themes-page groups) as an in-cinema popout.
// `onClose` = back to the appearance panel; `onDone` (phones) = leave cinema settings entirely.
function CinemaBackdrops({ controls, onClose, onDone }) {
  const { t } = useTranslation()
  const { look, bg, setBg, paperBg, setPaperBg, bgCatalog, paperCatalog } = controls || {}
  const groups = (look === 'glass' ? bgCatalog : paperCatalog) || []
  const activeScene = !bg || bg.mode === 'mix' ? 'mix' : bg.scene
  const isMobile = useIsMobile()
  const sheet = useSheetDrag(onDone || onClose)
  const closing = isMobile && sheet.closing
  return (
    <>
      <div className={`lcin-set-scrim${isMobile ? ' lcin-set-scrim--sheet' : ''}${closing ? ' closing' : ''}`} onClick={isMobile ? sheet.close : onClose} aria-hidden />
      <div ref={sheet.sheetRef} className={`lcin-more${isMobile ? ' lcin-sheet' : ''}${closing ? ' closing' : ''}`} role="dialog" aria-label={t('lite.cinemabackdrops.ariaAllBackdrops', "All backdrops")}>
        {isMobile ? (
          <SheetHead title={t('lite.cinemabackdrops.title', "All backdrops")} onBack={onClose} headProps={sheet.headProps} />
        ) : (
          <div className="lcin-more-head">
            <button type="button" className="lcin-more-back" onClick={onClose} aria-label={t('lite.cinemabackdrops.ariaBack', "Back")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <span className="lcin-set-lbl">{t('lite.cinemabackdrops.allBackdrops', "All backdrops")}</span>
          </div>
        )}
        <div className="lcin-more-body">
          {look === 'glass' && (
            <button type="button" className={`lcin-sw lcin-sw--wide${activeScene === 'mix' ? ' on' : ''}`} onClick={() => setBg?.({ mode: 'mix' })}>
              <span className="lcin-sw-fill" style={{ background: 'linear-gradient(135deg,#3b6ea5,#6b4f8a 55%,#1c2a3a)' }} />
              <span className="lcin-sw-lbl">{t('lite.cinemabackdrops.rotateBanners', "Rotate banners")}</span>
            </button>
          )}
          {groups.map((g) => (
            <div key={g.title} className="lcin-more-group">
              <p className="lcin-more-grouplbl">{g.title}</p>
              <div className="lcin-more-grid">
                {g.items.map((it) => {
                  const on = look === 'glass' ? activeScene === it.id : (paperBg || 'pearl') === it.id
                  return (
                    <button key={it.id} type="button" className={`lcin-sw${on ? ' on' : ''}`} title={it.name} onClick={() => (look === 'glass' ? setBg?.({ mode: g.mode, scene: it.id }) : setPaperBg?.(it.id))}>
                      {g.kind === 'photo'
                        ? <img className="lcin-sw-fill" src={`https://images.unsplash.com/${it.photo}?w=160&q=55&auto=format&fit=crop`} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                        : <span className="lcin-sw-fill" style={{ background: it.css }} />}
                      <span className="lcin-sw-lbl">{it.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        {isMobile && <SheetFoot onDone={sheet.close} />}
      </div>
    </>
  )
}

/* ================= CRYPTO — full Screener-LITE detail carousel ================= */

function DetailCinema({ rows, market, startIndex, isLight, bgCss, lookClass, wl, onClose, onResearch, themeControls }) {
  const { t } = useTranslation()
  const tokens = useMemo(() => (Array.isArray(rows) ? rows.map((r) => toDetailToken(r, market)).filter((t) => t.symbol) : []), [rows, market])
  const [idx, setIdx] = useState(() => Math.min(Math.max(0, startIndex || 0), Math.max(0, tokens.length - 1)))
  const go = useCallback((n) => setIdx((i) => Math.min(Math.max(0, n), tokens.length - 1)), [tokens.length])
  const pick = useCallback((tok) => { const i = tokens.findIndex((t) => (t.address || t.symbol) === (tok.address || tok.symbol)); if (i >= 0) setIdx(i) }, [tokens])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const filmRef = useRef(null)
  useDockMagnify(filmRef)
  // Android back leaves cinema, not the app. The settings popover owns the
  // back press while it is up, so one press closes it and the next closes
  // cinema — the nesting a phone user expects.
  useBackDismiss(!settingsOpen, onClose)
  useBackDismiss(settingsOpen, () => setSettingsOpen(false))

  const settingsOpenRef = useRef(settingsOpen)
  useEffect(() => { settingsOpenRef.current = settingsOpen }, [settingsOpen])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // 🪤 Capture + stopPropagation: LITE's root exits the whole mode on a
        // bubbled Escape, so a plain listener closed cinema AND dropped the
        // user out of Lite onto the main app. One layer per press: the
        // appearance panel first if it is up, cinema second.
        e.stopPropagation()
        if (settingsOpenRef.current) setSettingsOpen(false)
        else onClose?.()
      }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1) }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [go, idx, onClose])
  // keep the active filmstrip token in view as the carousel advances
  useEffect(() => { filmRef.current?.querySelector('.sl-film-item.active')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }) }, [idx])

  if (!tokens.length) return null
  return (
    <div className={`lcin-full sl-root${isLight ? ' sl-root--paper' : ''}${lookClass ? ` ${lookClass}` : ''}`} role="dialog" aria-modal="true" aria-label={t('lite.detailcinema.ariaCinemaMode', "Cinema mode")}>
      {/* opaque copy of the LITE wallpaper so page chrome behind is fully hidden */}
      <div className="lcin-full-wall" style={bgCss ? { background: bgCss } : undefined} aria-hidden />
      <div className={`lcin-full-scrim ${isLight ? 'paper' : 'glass'}`} aria-hidden />
      {settingsOpen && themeControls && <CinemaSettings controls={themeControls} onClose={() => setSettingsOpen(false)} />}
      <button type="button" className="lcin-full-close" onClick={onClose} aria-label={t('lite.detailcinema.ariaCloseCinemaEsc', "Close cinema (Esc)")} title={t('lite.detailcinema.title', "Close (Esc)")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      {/* the ONLY scrolling element — so the fixed filmstrip below never gets
          trapped/scrolled by iOS (position:fixed inside -webkit-overflow-scrolling) */}
      <div className="lcin-full-body">
        <Suspense fallback={<div className="lcin-boot"><span className="lcin-boot-bar" /></div>}>
          <TokenDetail
            token={tokens[idx]}
            onBack={onClose}
            backLabel="Close"
            onOpenPro={(t) => onResearch?.(t?.symbol, {})}
            wl={wl}
            isLight={isLight}
            onPrev={() => go(idx - 1)}
            onNext={() => go(idx + 1)}
            hasPrev={idx > 0}
            hasNext={idx < tokens.length - 1}
            position={idx + 1}
            total={tokens.length}
            carousel={tokens}
            onPick={pick}
            cinema
            hideFilmstrip
            onToggleCinema={onClose}
            /* The appearance gear rides in the token header's own action row.
               It used to be position:fixed at right:66px, which put it exactly
               on top of that row's customize button. */
            topActions={themeControls ? (
              <button type="button" className={`sl-customize lcin-full-gear${settingsOpen ? ' on' : ''}`} onClick={() => setSettingsOpen((o) => !o)} aria-label={t('lite.detailcinema.ariaAppearance', "Appearance")} title={t('lite.detailcinema.title2', "Theme, glass & backdrop")}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2.4" /><circle cx="8" cy="17" r="2.4" /></svg>
              </button>
            ) : null}
          />
        </Suspense>
      </div>
      {/* filmstrip dock — a DIRECT child of the non-scrolling overlay, so it stays
          pinned to the bottom on every device (incl. iOS) */}
      {tokens.length > 1 && (
        <div className="sl-filmstrip lcin-strip" ref={filmRef}>
          {tokens.map((c, i) => (
            <button key={`${c.address || c.symbol}-${i}`} type="button" className={`sl-film-item${i === idx ? ' active' : ''}`} onClick={() => setIdx(i)} title={c.symbol}>
              {c.logo ? <img src={c.logo} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="sl-film-fallback">{String(c.symbol || '?').slice(0, 1)}</span>}
              <span className="sl-film-sym">{c.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= STOCKS — immersive card carousel ================= */

function sparkPts(change, w = 300, h = 92) {
  const dir = num(change) >= 0 ? 1 : -1
  let seed = Math.abs(num(change)) * 7 + 3
  const vals = []
  for (let i = 0; i < 28; i++) { seed = (seed * 9301 + 49297) % 233280; vals.push(50 + dir * (i / 28) * 22 + (seed / 233280 - 0.5) * 18) }
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1
  const step = w / (vals.length - 1)
  return vals.map((v, i) => `${(i * step).toFixed(1)},${(h - (h - 6) * (v - min) / span - 3).toFixed(1)}`).join(' ')
}

function StockCinema({ title, rows, startIndex, look, fmtPrice, fmtLargeShort, wl, onClose, onResearch }) {
  const { t } = useTranslation()
  const items = useMemo(() => (Array.isArray(rows) ? rows.map((r) => toDetailToken(r, 'stocks')).filter((r) => r.symbol) : []), [rows])
  const [idx, setIdx] = useState(() => Math.min(Math.max(0, startIndex || 0), Math.max(0, items.length - 1)))
  const touch = useRef(null)
  const filmRef = useRef(null)
  const go = useCallback((n) => setIdx((i) => Math.min(Math.max(0, n), items.length - 1)), [items.length])

  useEffect(() => {
    const onKey = (e) => {
      // Same trap as DetailCinema: claim Escape before LITE's root sees it.
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1) }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [go, idx, onClose])
  useEffect(() => { filmRef.current?.querySelector('.lcin-film-item.active')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }) }, [idx])

  if (!items.length) return null
  const it = items[idx]
  const isPaper = look === 'paper'
  const fp = fmtPrice || ((v) => (v != null ? `$${Number(v).toLocaleString()}` : '-'))
  const fl = fmtLargeShort || ((v) => `$${Number(v).toLocaleString()}`)
  const up = num(it.change24h) >= 0
  const starred = wl?.has?.(it.symbol)
  const onTouchStart = (e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = (e) => { const s = touch.current; if (!s) return; const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y; if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) { if (dx < 0) go(idx + 1); else go(idx - 1) } touch.current = null }

  return (
    <div className={`lcin lcin--${isPaper ? 'paper' : 'glass'}`} role="dialog" aria-modal="true" aria-label={t('lite.stockcinema.ariaCinemaMode', "Cinema mode")} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="lcin-scrim" aria-hidden onClick={onClose} />
      <div className="lcin-top">
        <span className="lcin-eyebrow">{title || 'Cinema'} · Stocks</span>
        <span className="lcin-count">{idx + 1} / {items.length}</span>
        <button type="button" className="lcin-close" onClick={onClose} aria-label={t('lite.stockcinema.ariaClose', "Close")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </div>
      <button type="button" className="lcin-arrow lcin-prev" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label={t('lite.stockcinema.ariaPrevious', "Previous")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg></button>
      <button type="button" className="lcin-arrow lcin-next" onClick={() => go(idx + 1)} disabled={idx >= items.length - 1} aria-label={t('lite.stockcinema.ariaNext', "Next")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg></button>
      <div className="lcin-stage">
        <div className="lcin-card" key={it.symbol}>
          <div className="lcin-id">
            {it.logo ? <img className="lcin-logo" src={it.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <span className="lcin-logo lcin-logo--fb">{it.symbol[0]}</span>}
            <div className="lcin-idcol"><h2 className="lcin-name">{it.name}</h2><span className="lcin-sym">{it.symbol}</span></div>
            {wl && <button type="button" className={`lcin-star${starred ? ' on' : ''}`} onClick={() => (starred ? wl.remove(it.symbol) : wl.add({ symbol: it.symbol, name: it.name, isStock: true, assetClass: 'stock' }))} aria-label={t('lite.stockcinema.ariaWatch', "Watch")}><svg viewBox="0 0 24 24" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 17.2 6.7 20l1.1-6L3.4 9.8l6-.8z" /></svg></button>}
          </div>
          <div className="lcin-price mono">{it.price != null ? fp(it.price) : '-'}</div>
          <div className="lcin-changes"><span className={`lcin-chpill ${changeCls(it.change24h)}`}>{fmtChange(it.change24h)} <em>24h</em></span></div>
          <svg className="lcin-spark" viewBox="0 0 300 92" preserveAspectRatio="none" aria-hidden><polyline points={sparkPts(it.change24h)} className={up ? 'up' : 'down'} /></svg>
          <div className="lcin-stats">{it.marketCap > 0 && <div><span>{t('lite.stockcinema.mktCap', "Mkt Cap")}</span><b className="mono">{fl(it.marketCap)}</b></div>}{it.volume24h > 0 && <div><span>{t('lite.stockcinema.volume', "Volume")}</span><b className="mono">{fl(it.volume24h)}</b></div>}</div>
          <div className="lcin-actions"><button type="button" className="lcin-research" onClick={() => onResearch?.(it.symbol, { stock: true })}>Research {it.symbol}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg></button></div>
        </div>
      </div>
      <div className="lcin-film" ref={filmRef}>
        {items.map((c, i) => (
          <button key={`${c.symbol}-${i}`} type="button" className={`lcin-film-item${i === idx ? ' active' : ''}`} onClick={() => go(i)} title={c.symbol}>
            {c.logo ? <img src={c.logo} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="lcin-film-fb">{c.symbol[0]}</span>}
            <span className="lcin-film-sym">{c.symbol}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function LiteCinema(props) {
  const isLight = props.look === 'paper'
  // Both crypto AND stocks now use the full Screener-LITE detail (real chart,
  // stats, tweets) — stocks resolve via Yahoo candles/quotes instead of on-chain.
  return <DetailCinema rows={props.rows} market={props.market} startIndex={props.startIndex} isLight={isLight} bgCss={props.bgCss} lookClass={props.lookClass} wl={props.wl} onClose={props.onClose} onResearch={props.onResearch} themeControls={props.themeControls} />
}
