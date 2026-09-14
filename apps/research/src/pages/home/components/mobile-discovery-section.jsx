/**
 * MobileDiscoverySection — Mobile wrapper for the Discovery section on Welcome page.
 *
 * This is a LIGHTWEIGHT chrome wrapper. The existing DiscoverySection component
 * (1700+ lines, 97 props) handles all data fetching and rendering. This wrapper
 * provides only:
 *   1. A section header ("Discover" + full-view expand button)
 *   2. A horizontally scrolling tab bar (Top Coins, On-Chain, Predictions, etc.)
 *   3. Category filter chips below the tab bar (Top Coins tab only)
 *   4. A container that renders {children} (the DiscoverySection)
 *
 * Hidden on desktop (>768px). Visible only on mobile viewports.
 */
import React, {
  memo,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { observeSelectedTab } from '@/lib/observe-selected-tab'
import { getWelcomeDiscoveryTabs, nextWelcomeTabIndex } from './welcome-discovery-tabs'
import { PREDICTIONS_CATEGORIES, AI_AGENT_CATEGORIES, AI_MODEL_CATEGORIES } from './welcome-page-constants'
import './mobile-discovery-section.css'

/* ── Inline SVG icons (avoids external dependencies) ── */

const SearchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const ExpandIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)

/* ── Tab definitions ── */

/* ── Component ── */

function MobileDiscoverySection({
  // Tab state
  topSectionTab,
  setTopSectionTab,
  setChartPanelToken,
  // Filter state
  categoryFilter,
  setCategoryFilter,
  CATEGORY_TABS,
  predictionsCategoryFilter,
  setPredictionsCategoryFilter,
  aiAgentCategoryFilter,
  setAiAgentCategoryFilter,
  aiModelCategoryFilter,
  setAiModelCategoryFilter,
  // Flags
  isStocks,
  isShowcaseEmbed = false,
  dayMode,
  // Full view
  onOpenFullView,
  // Translation
  t,
  // Children
  children,
}) {
  const tabBarRef = useRef(null)
  const tabRefs = useRef({})
  const chipBarRef = useRef(null)

  // ── Resolve tab list based on market mode ──

  const tabs = useMemo(
    () => getWelcomeDiscoveryTabs(isStocks, t, isShowcaseEmbed),
    [isStocks, t, isShowcaseEmbed]
  )

  // ── Tab click handler ──

  const handleTabClick = useCallback(
    (tabId) => {
      if (tabs.find(tab => tab.id === tabId)?.locked) return
      setChartPanelToken(null)
      setTopSectionTab(tabId)
    },
    [setChartPanelToken, setTopSectionTab, tabs]
  )

  // Reveal selection after resize without moving the page or stealing focus.
  useEffect(() => observeSelectedTab(tabBarRef.current), [topSectionTab])

  // ── Show category chips on topcoins and predictions tabs ──

  const showChips = topSectionTab === 'topcoins' && CATEGORY_TABS && CATEGORY_TABS.length > 0
  const showPredictionChips = topSectionTab === 'predictions'
  const showAgentChips = topSectionTab === 'aiagents'
  const showModelChips = topSectionTab === 'aimodels'

  // ── Keyboard navigation for tab bar ──

  const activeIndex = useMemo(() => {
    const idx = tabs.findIndex((tab) => tab.id === topSectionTab)
    return idx >= 0 ? idx : 0
  }, [tabs, topSectionTab])

  const handleKeyDown = useCallback(
    (e) => {
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
      const nextIndex = nextWelcomeTabIndex(tabs, activeIndex, e.key, rtl)
      if (nextIndex === null) return
      e.preventDefault()

      if (nextIndex !== activeIndex) {
        const tab = tabs[nextIndex]
        if (tab) {
          handleTabClick(tab.id)
          const el = tabRefs.current[tab.id]
          if (el) el.focus()
        }
      }
    },
    [activeIndex, tabs, handleTabClick]
  )

  // ── Section title ──

  const sectionTitle = t?.('discover.title') || 'Discover'

  return (
    <div className={`mds${dayMode ? ' mds--day' : ''}`}>
      {/* ── Tab bar with expand button on same line ── */}
      <div className="mds-bar-wrapper">
        <div className="mds-bar-row">
          <div
            className="mds-bar"
            ref={tabBarRef}
            role="tablist"
            aria-label={sectionTitle}
            onKeyDown={handleKeyDown}
          >
          {tabs.map((tab) => {
            const isActive = tab.id === topSectionTab
            return (
              <button
                key={tab.id}
                ref={(el) => { tabRefs.current[tab.id] = el }}
                type="button"
                className={`mds-tab${isActive ? ' active' : ''}`}
                role="tab"
                id={`mds-tab-${tab.id}`}
                aria-selected={isActive}
                aria-disabled={tab.locked || undefined}
                title={tab.locked ? 'Available in Beta - not in preview' : undefined}
                aria-controls={`mds-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => handleTabClick(tab.id)}
              >
                {tab.label}
              </button>
            )
          })}
          </div>
          {onOpenFullView && (
            <button
              type="button"
              className="mds-header-expand"
              onClick={onOpenFullView}
              aria-label={t?.('discovery.fullView') || 'Full View'}
            >
              <ExpandIcon />
            </button>
          )}
        </div>
      </div>

      {/* ── Category filter chips (Top Coins tab) ── */}
      {showChips && (
        <div className="mds-chips-wrapper" ref={chipBarRef}>
          <div className="mds-chips">
            {CATEGORY_TABS.map((cat) => {
              const isActive = categoryFilter === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`mds-chip${isActive ? ' active' : ''}`}
                  onClick={() => setCategoryFilter(cat.id)}
                  aria-pressed={isActive}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Category filter chips (Predictions tab) ── */}
      {showPredictionChips && (
        <div className="mds-chips-wrapper">
          <div className="mds-chips">
            {PREDICTIONS_CATEGORIES.map((cat) => {
              const isActive = predictionsCategoryFilter === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`mds-chip${isActive ? ' active' : ''}`}
                  onClick={() => setPredictionsCategoryFilter(cat.id)}
                  aria-pressed={isActive}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Category filter chips (AI Agents tab) ── */}
      {showAgentChips && (
        <div className="mds-chips-wrapper">
          <div className="mds-chips">
            {AI_AGENT_CATEGORIES.map((cat) => {
              const isActive = aiAgentCategoryFilter === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`mds-chip${isActive ? ' active' : ''}`}
                  onClick={() => setAiAgentCategoryFilter(cat.id)}
                  aria-pressed={isActive}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Category filter chips (AI Models tab) ── */}
      {showModelChips && (
        <div className="mds-chips-wrapper">
          <div className="mds-chips">
            {AI_MODEL_CATEGORIES.map((cat) => {
              const isActive = aiModelCategoryFilter === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`mds-chip${isActive ? ' active' : ''}`}
                  onClick={() => setAiModelCategoryFilter(cat.id)}
                  aria-pressed={isActive}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Content: existing DiscoverySection rendered by parent ── */}
      <div
        className="mds-content"
        role="tabpanel"
        id={`mds-panel-${topSectionTab}`}
        aria-labelledby={`mds-tab-${topSectionTab}`}
      >
        {children}
      </div>
    </div>
  )
}

export default memo(MobileDiscoverySection, (prev, next) => {
  return (
    prev.topSectionTab === next.topSectionTab &&
    prev.categoryFilter === next.categoryFilter &&
    prev.isStocks === next.isStocks &&
    prev.isShowcaseEmbed === next.isShowcaseEmbed &&
    prev.t === next.t &&
    prev.dayMode === next.dayMode &&
    prev.children === next.children &&
    prev.CATEGORY_TABS === next.CATEGORY_TABS
  )
})
