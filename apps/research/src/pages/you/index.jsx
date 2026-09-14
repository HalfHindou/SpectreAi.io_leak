/**
 * Spectre YOU — Personalized Modular Dashboard
 * Route: /you
 *
 * A living, personal space. Softer than Trader's Corner:
 * wider gaps (14px), bigger radius (24px), editorial feel.
 *
 * Two tabs:
 *   1. Dashboard — widget grid (36 widgets, react-grid-layout)
 *   2. Studio — blank creative canvas for styled functions
 *
 * Uses react-grid-layout v2 API (hooks-based).
 */
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import YouHeader from './components/YouHeader'
import IntelligenceBanner from './components/IntelligenceBanner'
import YouWidgetCard from './components/YouWidgetCard'
import YouEmptyState from './components/YouEmptyState'
// Modal-only — only mount when opened. Same for StudioCanvas (only on
// studio tab) and ShareXModal (only on share). All four were eagerly
// imported and pulled into every /you visit.
const YouTemplates = lazy(() => import('./components/YouTemplates'))
const YouComposer = lazy(() => import('./components/YouComposer'))
import YouDashboardSwitcher from './components/YouDashboardSwitcher'
import YOU_REGISTRY, { getYouCategories } from './you-widget-registry'
import { getWidget as getRegistryEntry } from '@/registry'
import { useYouTracking } from '@/hooks/useYouTracking'
import useYouLayout from './use-you-layout'
import useStudioStore from './studio/use-studio-store'
const StudioCanvas = lazy(() => import('./studio/StudioCanvas'))
const ShareXModal = lazy(() => import('../../components/share-x-modal'))
import { renderShareCard, getSpectreLogo, getSharePalette } from '../../lib/shareToX'
import './SpectreYou.css'

// Layout-shaped skeleton matching a widget card's typical body so there's no
// jump when the lazy chunk resolves. Renders inside the same grid cell.
function YouWidgetSkeleton({ height = 150 }) {
  return (
    <div className="you-card you-card--skeleton" style={{ minHeight: height }}>
      <div className="you-card--skeleton-header">
        <div className="you-shimmer you-card--skeleton-title" />
        <div className="you-shimmer you-card--skeleton-pill" />
      </div>
      <div className="you-card--skeleton-body">
        <div className="you-shimmer you-card--skeleton-row" />
        <div className="you-shimmer you-card--skeleton-row you-card--skeleton-row--short" />
        <div className="you-shimmer you-card--skeleton-row" />
      </div>
    </div>
  )
}

function YouStudioSkeleton() {
  return (
    <div className="you-studio-skeleton">
      <div className="you-shimmer you-studio-skeleton-canvas" />
    </div>
  )
}

export default function SpectreYouPage() {
  const [activeTab, setActiveTab] = useState('dashboard') // 'dashboard' | 'studio'
  const [addPanelOpen, setAddPanelOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareImageUrl, setShareImageUrl] = useState(null)
  const [shareDescription, setShareDescription] = useState('')
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)

  const { track, EVENT_TYPES } = useYouTracking()
  const previousLayoutRef = useRef([])
  // Mirror the latest layout in a ref so the dashboard-opened effect can
  // snapshot it without subscribing to layout changes (which would re-fire
  // DASHBOARD_OPENED on every grid edit).
  const layoutRef = useRef([])

  // Composer preview state — held ephemerally at the page level so the
  // grid renders the agent's pending dashboard live without writing to
  // localStorage. Only the Apply button commits the preview.
  const [previewLayout, setPreviewLayout] = useState(null)
  const [previewWidgets, setPreviewWidgets] = useState(null)

  // Studio personalization
  const studio = useStudioStore()

  // v2 hook: returns { width, mounted, containerRef }
  const { width, mounted, containerRef } = useContainerWidth({ initialWidth: 1200 })

  const {
    layout,
    activeWidgets,
    onLayoutChange: onLayoutChangeRaw,
    addWidget,
    removeWidget,
    replaceLayout,
    resetLayout,
    currentDashboardId,
    dashboards,
    createDashboard,
    switchDashboard,
    renameDashboard,
    deleteDashboard,
  } = useYouLayout()
  const dashboardId = currentDashboardId

  // Keep layoutRef current so the effect below can snapshot it on demand.
  useEffect(() => { layoutRef.current = layout }, [layout])

  // Fire DASHBOARD_OPENED on mount and any time the user switches dashboards.
  // Discard composer preview when dashboard changes — a preview built for
  // dashboard A should not bleed into dashboard B. track + EVENT_TYPES are
  // module-stable; layout is snapshotted via ref to avoid re-firing on edits.
  useEffect(() => {
    track(EVENT_TYPES.DASHBOARD_OPENED, { dashboard_id: dashboardId })
    previousLayoutRef.current = layoutRef.current
    setPreviewLayout(null)
    setPreviewWidgets(null)
  }, [dashboardId, track, EVENT_TYPES])

  const handleAddWidget = useCallback((widgetId) => {
    const meta = YOU_REGISTRY[widgetId]
    if (!meta) return
    const maxY = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0)
    // Prefer registry default_size when available so newly added widgets
    // size correctly against the 80px row grid. Falls back to legacy 4×4.
    const reg = getRegistryEntry(widgetId)
    const w = reg?.default_size?.w ?? 4
    const h = reg?.default_size?.h ?? 4
    const minW = reg?.min_size?.w ?? 2
    const minH = reg?.min_size?.h ?? 2
    const gridItem = { i: widgetId, x: 0, y: maxY, w, h, minW, minH }
    addWidget(widgetId, gridItem)
    setAddPanelOpen(false)
    track(EVENT_TYPES.WIDGET_ADDED, {
      widget_id: widgetId,
      dashboard_id: dashboardId,
      payload: { source: 'manual' },
    })
  }, [layout, addWidget, track, EVENT_TYPES, dashboardId])

  const handleRemoveWidget = useCallback((widgetId) => {
    removeWidget(widgetId)
    track(EVENT_TYPES.WIDGET_REMOVED, {
      widget_id: widgetId,
      dashboard_id: dashboardId,
    })
  }, [removeWidget, track, EVENT_TYPES, dashboardId])

  // Wrap onLayoutChange to derive WIDGET_MOVED / WIDGET_RESIZED from a
  // shallow diff against the previous layout. Skip the first call (mount).
  const onLayoutChange = useCallback((newLayout) => {
    const prev = previousLayoutRef.current
    if (Array.isArray(prev) && prev.length > 0) {
      const prevMap = new Map(prev.map(it => [it.i, it]))
      for (const item of newLayout) {
        const before = prevMap.get(item.i)
        if (!before) continue
        const moved = before.x !== item.x || before.y !== item.y
        const resized = before.w !== item.w || before.h !== item.h
        if (resized) {
          track(EVENT_TYPES.WIDGET_RESIZED, {
            widget_id: item.i,
            dashboard_id: dashboardId,
            payload: { w: item.w, h: item.h, prev_w: before.w, prev_h: before.h },
          })
        }
        if (moved && !resized) {
          track(EVENT_TYPES.WIDGET_MOVED, {
            widget_id: item.i,
            dashboard_id: dashboardId,
            payload: { x: item.x, y: item.y, prev_x: before.x, prev_y: before.y },
          })
        }
      }
    }
    previousLayoutRef.current = newLayout
    onLayoutChangeRaw(newLayout)
  }, [onLayoutChangeRaw, track, EVENT_TYPES, dashboardId])

  // Composer / template picker triggers — Step 4 wires the picker, Step 5
  // wires the composer. For now both open lightweight stubs that allow the
  // empty-state CTAs to be wired without breaking the build.
  const handleComposerOpen = useCallback(() => {
    setComposerOpen(true)
    track(EVENT_TYPES.COMPOSER_OPENED, { dashboard_id: dashboardId })
  }, [track, EVENT_TYPES, dashboardId])

  const handleTemplatePickerOpen = useCallback(() => {
    setTemplatePickerOpen(true)
  }, [])

  // Apply a template — replace the dashboard layout in one shot. The
  // template picker handles user confirmation when the dashboard already
  // has widgets, and fires TEMPLATE_APPLIED itself.
  const handleApplyTemplate = useCallback((template) => {
    if (!template || !Array.isArray(template.layout)) return
    const newLayout = template.layout.map(it => {
      const reg = getRegistryEntry(it.widget_id)
      return {
        i: it.widget_id,
        x: it.x,
        y: it.y,
        w: it.w,
        h: it.h,
        minW: reg?.min_size?.w ?? 2,
        minH: reg?.min_size?.h ?? 2,
        ...(reg?.max_size ? { maxW: reg.max_size.w, maxH: reg.max_size.h } : {}),
      }
    })
    const newIds = newLayout.map(it => it.i)
    // Reset previous-layout snapshot so the diff in onLayoutChange does
    // not interpret the wholesale replacement as drag/resize events.
    previousLayoutRef.current = newLayout
    replaceLayout(newLayout, newIds)
  }, [replaceLayout])

  // Translate a composer dashboard JSON into react-grid-layout items.
  const composerDashboardToLayout = useCallback((dashboard) => {
    if (!dashboard || !Array.isArray(dashboard.widgets)) return null
    const newLayout = dashboard.widgets.map(it => {
      const reg = getRegistryEntry(it.widget_id)
      return {
        i: it.widget_id,
        x: it.x,
        y: it.y,
        w: it.w,
        h: it.h,
        minW: reg?.min_size?.w ?? 2,
        minH: reg?.min_size?.h ?? 2,
        ...(reg?.max_size ? { maxW: reg.max_size.w, maxH: reg.max_size.h } : {}),
      }
    })
    return { layout: newLayout, ids: newLayout.map(it => it.i) }
  }, [])

  // Apply a composer-built dashboard — COMMITS to localStorage via replaceLayout.
  const handleApplyComposerDashboard = useCallback((dashboard) => {
    const built = composerDashboardToLayout(dashboard)
    if (!built) return
    previousLayoutRef.current = built.layout
    replaceLayout(built.layout, built.ids)
    // Clear preview so the committed state takes over.
    setPreviewLayout(null)
    setPreviewWidgets(null)
  }, [composerDashboardToLayout, replaceLayout])

  // Apply a composer-built dashboard as a brand-new named dashboard.
  // Creates the dashboard, switches to it, then commits the layout.
  // The hook's switchDashboard fires DASHBOARD_OPENED via the useEffect
  // dependency on currentDashboardId, so attribution is correct.
  const handleApplyComposerAsNewDashboard = useCallback((dashboard, name) => {
    const built = composerDashboardToLayout(dashboard)
    if (!built) return
    const newId = createDashboard(name || 'New Dashboard')
    if (!newId) return
    // The new dashboard starts empty; commit the composer build into it.
    // Because createDashboard sets it as current, replaceLayout writes there.
    previousLayoutRef.current = built.layout
    replaceLayout(built.layout, built.ids)
    setPreviewLayout(null)
    setPreviewWidgets(null)
  }, [composerDashboardToLayout, createDashboard, replaceLayout])

  // Live-preview a composer dashboard. Ephemeral — held in component state
  // only, never persisted. The grid renders preview if present, otherwise
  // the saved layout. Closing the composer without Apply discards.
  const handlePreviewComposerDashboard = useCallback((dashboard) => {
    const built = composerDashboardToLayout(dashboard)
    if (!built) return
    setPreviewLayout(built.layout)
    setPreviewWidgets(built.ids)
  }, [composerDashboardToLayout])

  // Discard preview when composer closes without applying.
  const handleComposerClose = useCallback(() => {
    setComposerOpen(false)
    setPreviewLayout(null)
    setPreviewWidgets(null)
  }, [])

  // Share dashboard — generates branded canvas card
  const handleShareDashboard = useCallback(async () => {
    setShareModalOpen(true)
    setShareImageUrl(null)

    try {
      const logo = await getSpectreLogo()

      const byCategory = {}
      activeWidgets.forEach(id => {
        const meta = YOU_REGISTRY[id]
        if (!meta) return
        if (!byCategory[meta.category]) byCategory[meta.category] = []
        byCategory[meta.category].push(meta.name)
      })

      const dataUrl = renderShareCard(
        (ctx, w, contentTop, c, fonts) => {
          let y = contentTop + 12

          ctx.fillStyle = c.white
          ctx.font = `700 22px ${fonts.body}`
          ctx.textAlign = 'left'
          ctx.fillText('My Dashboard', 36, y)
          y += 12

          ctx.fillStyle = c.muted
          ctx.font = `500 12px ${fonts.mono}`
          ctx.fillText(`${activeWidgets.length} widgets active`, 36, y + 16)
          y += 36

          ctx.fillStyle = c.accentHigh
          ctx.fillRect(36, y, w - 72, 1)
          y += 18

          const categories = Object.entries(byCategory)
          categories.forEach(([cat, names]) => {
            ctx.fillStyle = c.muted
            ctx.font = `600 9px ${fonts.mono}`
            ctx.textAlign = 'left'
            ctx.fillText(cat.toUpperCase(), 36, y + 2)
            y += 14

            let px = 36
            names.forEach(name => {
              ctx.font = `500 10px ${fonts.body}`
              const tw = ctx.measureText(name).width + 16
              if (px + tw > w - 36) { px = 36; y += 22 }

              ctx.fillStyle = c.cardBg
              ctx.beginPath()
              ctx.roundRect(px, y - 8, tw, 20, 10)
              ctx.fill()
              ctx.strokeStyle = c.cardBorder
              ctx.lineWidth = 1
              ctx.stroke()

              ctx.fillStyle = c.name
              ctx.textAlign = 'left'
              ctx.fillText(name, px + 8, y + 5)
              px += tw + 6
            })
            y += 28
          })

          return y - contentTop + 10
        },
        { title: 'Spectre YOU', logo }
      )

      setShareImageUrl(dataUrl)
      setShareDescription(`My Spectre YOU dashboard \u2014 ${activeWidgets.length} widgets configured.\n\nvia @Spectre__Ai\nhttps://spectreai.io`)
    } catch (err) {
      // silently handled
    }
  }, [activeWidgets])

  // The grid renders the preview if the composer pushed one; otherwise
  // the saved layout. Preview never touches localStorage.
  const effectiveLayout = previewLayout ?? layout
  const effectiveActiveWidgets = previewWidgets ?? activeWidgets
  const filteredLayout = effectiveLayout.filter(item => effectiveActiveWidgets.includes(item.i))

  return (
    <div className="you-page">
      <YouHeader onShareClick={handleShareDashboard} activeTab={activeTab} />

      <IntelligenceBanner />

      {/* Tab Bar — Dashboard / Studio */}
      <YouTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        widgetCount={filteredLayout.length}
        totalWidgets={Object.keys(YOU_REGISTRY).length}
        onAddWidget={() => setAddPanelOpen(true)}
        onComposerOpen={handleComposerOpen}
        onTemplatesOpen={handleTemplatePickerOpen}
        onResetLayout={resetLayout}
        studioElementCount={studio.config.elements.length}
        switcherSlot={(
          <YouDashboardSwitcher
            dashboards={dashboards}
            currentId={currentDashboardId}
            onSwitch={switchDashboard}
            onCreate={createDashboard}
            onRename={renameDashboard}
            onDelete={deleteDashboard}
          />
        )}
      />

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div className="you-grid-area" ref={containerRef}>
          {filteredLayout.length === 0 ? (
            <YouEmptyState
              onComposerOpen={handleComposerOpen}
              onTemplatePickerOpen={handleTemplatePickerOpen}
            />
          ) : (
            mounted && width > 0 && (
              <ResponsiveGridLayout
                className="you-grid"
                width={width}
                layouts={{ lg: filteredLayout }}
                breakpoints={{ lg: 1280, md: 768, sm: 480, xs: 0 }}
                cols={{ lg: 12, md: 8, sm: 6, xs: 4 }}
                rowHeight={80}
                margin={[8, 8]}
                containerPadding={[0, 0]}
                onLayoutChange={onLayoutChange}
                dragConfig={{ handle: '.you-drag-handle' }}
                compactor={verticalCompactor}
              >
                {filteredLayout.map((item, idx) => {
                  const meta = YOU_REGISTRY[item.i]
                  if (!meta) return null
                  const reg = getRegistryEntry(item.i)
                  return (
                    <div key={item.i} style={{ '--stagger-i': idx }}>
                      <Suspense fallback={<YouWidgetSkeleton />}>
                        <YouWidgetCard
                          id={item.i}
                          meta={meta}
                          registryEntry={reg}
                          dashboardId={dashboardId}
                          onRemove={handleRemoveWidget}
                        />
                      </Suspense>
                    </div>
                  )
                })}
              </ResponsiveGridLayout>
            )
          )}
        </div>
      )}

      {/* Studio Tab — Blank Canvas */}
      {activeTab === 'studio' && (
        <Suspense fallback={<YouStudioSkeleton />}>
          <StudioCanvas studio={studio} />
        </Suspense>
      )}

      {/* Add Widget Panel — overlay (Dashboard only) */}
      {addPanelOpen && (
        <AddWidgetPanelYou
          activeWidgets={activeWidgets}
          onAdd={handleAddWidget}
          onClose={() => setAddPanelOpen(false)}
        />
      )}

      {/* Share Modal — only mount when actually opening */}
      {shareModalOpen && (
        <Suspense fallback={null}>
          <ShareXModal
            open={shareModalOpen}
            onClose={() => { setShareModalOpen(false); setShareImageUrl(null) }}
            imageUrl={shareImageUrl}
            defaultDescription={shareDescription}
            filename={`spectre_you_dashboard_${new Date().toISOString().slice(0, 10)}.png`}
          />
        </Suspense>
      )}

      {/* Template picker (Step 4) */}
      {templatePickerOpen && (
        <Suspense fallback={null}>
          <YouTemplates
            open={templatePickerOpen}
            onClose={() => setTemplatePickerOpen(false)}
            onApply={handleApplyTemplate}
            hasExistingLayout={activeWidgets.length > 0}
            dashboardId={dashboardId}
          />
        </Suspense>
      )}

      {/* Composer (Step 5) — agent-driven dashboard builder */}
      {composerOpen && (
        <Suspense fallback={null}>
          <YouComposer
            open={composerOpen}
            onClose={handleComposerClose}
            onPreviewDashboard={handlePreviewComposerDashboard}
            onApplyDashboard={handleApplyComposerDashboard}
            onApplyAsNewDashboard={handleApplyComposerAsNewDashboard}
            hasExistingLayout={activeWidgets.length > 0}
            dashboardId={dashboardId}
          />
        </Suspense>
      )}
    </div>
  )
}


/**
 * YouTabBar — Combines tab switching (Dashboard / Studio) with toolbar controls.
 * Studio tab replaces the old side panel approach.
 */
function YouTabBar({
  activeTab,
  onTabChange,
  widgetCount,
  totalWidgets,
  onAddWidget,
  onComposerOpen,
  onTemplatesOpen,
  onResetLayout,
  studioElementCount,
  switcherSlot,
}) {
  const { t } = useTranslation()
  return (
    <div className="you-toolbar">
      {/* Tab pills */}
      <div className="you-tab-pills">
        <button
          className={`you-tab-pill${activeTab === 'dashboard' ? ' active' : ''}`}
          onClick={() => onTabChange('dashboard')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          <span>{t('you.dashboard', 'Dashboard')}</span>
        </button>
        <button
          className={`you-tab-pill you-tab-pill-studio${activeTab === 'studio' ? ' active' : ''}`}
          onClick={() => onTabChange('studio')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <path d="M2 2l7.586 7.586" />
            <circle cx="11" cy="11" r="2" />
          </svg>
          <span>{t('you.studio', 'Studio')}</span>
          {studioElementCount > 0 && (
            <span className="you-tab-badge">{studioElementCount}</span>
          )}
        </button>
      </div>

      {activeTab === 'dashboard' && switcherSlot}

      <div className="you-toolbar-spacer" />

      {/* Dashboard-specific controls */}
      {activeTab === 'dashboard' && (
        <>
          <span className="you-widget-count">
            {t('you.widgetCount', '{{count}} / {{total}} widgets', { count: widgetCount, total: totalWidgets })}
          </span>

          <button className="you-toolbar-btn" onClick={onComposerOpen} title={t('you.buildWithAgent', 'Build with your agent')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>{t('you.build', 'Build')}</span>
          </button>

          <button className="you-toolbar-btn" onClick={onAddWidget}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{t('you.addWidget', 'Add Widget')}</span>
          </button>

          <button className="you-toolbar-btn" onClick={onTemplatesOpen} title={t('you.browseTemplates', 'Browse templates')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="12" width="7" height="9" rx="1.5" />
              <rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
            <span>{t('you.templates', 'Templates')}</span>
          </button>

          <button className="you-toolbar-btn" onClick={onResetLayout}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            <span>{t('you.reset', 'Reset')}</span>
          </button>
        </>
      )}
    </div>
  )
}


/**
 * Inline Add Widget Panel for YOU.
 * Simple overlay with available widgets from YOU registry.
 */
function AddWidgetPanelYou({ activeWidgets, onAdd, onClose }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('All')

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const categories = getYouCategories()

  const widgets = Object.values(YOU_REGISTRY).filter(w => {
    if (filter !== 'All' && w.category !== filter) return false
    return true
  })

  return createPortal(
    <div className="you-add-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tc-add-panel">
        <div className="tc-add-header">
          <span className="tc-add-title">{t('you.addWidget', 'Add Widget')}</span>
          <button className="tc-add-close" onClick={onClose}>&times;</button>
        </div>

        <div className="tc-add-filters">
          {categories.map(cat => (
            <button
              key={cat}
              className={`tc-add-filter${filter === cat ? ' active' : ''}`}
              onClick={() => setFilter(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="tc-add-grid">
          {widgets.length === 0 && (
            <div className="tc-add-empty">No widgets available for this category.</div>
          )}
          {widgets.map(w => {
            const isActive = activeWidgets.includes(w.id)
            return (
              <div
                key={w.id}
                className={`tc-add-item${isActive ? ' disabled' : ''}`}
                onClick={() => !isActive && onAdd(w.id)}
              >
                <div className="tc-add-item-name">{w.name}</div>
                {w.description && (
                  <div className="tc-add-item-desc">{w.description}</div>
                )}
                <div className="tc-add-item-meta">
                  {w.category}
                  {isActive && ' \u00B7 Already added'}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}


