/**
 * ChartWatermark — the single, elegant Spectre brand mark for charts.
 *
 * One overlay, size-adaptive via CSS container queries:
 *   - large / hero charts  → faint centered "SPECTRE" logotype + corner "Spectre AI" lockup
 *   - medium charts        → corner lockup only
 *   - small charts         → corner glyph only
 *   - tiny (row sparkline)  → nothing (a mark there is clutter, not brand)
 *
 * Drop it inside any chart container that is `position: relative` (add the
 * `spectre-wm-host` helper class if it isn't). It is `pointer-events: none`, so
 * it never intercepts clicks / TradingView interaction.
 *
 *   <div className="my-chart spectre-wm-host">
 *     <canvas /> or <iframe /> or <svg />
 *     <ChartWatermark />
 *   </div>
 */
import './chart-watermark.css'

function ChartWatermark({ ghost = 'SPECTRE', corner = 'br', className = '', padX, padY }) {
  const style = {}
  if (padX != null) style['--wm-px'] = typeof padX === 'number' ? `${padX}px` : padX
  if (padY != null) style['--wm-py'] = typeof padY === 'number' ? `${padY}px` : padY
  return (
    <div className={`spectre-wm spectre-wm--${corner}${className ? ` ${className}` : ''}`} style={style} aria-hidden="true">
      {ghost ? <span className="spectre-wm__ghost">{ghost}</span> : null}
      <span className="spectre-wm__corner">
        {/* clean, box-free brand lockup (logo + wordmark) derived from the header logo */}
        <img className="spectre-wm__lockup spectre-wm__lockup--dark" src="/spectre-wm-light.png" alt="" draggable="false" />
        <img className="spectre-wm__lockup spectre-wm__lockup--day" src="/spectre-wm-dark.png" alt="" draggable="false" />
      </span>
    </div>
  )
}

export default ChartWatermark
