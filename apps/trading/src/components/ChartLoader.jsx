import React from 'react'
import './ChartLoader.css'

/**
 * Shared chart loading placeholder — the Spectre brand mark, centered on the
 * chart void, gently breathing (scale + opacity) over a soft radial glow.
 * Minimal and premium; no text, no chart chrome. Used by both the native-canvas
 * path and the TradingView-Advanced path (TradingChart + TradingViewAdvanced)
 * so loading looks identical everywhere.
 */
const ChartLoader = React.memo(function ChartLoader() {
  return (
    <div className="chart-loading-state" aria-busy="true">
      <div className="cl-logo-wrap" aria-hidden="true">
        <span className="cl-logo-glow" />
        <img className="cl-logo" src="/spectre-icon.png" alt="" draggable="false" />
      </div>
    </div>
  )
})

export default ChartLoader
