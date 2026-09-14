/**
 * MobileBottomNav — sticky bottom bar: Buy/Sell only.
 *
 *   [        Buy        ] [        Sell        ]
 *
 * The ☰ menu + ⓘ info actions live on the floating MobileSideRail (left
 * edge, draggable); the Spectre Agent launcher is the draggable
 * SpectreAgentFab. Buy/Sell own the full width here — trading is the
 * primary mobile action (GMGN/Vector pattern) — and open MobileSwapSheet.
 */
import React from 'react'
import './MobileBottomNav.css'

export default function MobileBottomNav({
  onBuy,
  onSell,
}) {
  return (
    <div className="mbn" role="toolbar" aria-label="Token actions">
      <button
        type="button"
        className="mbn-trade mbn-trade--buy"
        onClick={onBuy}
        aria-label="Buy"
      >
        Buy
      </button>
      <button
        type="button"
        className="mbn-trade mbn-trade--sell"
        onClick={onSell}
        aria-label="Sell"
      >
        Sell
      </button>
    </div>
  )
}
