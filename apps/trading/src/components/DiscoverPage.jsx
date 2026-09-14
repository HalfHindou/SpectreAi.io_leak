/**
 * DiscoverPage - "The Deal Room"
 * Thin orchestrator that composes all Discover sections.
 * Apple-style institutional investor crypto discovery page.
 */
import React, { useState, useCallback, useEffect, useRef, useMemo, Suspense } from 'react'
import lazy from '../lib/lazy-with-retry'
import { track, trackUi, Events } from '../services/analytics'
import DiscoverHero from './DiscoverHero'
import useResearchDeskPrices from '../hooks/useResearchDeskPrices'
import useResearchDesk from '../hooks/useResearchDesk'
import LazyErrorBoundary from './LazyErrorBoundary'

import TokenSearch from './TokenSearch'
import InfoTip from './InfoTip'
import TokenDiscoveryTable from './TokenDiscoveryTable'
import CompareModal from './CompareModal'

/* ---- Scroll-driven character reveal (POPUP.FUND style) ---- */
function ScrollTextReveal({ text, className = '' }) {
  const containerRef = useRef(null)
  const charsRef = useRef([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const rect = container.getBoundingClientRect()
      const vh = window.innerHeight
      // progress: 0 when bottom edge enters viewport, 1 when top edge leaves
      const progress = Math.max(0, Math.min(1, (vh - rect.top) / (vh + rect.height)))

      const chars = charsRef.current
      const total = chars.length
      for (let i = 0; i < total; i++) {
        const charProgress = (i + 1) / total
        if (progress > charProgress * 0.7) {
          chars[i]?.classList.add('is-lit')
        } else {
          chars[i]?.classList.remove('is-lit')
        }
      }
    }

    // capture:true so ELEMENT scrolls are caught too - in the research-app
    // iframe the scroller is the `.app-embedded` div, not the window, and
    // element scroll events don't bubble. Without capture the heading froze
    // at whatever lit state the initial check produced.
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true })
    handleScroll() // initial check
    return () => window.removeEventListener('scroll', handleScroll, { capture: true })
  }, [text])

  const chars = useMemo(() => {
    return text.split('').map((char, i) => ({
      char,
      isSpace: char === ' ',
      key: i,
    }))
  }, [text])

  return (
    <div ref={containerRef} className={`scroll-text-reveal-wrap ${className}`}>
      <span className="scroll-text-reveal">
        {chars.map(({ char, isSpace, key }) =>
          isSpace ? (
            <span key={key} className="char char-space">&nbsp;</span>
          ) : (
            <span
              key={key}
              ref={(el) => { charsRef.current[key] = el }}
              className="char"
            >
              {char}
            </span>
          )
        )}
      </span>
    </div>
  )
}

const DealFlowPipeline = lazy(() => import('./DealFlowPipeline'))
const TokenPitchDeck = lazy(() => import('./TokenPitchDeck'))
const InstitutionalScorecard = lazy(() => import('./InstitutionalScorecard'))
const SectorRotationMap = lazy(() => import('./SectorRotationMap'))
const SectorMomentumTicker = lazy(() => import('./SectorMomentumTicker'))
const AlphaThesisCards = lazy(() => import('./AlphaThesisCards'))

/* ---- Meme Research Desk components ---- */
const MemeFlowPipeline = lazy(() => import('./MemeFlowPipeline'))
const DegenScorecard = lazy(() => import('./DegenScorecard'))
const MemeTrendRadar = lazy(() => import('./MemeTrendRadar'))
const DegenThesis = lazy(() => import('./DegenThesis'))
import './DiscoverPage.css'

/* ---- Scroll-reveal IntersectionObserver hook ---- */
function useScrollReveal() {
  const ref = useRef(null)
  useEffect(() => {
    const container = ref.current
    if (!container) return
    const sections = container.querySelectorAll('.scroll-reveal')
    if (!sections.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.05, rootMargin: '0px 0px -80px 0px' }
    )

    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [])
  return ref
}

// Default Terminal target: SPECTRE. selectToken() sets it as the active token
// and routes to the token page, so "Terminal" always opens on SPECTRE.
const SPECTRE_TOKEN = {
  symbol: 'SPECTRE',
  name: 'Spectre AI',
  address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6',
  networkId: 1,
  verified: true,
  socials: { twitter: 'https://x.com/Spectre__AI' },
}

/* Empty state shown when a chain + cap filter combo matches zero dynamic
   projects. Kept lightweight - the Deal Flow / Scorecard components fall back
   to static blue-chips on an empty array, so we render this instead of passing
   `[]` down (which would silently resurrect the demo data). */
function ResearchDeskNoMatch({ onClear }) {
  return (
    <div className="research-desk-nomatch">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <p className="research-desk-nomatch-title">No projects match these filters</p>
      <p className="research-desk-nomatch-sub">Try a different chain or cap tier.</p>
      <button className="research-desk-nomatch-btn" onClick={onClear}>Clear filters</button>
    </div>
  )
}

function DiscoverPage({ selectToken, navigateTo }) {
  const pageRef = useScrollReveal()

  /* ---- Real-time CoinGecko prices for Research Desk (static blue chips) ---- */
  const { prices: livePrices } = useResearchDeskPrices()

  /* ---- Research Desk mode: 'projects' | 'memes' ----
     Declared above the bundle hook because the memes tier is fetched on
     demand: it is the slowest of the four and renders only in Memes mode. */
  const [researchMode, setResearchMode] = useState('projects')

  /* ---- Dynamic Research Desk bundle (projects + sectors + memes + AI content) ---- */
  const {
    projects: deskProjects,
    sectors: deskSectors,
    memes: deskMemes,
    content: deskContent,
  } = useResearchDesk({ memesEnabled: researchMode === 'memes' })

  /* ---- Global token search - cross-section highlight ---- */
  const [activeSymbol, setActiveSymbol] = useState(null)

  const handleSearchSelect = useCallback((symbol) => {
    setActiveSymbol(symbol)
  }, [])

  const handleSearchClear = useCallback(() => {
    setActiveSymbol(null)
  }, [])

  /* ---- Research Desk unified tab ---- */
  /* Projects: 'pipeline' | 'pitchdeck' | 'scorecard' | 'rotation' | 'thesis' */
  /* Memes:    'meme-pipeline' | 'meme-scorecard' | 'meme-trends' | 'meme-thesis' */
  const [researchTab, setResearchTab] = useState('pipeline')

  const handleModeSwitch = useCallback((mode) => {
    if (mode === researchMode) return
    setResearchMode(mode)
    setResearchTab(mode === 'projects' ? 'pipeline' : 'meme-pipeline')
  }, [researchMode])

  /* ---- Projects-mode filters: chain + cap tier ----
     Apply ONLY to the dynamic Projects feed (Deal Flow + Scorecard). The
     backend tags each project with `networkId` (1 ETH / 8453 Base /
     1399811149 Solana) and `capTier` ('low' | 'mid' | 'high' | 'unknown').
     'unknown' cap matches only the 'all' cap filter. */
  const [chainFilter, setChainFilterRaw] = useState('all') // 'all' | 'eth' | 'solana' | 'base'
  const [capFilter, setCapFilterRaw] = useState('all')      // 'all' | 'low' | 'mid' | 'high'
  const [categoryFilter, setCategoryFilterRaw] = useState('all') // 'all' | <sector label>
  // Tracked setters: every filter change lands in PostHog as a UI Interaction
  // ({control, value}; page_area super-prop identifies the Discover page).
  const setChainFilter = (v) => { trackUi('chain_filter', v); setChainFilterRaw(v) }
  const setCapFilter = (v) => { trackUi('cap_filter', v); setCapFilterRaw(v) }
  const setCategoryFilter = (v) => { trackUi('category_filter', v); setCategoryFilterRaw(v) }

  // Category pills derived live from the feed's `sector` labels (DEX, Lending,
  // Derivatives, RWA, ... and AI/Gaming/etc. once tokens blend in), most-common first.
  const categoryOptions = useMemo(() => {
    const counts = {}
    for (const p of (Array.isArray(deskProjects) ? deskProjects : [])) {
      const s = p && (p.sector || p.category)
      if (s) counts[s] = (counts[s] || 0) + 1
    }
    return ['all', ...Object.keys(counts).sort((a, b) => counts[b] - counts[a])]
  }, [deskProjects])

  const filteredProjects = useMemo(() => {
    if (!Array.isArray(deskProjects)) return deskProjects
    const NET = { eth: 1, base: 8453, solana: 1399811149 }
    return deskProjects.filter(p =>
      (chainFilter === 'all' || p.networkId === NET[chainFilter]) &&
      (capFilter === 'all' || p.capTier === capFilter) &&
      (categoryFilter === 'all' || (p.sector || p.category) === categoryFilter)
    )
  }, [deskProjects, chainFilter, capFilter, categoryFilter])

  const filtersActive = chainFilter !== 'all' || capFilter !== 'all' || categoryFilter !== 'all'
  // A 0-result filter combo must NOT pass an empty array down — DealFlow /
  // Scorecard fall back to their STATIC blue-chips on `projects.length === 0`,
  // which would silently resurrect the demo data and look like the filter
  // broke. Render an explicit no-match state instead.
  const noProjectsMatch = filtersActive && Array.isArray(filteredProjects) && filteredProjects.length === 0

  const clearProjectFilters = useCallback(() => {
    setChainFilter('all')
    setCapFilter('all')
  }, [])

  /* ---- Compare mode state ---- */
  const [compareMode, setCompareMode] = useState(false)
  const [compareTokens, setCompareTokens] = useState([])
  const [showCompareModal, setShowCompareModal] = useState(false)

  const toggleCompareToken = useCallback((token, e) => {
    if (e) e.stopPropagation()
    setCompareTokens(prev => {
      const exists = prev.find(t => t.address === token.address)
      if (exists) return prev.filter(t => t.address !== token.address)
      if (prev.length >= 4) return prev
      return [...prev, token]
    })
  }, [])

  const removeCompareToken = useCallback((address) => {
    setCompareTokens(prev => prev.filter(t => t.address !== address))
  }, [])

  const openCompareModal = useCallback(() => {
    if (compareTokens.length >= 2) {
      track(Events.COMPARE_USED, {
        tokens: compareTokens.map(t => t.symbol),
        tokens_count: compareTokens.length
      })
      setShowCompareModal(true)
    }
  }, [compareTokens])

  const closeCompareModal = useCallback(() => setShowCompareModal(false), [])

  const exitCompareMode = useCallback(() => {
    setCompareMode(false)
    setCompareTokens([])
    setShowCompareModal(false)
  }, [])

  const handleSelectFromCompare = useCallback((token) => {
    if (selectToken) selectToken(token, 'discovery')
    setShowCompareModal(false)
    exitCompareMode()
  }, [selectToken, exitCompareMode])

  return (
    <div className="discover-page" ref={pageRef}>
      {/* 1. Hero - greeting + inline market pulse (no scroll-reveal, immediate) */}
      <section className="discover-section">
        <DiscoverHero
          onLaunchTerminal={() => navigateTo('token')}
          onLaunchTrending={() => navigateTo('trending')}
        />
      </section>

      {/* 2. Sector Momentum Ticker - scrolling marquee bar */}
      <section className="discover-section discover-section--tight discover-section--flush scroll-reveal">
        <LazyErrorBoundary>
          <Suspense fallback={<div className="discover-section-skeleton discover-section-skeleton--short" />}>
            <SectorMomentumTicker sectors={deskSectors} />
          </Suspense>
        </LazyErrorBoundary>
      </section>

      {/* 3. Token Discovery Table - THE CORE */}
      <section id="discover-table" className="discover-section discover-section--wide scroll-reveal" style={{ scrollMarginTop: '72px' }}>
        <TokenDiscoveryTable
          selectToken={selectToken}
          compareMode={compareMode}
          compareTokens={compareTokens}
          onToggleCompare={toggleCompareToken}
          onExitCompare={exitCompareMode}
        />
      </section>

      {/* 3.5. Scroll-driven text reveal - Research Desk interstitial */}
      <section className="discover-section discover-section--reveal">
        <ScrollTextReveal
          text="Go further. Measure conviction, not just price."
          className="discover-reveal-headline"
        />
      </section>

      {/* 4. Research Desk - unified tabbed section */}
      <section className="discover-section discover-section--wide scroll-reveal">
        <div className="research-desk">
          <div className="research-desk-header">
            <div className="research-desk-header-text">
              <h2 className="research-desk-title">Research Desk<InfoTip text="Deep-dive analysis tools modeled after institutional research - deal pipelines, pitch decks, scorecards, sector rotation, and thesis notes." position="right" /></h2>
              {/* Mode toggle - Projects / Memes */}
              <div className="research-desk-mode-toggle">
                <button
                  className={`research-desk-mode-btn ${researchMode === 'projects' ? 'is-active' : ''}`}
                  onClick={() => handleModeSwitch('projects')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                  Projects
                </button>
                <button
                  className={`research-desk-mode-btn ${researchMode === 'memes' ? 'is-active' : ''}`}
                  onClick={() => handleModeSwitch('memes')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <line x1="9" y1="9" x2="9.01" y2="9" />
                    <line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                  Memes
                </button>
              </div>
              <p className="research-desk-subtitle">
                {/* Projects subtitles */}
                {researchTab === 'pipeline' && 'Institutional deal pipeline - tokens flowing through sourced, due diligence, high conviction, and positioned stages.'}
                {researchTab === 'pitchdeck' && 'Deep due diligence presented as startup pitch decks - problem, solution, traction, tokenomics, team, moat, and valuation.'}
                {researchTab === 'scorecard' && 'Quality ratings across five institutional dimensions - liquidity, concentration, revenue, smart money, and momentum.'}
                {researchTab === 'rotation' && 'Capital rotation across DeFi sectors - accumulation, markup, distribution, and markdown cycle phases.'}
                {researchTab === 'thesis' && 'Short-form research notes - bull case, bear case, key catalysts, risk assessment, and price targets.'}
                {/* Memes subtitles */}
                {researchTab === 'meme-pipeline' && 'Meme lifecycle tracker - fresh mints flowing through traction, viral breakout, and take profit stages.'}
                {researchTab === 'meme-scorecard' && 'Meme quality ratings - community strength, liquidity depth, holder distribution, hype velocity, and safety checks.'}
                {researchTab === 'meme-trends' && 'Meme category rotation - which themes are accumulating, trending, or fading across animal, political, AI, and culture memes.'}
                {researchTab === 'meme-thesis' && 'Alpha research notes - viral catalysts, community conviction, rug risk, whale activity, and comparable memes.'}
              </p>
            </div>
            <div className="research-desk-search">
              <TokenSearch
                onSelect={handleSearchSelect}
                onClear={handleSearchClear}
                activeSymbol={activeSymbol}
                projects={deskProjects}
              />
            </div>
          </div>
          <div className="research-desk-tabs">
            {researchMode === 'projects' ? (
              <>
                <button className={`research-desk-tab ${researchTab === 'pipeline' ? 'is-active' : ''}`} onClick={() => setResearchTab('pipeline')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
                  </svg>
                  Deal Flow<InfoTip text="VC-style deal pipeline. Tokens flow through stages: Sourced, Due Diligence, High Conviction, and Positioned." position="bottom" />
                </button>
                <button className={`research-desk-tab ${researchTab === 'pitchdeck' ? 'is-active' : ''}`} onClick={() => setResearchTab('pitchdeck')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
                  </svg>
                  Pitch Deck<InfoTip text="Every token presented like a startup raising a round - problem, solution, traction, tokenomics, team, moat, and valuation." position="bottom" />
                </button>
                <button className={`research-desk-tab ${researchTab === 'scorecard' ? 'is-active' : ''}`} onClick={() => setResearchTab('scorecard')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Scorecard<InfoTip text="Institutional quality ratings across five dimensions - liquidity, holder concentration, revenue, smart money flow, and momentum." position="bottom" />
                </button>
                <button className={`research-desk-tab ${researchTab === 'rotation' ? 'is-active' : ''}`} onClick={() => setResearchTab('rotation')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 11-6.219-8.56M21 3v6h-6" />
                  </svg>
                  Rotation<InfoTip text="Where capital is flowing between DeFi sectors. Tracks market cycle phases: Accumulation, Markup, Distribution, Markdown." position="bottom" />
                </button>
                <button className={`research-desk-tab ${researchTab === 'thesis' ? 'is-active' : ''}`} onClick={() => setResearchTab('thesis')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Alpha Thesis<InfoTip text="Short-form research notes with bull and bear cases, risk scores, price targets, key catalysts, and time horizons." position="bottom" />
                </button>
              </>
            ) : (
              <>
                <button className={`research-desk-tab ${researchTab === 'meme-pipeline' ? 'is-active' : ''}`} onClick={() => setResearchTab('meme-pipeline')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                  </svg>
                  Meme Pipeline<InfoTip text="Track memes through their lifecycle: Fresh Mint, Gaining Traction, Going Viral, and Take Profit stages." position="bottom" />
                </button>
                <button className={`research-desk-tab ${researchTab === 'meme-scorecard' ? 'is-active' : ''}`} onClick={() => setResearchTab('meme-scorecard')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <path d="M9 9h.01M15 9h.01" />
                  </svg>
                  Meme Score<InfoTip text="Meme quality ratings: community strength, liquidity depth, holder distribution, hype velocity, and safety/rug checks." position="bottom" />
                </button>
                <button className={`research-desk-tab ${researchTab === 'meme-trends' ? 'is-active' : ''}`} onClick={() => setResearchTab('meme-trends')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                  Trend Radar<InfoTip text="Which meme categories are hot: animal, political, AI, culture, degen. Track trend accumulation and distribution." position="bottom" />
                </button>
                <button className={`research-desk-tab ${researchTab === 'meme-thesis' ? 'is-active' : ''}`} onClick={() => setResearchTab('meme-thesis')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Alpha Thesis<InfoTip text="Alpha research notes: viral catalysts, community conviction, rug risk, whale activity, and comparable memes." position="bottom" />
                </button>
              </>
            )}
          </div>

          {/* Projects-mode filters - chain + cap tier. Only the Deal Flow +
              Scorecard tabs read these filters; Rotation / Alpha Thesis / Pitch
              Deck are dynamic too but render the full sector/project set. */}
          {researchMode === 'projects' && (researchTab === 'pipeline' || researchTab === 'scorecard') && (
            <div className="research-desk-filters">
              <div className="rdf-group" role="radiogroup" aria-label="Filter projects by chain">
                <span className="rdf-label">Chain</span>
                {[
                  { id: 'all', label: 'All' },
                  { id: 'eth', label: 'ETH', dot: '#627EEA' },
                  { id: 'solana', label: 'Solana', dot: '#14F195' },
                  { id: 'base', label: 'Base', dot: '#0052FF' },
                ].map(c => (
                  <button
                    key={c.id}
                    className={`rdf-pill${chainFilter === c.id ? ' is-active' : ''}`}
                    onClick={() => setChainFilter(c.id)}
                    role="radio"
                    aria-checked={chainFilter === c.id}
                  >
                    {c.dot && <span className="rdf-dot" style={{ background: c.dot }} />}
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="rdf-group" role="radiogroup" aria-label="Filter projects by market cap tier">
                <span className="rdf-label">Cap</span>
                {[
                  { id: 'all', label: 'All' },
                  { id: 'low', label: 'Low' },
                  { id: 'mid', label: 'Mid' },
                  { id: 'high', label: 'High' },
                ].map(c => (
                  <button
                    key={c.id}
                    className={`rdf-pill${capFilter === c.id ? ' is-active' : ''}`}
                    onClick={() => setCapFilter(c.id)}
                    role="radio"
                    aria-checked={capFilter === c.id}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="rdf-group" role="radiogroup" aria-label="Filter projects by category">
                <span className="rdf-label">Category</span>
                {categoryOptions.map(id => (
                  <button
                    key={id}
                    className={`rdf-pill${categoryFilter === id ? ' is-active' : ''}`}
                    onClick={() => setCategoryFilter(id)}
                    role="radio"
                    aria-checked={categoryFilter === id}
                  >
                    {id === 'all' ? 'All' : id}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="research-desk-content">
            <LazyErrorBoundary>
              <Suspense fallback={<div className="discover-section-skeleton" />}>
                {/* Projects mode */}
                {researchTab === 'pipeline' && (
                  noProjectsMatch
                    ? <ResearchDeskNoMatch onClear={clearProjectFilters} />
                    : <DealFlowPipeline activeSymbol={activeSymbol} livePrices={livePrices} projects={filteredProjects} />
                )}
                {researchTab === 'pitchdeck' && <TokenPitchDeck activeSymbol={activeSymbol} livePrices={livePrices} projects={deskProjects} aiPitches={deskContent.pitches} />}
                {researchTab === 'scorecard' && (
                  noProjectsMatch
                    ? <ResearchDeskNoMatch onClear={clearProjectFilters} />
                    : <InstitutionalScorecard activeSymbol={activeSymbol} livePrices={livePrices} projects={filteredProjects} />
                )}
                {researchTab === 'rotation' && <SectorRotationMap sectors={deskSectors} selectToken={selectToken} />}
                {researchTab === 'thesis' && <AlphaThesisCards activeSymbol={activeSymbol} projects={deskProjects} aiTheses={deskContent.theses} selectToken={selectToken} />}
                {/* Memes mode */}
                {researchTab === 'meme-pipeline' && <MemeFlowPipeline deals={deskMemes.dealFlow} activeSymbol={activeSymbol} selectToken={selectToken} />}
                {researchTab === 'meme-scorecard' && <DegenScorecard scorecards={deskMemes.scorecards} activeSymbol={activeSymbol} selectToken={selectToken} />}
                {researchTab === 'meme-trends' && <MemeTrendRadar trends={deskMemes.trends} activeSymbol={activeSymbol} selectToken={selectToken} />}
                {researchTab === 'meme-thesis' && <DegenThesis theses={deskMemes.theses} activeSymbol={activeSymbol} selectToken={selectToken} />}
              </Suspense>
            </LazyErrorBoundary>
          </div>
        </div>
      </section>

      {/* Compare Modal */}
      {showCompareModal && (
        <CompareModal
          compareTokens={compareTokens}
          onClose={closeCompareModal}
          onSelectToken={handleSelectFromCompare}
        />
      )}

      {/* 5. Footer */}
      <footer className="discover-footer scroll-reveal">
        <div className="df-top">
          <div className="df-brand">
            <span className="df-logo">Spectre AI</span>
            <p className="df-tagline">DeFi discovery for the institutional mind.</p>
          </div>
          <div className="df-links">
            <div className="df-link-col">
              <span className="df-link-heading">Product</span>
              <a
                href="#discover-table"
                className="df-link"
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById('discover-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >Discover</a>
              <a
                href="#token/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6"
                className="df-link"
                onClick={(e) => { e.preventDefault(); selectToken(SPECTRE_TOKEN, 'footer') }}
              >Terminal</a>
            </div>
            <div className="df-link-col">
              <span className="df-link-heading">Platform</span>
              <a href="https://app.spectreai.io" className="df-link">Research Platform</a>
              <a href="https://spectreai.io" target="_blank" rel="noopener noreferrer" className="df-link">Website</a>
            </div>
          </div>
        </div>

        <div className="df-divider" />

        <div className="df-bottom">
          <span className="df-copy">&copy; {new Date().getFullYear()} Spectre AI. All rights reserved.</span>
          <div className="df-socials">
            {/* X */}
            <a href="https://x.com/Spectre__AI" target="_blank" rel="noopener noreferrer" className="df-social" aria-label="X" title="X">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
            {/* Telegram */}
            <a href="https://telegram.me/AI_SPECTRE" target="_blank" rel="noopener noreferrer" className="df-social" aria-label="Telegram" title="Telegram">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            </a>
            {/* YouTube */}
            <a href="https://www.youtube.com/@ai-spectre" target="_blank" rel="noopener noreferrer" className="df-social" aria-label="YouTube" title="YouTube">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            </a>
            {/* LinkedIn */}
            <a href="https://www.linkedin.com/company/ai-spectre/" target="_blank" rel="noopener noreferrer" className="df-social" aria-label="LinkedIn" title="LinkedIn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            </a>
          </div>
        </div>
      </footer>

      {/* Floating compare bar */}
      {compareTokens.length > 0 && (
        <div className="discover-compare-bar">
          <div className="compare-bar-inner">
            <div className="compare-bar-tokens">
              {compareTokens.map((token) => (
                <div key={token.address} className="compare-bar-chip">
                  <span className="compare-bar-chip-symbol">{token.symbol}</span>
                  <button
                    className="compare-bar-chip-remove"
                    onClick={() => removeCompareToken(token.address)}
                    aria-label={`Remove ${token.symbol}`}
                  >
                    &times;
                  </button>
                </div>
              ))}
              <span className="compare-bar-hint">
                {compareTokens.length < 2
                  ? `Select ${2 - compareTokens.length} more to compare`
                  : compareTokens.length >= 4
                    ? 'Max slots reached'
                    : `${4 - compareTokens.length} slots left`}
              </span>
            </div>
            <div className="compare-bar-actions">
              <button
                className="compare-bar-btn compare-bar-btn--compare"
                disabled={compareTokens.length < 2}
                onClick={openCompareModal}
              >
                Compare ({compareTokens.length})
              </button>
              <button
                className="compare-bar-btn compare-bar-btn--cancel"
                onClick={exitCompareMode}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DiscoverPage
