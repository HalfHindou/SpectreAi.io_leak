/**
 * AuroraField — the ambient atmosphere layer behind the entire app.
 *
 * Three large soft radial blooms (cool, warm, ember) drifting on a slow loop
 * via CSS keyframes on transform/opacity only — GPU-cheap, pointer-events:none,
 * z-index below content. Honors prefers-reduced-motion and the in-app
 * `reducedMotion` toggle (paused via [data-reduced-motion="true"] on .app).
 *
 * Mounted once at App root. Renders a fixed full-viewport <div> with three
 * absolutely-positioned bloom layers. No props, no state, no React updates.
 */

import React from 'react'
import './AuroraField.css'

function AuroraField() {
  return (
    <div className="aurora-field" aria-hidden="true">
      <div className="aurora-bloom aurora-bloom--cool" />
      <div className="aurora-bloom aurora-bloom--warm" />
      <div className="aurora-bloom aurora-bloom--ember" />
    </div>
  )
}

export default React.memo(AuroraField)
