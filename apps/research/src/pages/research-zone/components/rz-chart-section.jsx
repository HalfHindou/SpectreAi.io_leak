import React, { forwardRef, Suspense } from 'react'
// PR-7 (perf): trading-chart.jsx is a 5400-line module. Loading it lazily
// takes it off the RZ route chunk's critical path - the chart area renders
// a same-size shimmer while the module downloads (no CLS), matching the
// chart's own data-loading state. lazyWithRetry keeps the stale-chunk
// recovery behavior of route chunks; React.lazy's module cache makes every
// later mount instant.
import lazyWithRetry from '@/lib/lazy-with-retry'
import ChartSkeleton from '@/components/chart-skeleton'
import './rz-chart-responsive.css'

const TradingChart = lazyWithRetry(() => import('@/components/trading-chart'))

const RzChartSection = forwardRef(function RzChartSection({
  onSymbolChange,
  chartToken,
  chartHeight,
  dayMode,
  livePrice,
  tokenData,
  onChartDragStart,
  tradeMarkers,
  onVoiceStateChange,
  extraTypeTabs,
  extraToolButtons,
  annotations,
  noteModeActive,
  onCanvasAnnotateClick,
  onAnnotationClick,
  compareViewActive,
  compareViewProps,
  taMode,
  taSelection,
  onTaSelectionChange,
  taDrawings,
  onTaDrawingAdd,
  taRevealKey,
  onFullscreenChange,
  identityPending,
}, ref) {
  return (
    <>
      <div className="research-zone-lite-chart-wrap" style={{ height: 'auto' }}>
        <Suspense fallback={<ChartSkeleton height={chartHeight} />}>
          <TradingChart
            ref={ref}
            token={chartToken}
            stats={tokenData}
            dayMode={dayMode}
            livePrice={livePrice}
            embedHeight={chartHeight}
            embedMode
            responsiveControls
            tradeMarkers={tradeMarkers}
            onSymbolChange={onSymbolChange}
            onVoiceStateChange={onVoiceStateChange}
            extraTypeTabs={extraTypeTabs}
            extraToolButtons={extraToolButtons}
            annotations={annotations}
            noteModeActive={noteModeActive}
            onCanvasAnnotateClick={onCanvasAnnotateClick}
            onAnnotationClick={onAnnotationClick}
            compareViewActive={compareViewActive}
            compareViewProps={compareViewProps}
            taMode={taMode}
            taSelection={taSelection}
            onTaSelectionChange={onTaSelectionChange}
            taDrawings={taDrawings}
            onTaDrawingAdd={onTaDrawingAdd}
            taRevealKey={taRevealKey}
            onFullscreenChange={onFullscreenChange}
            identityPending={identityPending}
          />
        </Suspense>
        <div
          className="research-zone-lite-chart-drag"
          onPointerDown={onChartDragStart}
          title="Drag to resize chart"
        >
          <span className="research-zone-lite-chart-drag-pill" />
        </div>
      </div>
    </>
  )
})

export default React.memo(RzChartSection)
