/**
 * lite-etf-share.jsx - the ETF flows share card + the compact USD formatter,
 * shared by the Today ETF panel (lite-page.jsx) and the ETF Flows view
 * (lite-etf.jsx) so neither imports the other.
 */
import React, { useState, useCallback } from 'react'
import lazyWithRetry from '@/lib/lazy-with-retry'
import { generateEtfShareCard } from '@/components/etf/etf-share-card'
import ShareXButton from '@/components/share-x-button'
const ShareXModal = lazyWithRetry(() => import('@/components/share-x-modal'))

export function litEtfUsd(n) {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n), s = n > 0 ? '+' : n < 0 ? '−' : ''
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${Math.round(a)}`
}

// ── Share the ETF flows as a branded PNG (same card Pro exports) ──
export function LiteEtfShare({ data, asset }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [img, setImg] = useState(null)
  const [text, setText] = useState('')
  const summary = data?.summary

  const onShare = useCallback(async () => {
    if (busy || !summary) return
    setBusy(true); setImg(null); setOpen(true)
    try {
      const { imageUrl, description } = await generateEtfShareCard({ summary, charts: data?.charts || {}, asset })
      setText(description); setImg(imageUrl)
    } catch (err) {
      console.error('ETF share failed:', err)
      setOpen(false)
    }
    setBusy(false)
  }, [busy, summary, data, asset])

  if (!summary) return null
  return (
    <>
      <ShareXButton onClick={onShare} isExporting={busy} compact className="lite-etf-sharex" />
      {open && (
        <React.Suspense fallback={null}>
          <ShareXModal
            open={open}
            onClose={() => { setOpen(false); setImg(null) }}
            imageUrl={img}
            defaultDescription={text}
            filename={`spectre_etf_flows_${String(asset).toLowerCase()}.png`}
          />
        </React.Suspense>
      )}
    </>
  )
}

