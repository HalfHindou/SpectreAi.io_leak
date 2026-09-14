/**
 * chart-ta-surface — one drop-in TA layer for every chart surface.
 *
 * The Research Zone grew this feature first (hook + toolbar buttons + pattern
 * strip + draw menu + agent). Wiring the same six things by hand into every
 * other chart surface would have been copies waiting to drift, so it lives
 * here once:
 *
 *   const ta = useChartTaSurface({ symbol, chartRef, price })
 *   <TradingChart ref={chartRef} extraToolButtons={ta.toolButtons} {...ta.chartProps} />
 *   <ChartTaSurface ta={ta} />
 *
 * The Research Zone keeps its own wiring because its agent already lives in a
 * sidebar tab — it needs the hook, not the drawer.
 *
 * Consumer: Traders Corner (chartMode === 'spectre'). The home chart panel and
 * the heatmaps floating window are deliberately NOT consumers — both hide
 * `.chart-controls` in their own CSS, so the toolbar this surface depends on
 * can never be reached there. They carried the wiring anyway until 2026-08-23;
 * if you add a surface, check its toolbar is actually visible first.
 */
import React, { Suspense, useCallback, useMemo, useRef, useState } from 'react'
import lazy from '@/lib/lazy-with-retry'
import useRzChartTa from '@/pages/research-zone/components/use-rz-chart-ta'
import { useChartTaEnabled } from '@/lib/chart-ta-enabled'
import { RzTaStrip, RzTaToolMenu } from '@/pages/research-zone/components/rz-chart-ta'
import './chart-ta-surface.css'

// The agent is only ever needed once a read is asked for, so it stays off the
// chunk until then.
const AgentChat = lazy(() => import('@/pages/research-zone/components/rz-agent-chat'))

const Icon = ({ d, children }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children || <path d={d} />}
  </svg>
)

export function useChartTaSurface({ symbol, chartRef, price = null, tokenName = null, tokenData = null, dayMode = false }) {
  const drawBtnRef = useRef(null)
  const [drawMenu, setDrawMenu] = useState(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const [taRequest, setTaRequest] = useState(null)

  const onAskAgent = useCallback((prompt, brief) => {
    setTaRequest({
      id: Date.now().toString(36),
      prompt,
      display: `Read the highlighted window — ${brief.stats.tfLabel}, ${brief.stats.bars} bars, ${brief.stats.durationLabel}`,
    })
    setAgentOpen(true)
  }, [])

  const ta = useRzChartTa({ symbol, chartRef, price, onAskAgent })

  // Desktop-only for now — see lib/chart-ta-enabled.js. Gated HERE rather than
  // in each consumer so Traders Corner, the home chart panel and the heatmaps
  // window inherit the decision without four copies of the same condition.
  const enabled = useChartTaEnabled()

  const toolButtons = useMemo(() => (!enabled ? [] : [
    {
      key: 'ta-analyze',
      label: 'AI TA',
      title: 'Read the whole visible chart and open the agent',
      onClick: ta.analyzeVisible,
      icon: <Icon d="M10 2.5l1.6 3.6 3.9.4-2.9 2.6.8 3.8L10 11l-3.4 1.9.8-3.8-2.9-2.6 3.9-.4z" />,
    },
    {
      key: 'ta-highlight',
      label: 'Highlight',
      title: ta.taMode === 'select'
        ? 'Drag a box over the chart to analyse that window'
        : 'Highlight a window and ask the agent',
      active: ta.taMode === 'select',
      onClick: () => ta.setTool('select'),
      icon: <Icon d="M3 6.5V4h2.5M14.5 4H17v2.5M17 13.5V16h-2.5M5.5 16H3v-2.5" />,
    },
    // Only rendered when there is something to clear — a permanently dead
    // button is worse than none.
    ...(ta.hasDrawings || ta.analysis ? [{
      key: 'ta-clear',
      label: 'Clear',
      title: 'Clear the TA lines and the read',
      onClick: () => ta.clearDrawings('all'),
      icon: (
        <Icon>
          <path d="M3.5 6.5h13" /><path d="M8 6.5V4h4v2.5" /><path d="M5.5 6.5l.9 9.5h7.2l.9-9.5" />
        </Icon>
      ),
    }] : []),
    {
      key: 'ta-draw',
      label: 'Draw',
      title: 'Draw trend lines and levels',
      active: ta.taMode.startsWith('draw:') || !!drawMenu,
      btnRef: drawBtnRef,
      onClick: () => setDrawMenu(a => (a ? null : (drawBtnRef.current?.getBoundingClientRect() ?? null))),
      icon: <Icon><path d="M13.5 3.5l3 3L7 16l-4 1 1-4z" /><path d="M11.5 5.5l3 3" /></Icon>,
    },
  ]), [enabled, ta.taMode, ta.setTool, ta.analyzeVisible, ta.clearDrawings, ta.hasDrawings, ta.analysis, drawMenu])

  const chartProps = useMemo(() => (!enabled ? {} : {
    taMode: ta.taMode,
    taSelection: ta.selection,
    onTaSelectionChange: ta.onTaSelectionChange,
    taDrawings: ta.drawings,
    onTaDrawingAdd: ta.onTaDrawingAdd,
    taRevealKey: ta.revealKey,
  }), [enabled, ta.taMode, ta.selection, ta.onTaSelectionChange, ta.drawings, ta.onTaDrawingAdd, ta.revealKey])

  return {
    enabled,
    ta, toolButtons, chartProps,
    drawMenu, setDrawMenu,
    agentOpen, setAgentOpen,
    taRequest,
    symbol, tokenName, tokenData, dayMode,
  }
}

/** Pattern strip + draw menu + the agent drawer. */
export function ChartTaSurface({ ta: surface, showAgent = true }) {
  if (!surface || surface.enabled === false) return null
  const { ta, drawMenu, setDrawMenu, agentOpen, setAgentOpen, taRequest, symbol, tokenName, tokenData, dayMode } = surface

  return (
    <>
      <RzTaStrip
        analysis={ta.analysis}
        error={ta.analysisError}
        hasDrawings={ta.hasDrawings}
        onClearLines={() => ta.clearDrawings('all')}
        onDismiss={() => ta.clearDrawings('all')}
      />

      <RzTaToolMenu
        open={!!drawMenu}
        anchorRect={drawMenu}
        taMode={ta.taMode}
        canUndo={ta.userDrawings.length > 0}
        hasDrawings={ta.hasDrawings}
        onPick={(mode) => { ta.setTool(mode); setDrawMenu(null) }}
        onUndo={() => ta.undoDrawing()}
        onClear={() => { ta.clearDrawings('all'); setDrawMenu(null) }}
        onClose={() => setDrawMenu(null)}
      />

      {/* The agent floats over the chart (absolute inside the chart wrap):
          these surfaces have no sidebar to put it in, and position:fixed gets
          trapped by Traders Corner's container-query columns. Kept mounted
          after first open so the conversation survives closing the panel. */}
      {showAgent && (agentOpen || taRequest) && (
        <>
          {agentOpen && <div className="cta-scrim" onClick={() => setAgentOpen(false)} />}
          <div className={`cta-drawer${agentOpen ? ' is-open' : ''}`} role="dialog" aria-label={`Spectre agent for ${symbol}`}>
            <div className="cta-drawer-head">
              <span className="cta-drawer-title">Spectre · {symbol}</span>
              <button type="button" className="cta-drawer-close" onClick={() => setAgentOpen(false)} aria-label="Close">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="cta-drawer-body">
              <Suspense fallback={<div className="cta-drawer-loading animate-shimmer" />}>
                <AgentChat
                  sym={String(symbol || '').toUpperCase()}
                  tokenName={tokenName || symbol}
                  tokenData={tokenData}
                  dayMode={dayMode}
                  taRequest={taRequest}
                  onAgentDrawings={ta.setAgentDrawings}
                />
              </Suspense>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export default ChartTaSurface
