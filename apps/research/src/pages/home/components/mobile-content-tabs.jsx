/**
 * MobileContentTabs - Swipeable tab system for the mobile Command Center section.
 *
 * Renders a horizontally scrolling tab bar with an animated active indicator,
 * wraps children in a swipe-to-navigate container via useSwipeNavigation,
 * and provides full keyboard + ARIA accessibility.
 *
 * The parent controls which content is mounted via children — this component
 * provides the tab bar chrome and swipe container only.
 */
import React, {
  memo,
  useRef,
  useCallback,
  useEffect,
} from 'react'
import { observeSelectedTab } from '@/lib/observe-selected-tab'
import './mobile-content-tabs.css'

/* ── Expand icon (inline SVG, avoids external dep) ── */
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

/* ── AI sparkle icon for section header ── */
const CommandCenterIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 8.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
  </svg>
)

/* ── Chevron right icon for "View full page" CTA ── */
const ChevronRight = () => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 5l7 7-7 7" />
  </svg>
)

/* ── Panel-body disclosure chevron (sits in the tab row) ── */
const PanelChevron = () => (
  <svg
    viewBox="0 0 24 24"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
)

/* ── Pin icon (inline SVG) ── */
const PinIcon = ({ filled }) => (
  <svg
    viewBox="0 0 24 24"
    width="13"
    height="13"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 17l-6.5 4 2-7.5L2 9h7z" />
  </svg>
)

function MobileContentTabs({
  activeTab,
  onTabChange,
  children,
  tabs,
  dayMode,
  t,
  onExpandFullView,
  onPageChange,
  pinnedTab,
  onPinTab,
  // Panel-body collapse. The section rail above folds the WHOLE section; this
  // folds only the tab panel, so the tab row stays on screen. Controlled by the
  // parent (persisted in the same welcomeSectionsCollapsed map) — uncontrolled
  // callers get today's always-open behaviour.
  panelOpen = true,
  onTogglePanel,
}) {
  const tabBarRef = useRef(null)
  const tabRefs = useRef({})

  // Tab index for keyboard navigation
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab)
  const activePageId = tabs[activeIndex]?.pageId

  // CC swipe DISABLED — tap-only navigation via the tab bar.
  // Horizontal swipe on the content area conflicts with the AI Brief's
  // own slide swipe (MACRO → NARRATIVE → ALERTS etc.) — the CC swipe
  // translates .mct-content-inner which moves dots, stats, and header
  // together with the text. Disabling CC swipe eliminates the conflict.

  // Reveal selection after resize without moving the page or stealing focus.
  useEffect(() => observeSelectedTab(tabBarRef.current), [activeTab])

  // ── Keyboard navigation (left/right arrows between tabs) ──

  const handleKeyDown = useCallback(
    (e) => {
      let nextIndex = activeIndex
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'

      if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) {
        e.preventDefault()
        nextIndex = Math.min(activeIndex + 1, tabs.length - 1)
      } else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) {
        e.preventDefault()
        nextIndex = Math.max(activeIndex - 1, 0)
      } else if (e.key === 'Home') {
        e.preventDefault()
        nextIndex = 0
      } else if (e.key === 'End') {
        e.preventDefault()
        nextIndex = tabs.length - 1
      } else {
        return
      }

      if (nextIndex !== activeIndex) {
        const tab = tabs[nextIndex]
        if (tab) {
          onTabChange(tab.id)
          // Same contract as a tap — see the tab's onClick.
          if (!!onTogglePanel && !panelOpen) onTogglePanel()
          // Focus the newly active tab button
          const el = tabRefs.current[tab.id]
          if (el) el.focus()
        }
      }
    },
    [activeIndex, tabs, onTabChange, onTogglePanel, panelOpen]
  )

  const sectionTitle = t?.('commandCenter.title') || 'Command Center'

  const panelCollapsed = !!onTogglePanel && !panelOpen

  return (
    <div className={`mct${dayMode ? ' mct--day' : ''}${panelCollapsed ? ' mct--panel-closed' : ''}`}>
      {/* ── Section header ── */}
      <div className="mct-header">
        <div className="mct-header-left">
          <span className="mct-header-icon"><CommandCenterIcon /></span>
          <span className="mct-header-title">{sectionTitle}</span>
        </div>
        {onPinTab && (
          <button
            type="button"
            className={`mct-header-pin${pinnedTab === activeTab ? ' mct-header-pin--active' : ''}`}
            onClick={() => onPinTab(pinnedTab === activeTab ? null : activeTab)}
            aria-label={pinnedTab === activeTab ? (t?.('mobileContent.unpinTab', 'Unpin tab') || 'Unpin tab') : (t?.('mobileContent.pinAsDefault', 'Pin as default tab') || 'Pin as default tab')}
          >
            <PinIcon filled={pinnedTab === activeTab} />
          </button>
        )}
        {onExpandFullView && (
          <button
            type="button"
            className="mct-header-expand"
            onClick={onExpandFullView}
            aria-label={t?.('mobileContent.fullView', 'Full View') || 'Full View'}
          >
            <ExpandIcon />
          </button>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className="mct-bar-wrapper">
        <div
          className="mct-bar"
          ref={tabBarRef}
          role="tablist"
          aria-label={sectionTitle}
          onKeyDown={handleKeyDown}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab
            const locked = !!tab.locked
            return (
              <button
                key={tab.id}
                ref={(el) => { tabRefs.current[tab.id] = el }}
                type="button"
                className={`mct-tab${isActive ? ' active' : ''}${locked ? ' mct-tab--locked' : ''}`}
                role="tab"
                id={`mct-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`mct-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                aria-disabled={locked || undefined}
                title={locked ? 'Available in Beta' : undefined}
                onClick={() => {
                  if (locked) {
                    if (typeof window !== 'undefined') {
                      try {
                        window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
                          detail: { source: 'mobile-cc-tab', tab: tab.id },
                        }))
                      } catch { /* noop */ }
                    }
                    return
                  }
                  onTabChange(tab.id)
                  // Picking a tab means "show me this". The panel has its OWN
                  // collapse (the chevron at the end of the bar) and that state
                  // is persisted, so once it was closed — easily done by
                  // accident, it is a 22px target sitting right after the last
                  // visible tab — every tab tap only moved an invisible
                  // selection and the Command Center read as dead: "the tabs
                  // dont work, nothing there". Opening on pick keeps the
                  // chevron as the deliberate way to fold it away.
                  if (panelCollapsed) onTogglePanel()
                }}
              >
                {tab.icon && (
                  <span className="mct-tab-icon" aria-hidden="true">
                    {tab.icon}
                  </span>
                )}
                <span className="mct-tab-label">{tab.label}</span>
                {locked && (
                  <span className="mct-tab-lock" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                    </svg>
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {onTogglePanel && (
          <button
            type="button"
            className={`mct-panel-toggle${panelOpen ? ' mct-panel-toggle--open' : ''}`}
            onClick={onTogglePanel}
            aria-expanded={panelOpen}
            aria-controls={`mct-panel-${activeTab}`}
            aria-label={panelOpen
              ? (t?.('mobileContent.collapsePanel', 'Collapse panel') || 'Collapse panel')
              : (t?.('mobileContent.expandPanel', 'Expand panel') || 'Expand panel')}
          >
            <PanelChevron />
          </button>
        )}
      </div>

      {/* ── Content area (tap-only tab switching, no swipe) ── */}
      <div
        className="mct-content"
        role="tabpanel"
        id={`mct-panel-${activeTab}`}
        aria-labelledby={`mct-tab-${activeTab}`}
      >
        <div className="mct-content-inner">
          {activePageId && onPageChange && (
            <button
              type="button"
              className="mct-full-page-cta"
              onClick={() => onPageChange(activePageId)}
            >
              <span>{t?.('mobileContent.viewFullPage', 'View full page') || 'View full page'}</span>
              <ChevronRight />
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

export default memo(MobileContentTabs)
