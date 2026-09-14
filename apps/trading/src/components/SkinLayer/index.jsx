/**
 * SkinLayer — the page-level half of decorative skins.
 *
 * A fixed, pointer-events-none layer on the ambient plane (same z as
 * AuroraField, later in DOM so it paints above the blooms and below all
 * content). Renders the equipped skin's TWO large corner murals
 * (bottom-left + top-right, HERO_PIECES in lib/decorSkins.js) so the
 * artwork reads as a finish wrapping the whole page — the content
 * panels cover the middle, the drawings live in the margins and bleed
 * off the viewport edges. The chart's data region stays clear.
 *
 * Pure CSS drift (transform-only), disabled under reduced motion.
 * Unmounted entirely when no skin is equipped (App.jsx gates the mount).
 */

import React from 'react'
import useSettingsStore from '../../store/useSettingsStore'
import { getDecorSkin, HERO_PIECES } from '../../lib/decorSkins'
import { MURALS } from '../SkinArt/murals'
import { Motif } from '../SkinArt/motifs'
import './skinlayer.css'

function SkinLayer() {
  const decorSkin = useSettingsStore((s) => s.decorSkin)
  const skin = getDecorSkin(decorSkin)
  if (!skin) return null
  const art = MURALS[skin.id]

  return (
    <div className="skin-layer" aria-hidden="true">
      {HERO_PIECES.map((piece) => {
        const svg = art?.[piece.key]
        if (!svg) return null
        return (
          <Motif
            key={piece.key}
            svg={svg}
            className={`skin-layer-piece skin-drift-${piece.drift}`}
            style={{
              ...piece.style,
              width: piece.w,
              height: piece.h,
              opacity: piece.opacity,
            }}
          />
        )
      })}
    </div>
  )
}

export default React.memo(SkinLayer)
