/**
 * MissionControlSheet — Glassmorphic app launcher
 * Grouped sections with 11px uppercase headers, search filter,
 * Glass/Solid icon color mode toggle.
 * All pages from desktop NavigationSidebar.
 */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { NAV_SECTIONS } from '@/constants/navTree'
import { openThemeStudio, ThemeStudioIcon } from '@/lib/theme-studio'
import './mission-control-sheet.css'
import useBackDismiss from '@/hooks/use-back-dismiss'

/* ── SVG icon wrapper ── */
const N = ({ children, filled }) => (
  <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}
    stroke={filled ? 'none' : 'currentColor'} strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

/* ── Inline search icon (no spectreIcons import) ── */
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
    stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)


/**
 * Segmented control.
 *
 * The old version was two loose ghost capsules whose inactive label sat at 0.3
 * alpha — unreadable on a phone — and whose "active" state was a dim grey blob
 * with a glow behind it. This is one glass groove with a single chip that
 * slides between positions, so the control reads as a physical switch and the
 * eye can see which side it is on without hunting for a highlight.
 */
const McSeg = ({ options, value, onChange, ariaLabel }) => {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div className="mc-seg" role="tablist" aria-label={ariaLabel}>
      <span
        className="mc-seg__chip"
        aria-hidden="true"
        style={{ '--mc-seg-n': options.length, '--mc-seg-i': index }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={`mc-seg__opt${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   Per-id visual metadata (icon + tint + accent). Pure visual concern —
   the structural nav tree (sections, item order, labels, badges) lives
   in @/constants/navTree.js. Items whose id is missing from this map
   render with a neutral fallback tint/accent.
   ═══════════════════════════════════════════════════════════════ */
const MC_ITEM_VISUALS = {
  'brain': { icon: <N><path d="M9.5 2A3.5 3.5 0 006 5.5v.05A3 3 0 004 8.5a3 3 0 001 2.24V13a3 3 0 002 2.83V17a3 3 0 006 0M9.5 2A3.5 3.5 0 0113 5.5" /><path d="M14.5 2A3.5 3.5 0 0118 5.5v.05a3 3 0 012 2.95 3 3 0 01-1 2.24V13a3 3 0 01-2 2.83V17a3 3 0 01-3 3" /></N> },
  'arena': { icon: <N><path d="M6 9H4.5a2.5 2.5 0 010-5H6" /><path d="M18 9h1.5a2.5 2.5 0 000-5H18" /><path d="M6 3h12v6a6 6 0 01-12 0V3z" /><path d="M12 15v4M8 21h8" /></N> },
  'world-state': { icon: <N><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18 15 15 0 010-18z" /></N> },
  'private-markets': { icon: <N><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M8 8V6a4 4 0 018 0v2" /><circle cx="12" cy="14" r="1.5" /></N> },
  'vitals': { icon: <N><path d="M3 12h4l2.5-6 4 12L16 12h5" /></N> },
  'intelligence-feed': { icon: <N><path d="M4 11a9 9 0 019 9" /><path d="M4 4a16 16 0 0116 16" /><circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" /></N> },
  'tokenized-assets': { icon: <N><path d="M3 21h18" /><path d="M5 21V9l7-5 7 5v12" /><path d="M9 21v-6h6v6" /></N> },
  'zigchain': { icon: <N><path d="M13 2L5 14h6l-2 8 8-12h-6l2-8z" /></N> },
  'wallets': { icon: <N><path d="M3 7a2 2 0 012-2h12a2 2 0 012 2" /><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="16.5" cy="13.5" r="1.5" /></N> },
  'etf-flows': { icon: <N><path d="M7 17V9M7 9L4 12M7 9l3 3" /><path d="M17 7v8M17 15l3-3M17 15l-3-3" /></N> },
  'predictions': { icon: <N><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /><path d="M12 3v2M21 12h-2M12 21v-2M3 12h2" /></N> },
  'world': { icon: <N><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3.5 9h17M3.5 15h17" /></N> },
  'market-cinema': { icon: <N><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20" /><path d="M6 4l2 5M12 4l2 5M18 4l2 5" /><path d="M10 13l5 3-5 3z" /></N> },
  'alt-rotation': { icon: <N><path d="M21 12a9 9 0 01-9 9 9 9 0 01-8.5-6" /><path d="M3 12a9 9 0 019-9 9 9 0 018.5 6" /><path d="M3 17v-5h5M21 7v5h-5" /></N> },
  'why': { icon: <N><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 115 .5c0 1.5-2.5 2-2.5 3.5" /><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" /></N> },
  'pulse': { icon: <N><path d="M2 12h5l2-7 4 14 2.5-7H22" /></N> },
  'potential-gainers': { icon: <N><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></N> },
  'x-intel': { icon: <N><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></N> },
  'lens': { icon: <N><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.3-4.3" /><path d="M8.5 11h5M11 8.5v5" /></N> },
  'research-platform': { tint: '245, 245, 247', accent: '#64748b',
    icon: <N><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></N> },
  'monarch-ai-chat': { tint: '245, 158, 11', accent: '#f59e0b',
    icon: <N><path d="M12 2L9 8.5L3 10l4.5 5L6 21l6-3l6 3l-1.5-6L21 10l-6-1.5L12 2z" /></N> },
  'you': { tint: '139, 92, 246', accent: '#8b5cf6',
    icon: <N><circle cx="12" cy="12" r="10" /><path d="M12 8v4l2 2" /><circle cx="12" cy="12" r="3" /></N> },
  'discover': { tint: '6, 182, 212', accent: '#06b6d4',
    icon: <N><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></N> },
  'ventures': { tint: '234, 179, 8', accent: '#eab308',
    icon: <N><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /><line x1="12" y1="12" x2="12" y2="16" /><circle cx="12" cy="12" r="1" /></N> },
  'intelligence': { tint: '99, 102, 241', accent: '#6366f1',
    icon: <N><path d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" /></N> },
  'news': { tint: '14, 165, 233', accent: '#0ea5e9',
    icon: <N><path d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2" /><path d="M7 8h6M7 12h6M7 16h4" /></N> },
  'research-zone': { tint: '16, 185, 129', accent: '#10b981',
    icon: <N><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></N> },
  'search-engine': { tint: '168, 85, 247', accent: '#a855f7',
    icon: <N><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></N> },
  'ai-screener': { tint: '249, 115, 22', accent: '#f97316',
    icon: <N><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /><circle cx="12" cy="10" r="2" /><path d="M8 10a4 4 0 018 0" /></N> },
  'traders-corner': { tint: '239, 68, 68', accent: '#ef4444',
    icon: <N><path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" /></N> },
  'liquidation-heatmap': { tint: '244, 63, 94', accent: '#f43f5e',
    icon: <N><path d="M3 3v18h18" /><path d="M7 17l4-8 4 4 5-9" /><circle cx="7" cy="17" r="1.5" fill="currentColor" stroke="none" /><circle cx="11" cy="9" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="13" r="1.5" fill="currentColor" stroke="none" /><circle cx="20" cy="4" r="1.5" fill="currentColor" stroke="none" /></N> },
  'ai-charts': { tint: '99, 102, 241', accent: '#6366f1',
    icon: <N><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></N> },
  'ai-market-analysis': { tint: '59, 130, 246', accent: '#3b82f6',
    icon: <N><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /><circle cx="12" cy="12" r="2" /></N> },
  'economic-calendar': { tint: '20, 184, 166', accent: '#14b8a6',
    icon: <N><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></N> },
  'heatmaps': { tint: '249, 115, 22', accent: '#f97316',
    icon: <N><rect x="2" y="2" width="9" height="11" rx="1" /><rect x="13" y="2" width="9" height="6" rx="1" /><rect x="13" y="10" width="9" height="12" rx="1" /><rect x="2" y="15" width="9" height="7" rx="1" /></N> },
  'bubbles': { tint: '236, 72, 153', accent: '#ec4899',
    icon: <N><circle cx="10" cy="10" r="7" /><circle cx="18" cy="8" r="4" /><circle cx="16" cy="18" r="3.5" /></N> },
  'fear-greed': { tint: '245, 158, 11', accent: '#f59e0b',
    icon: <N><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /><circle cx="12" cy="12" r="2" /></N> },
  'social-zone': { tint: '139, 92, 246', accent: '#8b5cf6',
    icon: <N><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></N> },
  'ai-media-center': { tint: '236, 72, 153', accent: '#ec4899',
    icon: <N><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /><path d="M17 8h.01" /></N> },
  'x-dash': { tint: '245, 245, 247', accent: '#64748b',
    icon: <N filled><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></N> },
  'x-bubbles': { tint: '59, 130, 246', accent: '#3b82f6',
    icon: <N><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /><circle cx="9" cy="10" r="1" /><circle cx="15" cy="10" r="1" /></N> },
  'x-intelligence': { tint: '139, 92, 246', accent: '#8b5cf6',
    icon: <N><path d="M21 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v3" /><path d="M21 16v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3" /><path d="M12 2v20" /><path d="M8 6l4-3 4 3" /><circle cx="7" cy="12" r="1.5" /><circle cx="17" cy="12" r="1.5" /><path d="M8.5 12h7" /></N> },
  'watchlists': { tint: '245, 158, 11', accent: '#f59e0b',
    icon: <N><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></N> },
  'categories': { tint: '16, 185, 129', accent: '#10b981',
    icon: <N><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></N> },
  'roi-calculator': { tint: '20, 184, 166', accent: '#14b8a6',
    icon: <N><path d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></N> },
  'user-dashboard': { tint: '245, 245, 247', accent: '#64748b',
    icon: <N><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></N> },
  'structure-guide': { tint: '168, 85, 247', accent: '#a855f7',
    icon: <N><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /><path d="M8 7h8M8 11h8M8 15h4" /></N> },
  'gm-dashboard': { tint: '245, 158, 11', accent: '#f59e0b',
    icon: <N><path d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></N> },
}

/**
 * Colour carries the SECTION, not the page.
 *
 * Every tile used to pick its own hue from a twelve-colour list, so the grid
 * came out as a rainbow of saturated squares — decoration that told the reader
 * nothing and read as a stock app-launcher. Keyed to the section instead, the
 * colour answers "which part of the product is this?" while the icon carries
 * the page's own identity. The hues are deliberately desaturated: on a dark
 * sheet a saturated fill glows, and glowing chrome is the thing this product
 * does not do.
 */
const MC_SECTION_TINT = {
  home: '203, 213, 225',      // slate — the neutral home surface
  research: '125, 211, 252',  // sky
  trading: '110, 231, 183',   // mint
  analysis: '252, 211, 77',   // amber
  visualize: '244, 164, 194', // rose
  social: '94, 234, 212',     // teal
  tools: '148, 163, 184',     // muted slate — chrome, not content
  account: '203, 213, 225',
}
// Deliberately no violet: the design system reserves it for the EUPHORIA market
// state, and spending it on a nav tile would make a real signal unreadable.
const MC_FALLBACK_TINT = '203, 213, 225'

/** A page with no bespoke glyph still gets a real icon, never a blank tile. */
const MC_GENERIC_ICON = (
  <N><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 12h8" /></N>
)

/**
 * Sections come straight from NAV_SECTIONS and EVERY item renders.
 *
 * This used to filter to ids present in the visuals map, which silently dropped
 * 19 live pages — Vitals, Brain, Arena, World State, Tokenized Assets and more —
 * so Mission Control and the sidebar disagreed about what the product contains.
 * A missing glyph is a cosmetic gap; a missing page is a navigation dead end.
 */
function buildMcSections(t) {
  return NAV_SECTIONS
    .map((section) => {
      const tint = MC_SECTION_TINT[section.id] || MC_FALLBACK_TINT
      return {
        label: t(section.labelKey),
        items: section.items.map((item) => ({
          id: item.id,
          label: t(item.labelKey),
          badge: item.badgeKey ? t(item.badgeKey) : undefined,
          isComingSoon: item.badgeKey === 'nav.badge.comingSoon',
          tint,
          icon: MC_ITEM_VISUALS[item.id]?.icon || MC_GENERIC_ICON,
        })),
      }
    })
    .filter((section) => section.items.length > 0)
}

const MissionControlSheet = ({ isOpen, onClose, onPageChange, usMarketStatus }) => {
  // Android back / back-swipe closes the sheet instead of leaving the app.
  useBackDismiss(isOpen, onClose)
  const { t } = useTranslation()
  const sheetRef = useRef(null)
  const searchRef = useRef(null)
  // Default = mono (all icons the same warm-white gray); the colored glass
  // tint is the opt-in. Persisted so the choice survives reloads.
  const [glassMode, setGlassModeState] = useState(() => (
    window.localStorage?.getItem('spectre-mc-mode') === 'color'
  ))
  const setGlassMode = (v) => {
    setGlassModeState(v)
    try { window.localStorage?.setItem('spectre-mc-mode', v ? 'color' : 'mono') } catch (_) {}
  }
  // Default = All. Grouped buries the page you want behind section headers you
  // have to read first; the flat grid shows the whole app at once, which is the
  // point of Mission Control (founder, 08-03). Persisted like `glassMode`, so
  // choosing Grouped sticks.
  const [flatMode, setFlatModeState] = useState(() => (
    window.localStorage?.getItem('spectre-mc-group') !== 'grouped'
  ))
  const setFlatMode = (v) => {
    setFlatModeState(v)
    try { window.localStorage?.setItem('spectre-mc-group', v ? 'all' : 'grouped') } catch (_) {}
  }
  const [search, setSearch] = useState('')

  // ── Drag to dismiss ──
  // The handle was a bare <div>: it LOOKS draggable, so a drag on it did
  // nothing and the browser rubber-banded the page instead, which is the
  // "weird gap" (a fixed, bottom-anchored sheet detaching from the bottom edge
  // while the visual viewport bounces — the same iOS mismatch the closed-state
  // comment in the CSS already describes).
  //
  // Pointer events, not touch: the same code then works for a trackpad drag.
  // Position is written straight to the node inside rAF rather than through
  // state — a setState per pointermove re-renders the whole nav grid.
  const dragRef = useRef({ active: false, startY: 0, dy: 0, t0: 0, frame: 0 })

  const endDrag = useCallback((commit) => {
    const d = dragRef.current
    if (!d.active) return
    d.active = false
    if (d.frame) { cancelAnimationFrame(d.frame); d.frame = 0 }
    const el = sheetRef.current
    if (!el) return
    el.style.transition = ''
    el.style.transform = ''
    // Dismiss on distance OR on a fast flick, so a short sharp swipe closes.
    const velocity = d.dy / Math.max(1, performance.now() - d.t0)
    if (commit && (d.dy > 120 || (d.dy > 40 && velocity > 0.5))) onClose()
    d.dy = 0
  }, [onClose])

  const onHandlePointerDown = useCallback((e) => {
    const el = sheetRef.current
    if (!el) return
    dragRef.current = { active: true, startY: e.clientY, dy: 0, t0: performance.now(), frame: 0 }
    // 🪤 The sheet carries `transition: transform 320ms`. Writing transform
    // every frame while that transition runs restarts it every frame and the
    // element never arrives — it just lags behind the finger. Suspend it for
    // the duration of the drag and restore on release.
    el.style.transition = 'none'
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [])

  const onHandlePointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d.active) return
    // Down only — an upward drag must not lift the sheet off the bottom edge.
    d.dy = Math.max(0, e.clientY - d.startY)
    if (d.frame) return
    d.frame = requestAnimationFrame(() => {
      d.frame = 0
      const el = sheetRef.current
      if (el && d.active) el.style.transform = `translateY(${d.dy}px)`
    })
  }, [])

  const onHandlePointerUp = useCallback(() => endDrag(true), [endDrag])
  const onHandlePointerCancel = useCallback(() => endDrag(false), [endDrag])

  // A sheet closed by any other route (backdrop tap, Escape, navigation) must
  // not keep a stale inline transform, or it reopens already dragged down.
  useEffect(() => { if (!isOpen) endDrag(false) }, [isOpen, endDrag])

  // Sections derived from the canonical nav registry + per-id visuals.
  const mcSections = useMemo(() => buildMcSections(t), [t])

  // Clear search when sheet closes
  useEffect(() => {
    if (!isOpen) setSearch('')
  }, [isOpen])

  // Focus search when sheet opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => searchRef.current?.focus(), 350)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  const handleItemTap = useCallback((item) => {
    if (item.isComingSoon) return
    onPageChange(item.id)
    onClose()
  }, [onPageChange, onClose])

  // Filter sections by search query
  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return mcSections
    return mcSections
      .map(section => ({
        ...section,
        items: section.items.filter(item =>
          item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
        ),
      }))
      .filter(section => section.items.length > 0)
  }, [search, mcSections])

  // Flat list of all items (for flat mode)
  const allItems = useMemo(() => {
    return filteredSections.flatMap(s => s.items)
  }, [filteredSections])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`mc-sheet-backdrop ${isOpen ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={`mc-sheet ${isOpen ? 'open' : ''}`}
        role="dialog"
        aria-label="Mission Control"
        aria-modal="true"
      >
        {/* Drag handle. The hit area is much larger than the 4px pill so a
            thumb can actually catch it; `touch-action: none` (CSS) is what
            stops the browser scrolling/bouncing the page under the drag. */}
        <div
          className="mc-sheet-handle-area"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerCancel}
          role="button"
          tabIndex={-1}
          aria-label={t('common.close', 'Close')}
        >
          <div className="mc-sheet-handle" />
        </div>

        {/* Header with toggles */}
        <div className="mc-sheet-header">
          <div className="mc-sheet-title-row">
            <h2 className="mc-sheet-title">Mission Control</h2>
            {usMarketStatus && (
              <span className={`mc-market-badge ${usMarketStatus.isOpen ? 'mc-market-open' : 'mc-market-closed'}`}>
                <span className="mc-market-dot" />
                US {usMarketStatus.isOpen ? 'Open' : 'Closed'}
              </span>
            )}
          </div>
          <div className="mc-sheet-toggles">
            <McSeg
              ariaLabel="Layout"
              value={flatMode ? 'all' : 'grouped'}
              onChange={(v) => setFlatMode(v === 'all')}
              options={[{ value: 'grouped', label: 'Grouped' }, { value: 'all', label: 'All' }]}
            />
            <McSeg
              ariaLabel="Tile style"
              value={glassMode ? 'glass' : 'solid'}
              onChange={(v) => setGlassMode(v === 'glass')}
              options={[{ value: 'solid', label: 'Solid' }, { value: 'glass', label: 'Glass' }]}
            />
            {/* Themes lives with the other appearance controls, not in the page
                grid: the studio is a panel, not a route, so a nav tile would
                promise navigation it does not do. Closes the sheet first —
                otherwise the studio opens behind it. */}
            <button
              type="button"
              className="mc-themes-btn"
              onClick={() => { onClose(); openThemeStudio() }}
            >
              <ThemeStudioIcon size={14} strokeWidth={1.9} />
              Themes
            </button>
          </div>
        </div>

        {/* Search input - fixed, above scroll area */}
        <div className="mc-sheet-search">
          <span className="mc-sheet-search-icon"><SearchIcon /></span>
          <input
            ref={searchRef}
            /* ui-bare-input: the row around it IS the field — without the
               opt-out the mobile input rules paint a second, taller box on
               top of it (app-store-ready.css). */
            className="mc-sheet-search-input ui-bare-input"
            type="text"
            placeholder="Search pages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Icon grid - grouped or flat */}
        <div className={`mc-sheet-scroll ${glassMode ? 'mc-mode-glass' : 'mc-mode-solid'}`}>
          {flatMode ? (
            /* ── Flat: single grid, no section headers ── */
            allItems.length > 0 ? (
              <div className="mc-sheet-grid mc-sheet-grid-flat">
                {allItems.map(item => (
                  <button
                    key={item.id}
                    className={`mc-sheet-item${item.isComingSoon ? ' mc-sheet-item-disabled' : ''}`}
                    onClick={() => handleItemTap(item)}
                    type="button"
                    aria-disabled={item.isComingSoon || undefined}
                  >
                    <span
                      className="mc-sheet-icon"
                      style={{
                        '--mc-tint': item.tint,
                      }}
                    >
                      {item.icon}
                      {item.badge && (
                        <span className={`mc-sheet-badge ${item.isComingSoon ? 'mc-sheet-badge-coming-soon' : ''}`}>
                          {item.isComingSoon ? t('nav.badge.soon', 'Soon') : item.badge}
                        </span>
                      )}
                    </span>
                    <span className="mc-sheet-label">{item.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mc-sheet-empty">{t('missionControl.noPagesFound', 'No pages found')}</div>
            )
          ) : (
            /* ── Grouped: sections with headers ── */
            <>
              {filteredSections.map(section => (
                <div key={section.label} className="mc-sheet-section">
                  <div className="mc-sheet-section-label">{section.label}</div>
                  <div className="mc-sheet-grid">
                    {section.items.map(item => (
                      <button
                        key={item.id}
                        className="mc-sheet-item"
                        onClick={() => handleItemTap(item)}
                        type="button"
                      >
                        <span
                          className="mc-sheet-icon"
                          style={{
                            '--mc-tint': item.tint,
                          }}
                        >
                          {item.icon}
                          {item.badge && (
                            <span className={`mc-sheet-badge ${item.isComingSoon ? 'mc-sheet-badge-coming-soon' : ''}`}>
                              {item.isComingSoon ? t('nav.badge.soon', 'Soon') : item.badge}
                            </span>
                          )}
                        </span>
                        <span className="mc-sheet-label">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {filteredSections.length === 0 && (
                <div className="mc-sheet-empty">{t('missionControl.noPagesFound', 'No pages found')}</div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

export default MissionControlSheet
