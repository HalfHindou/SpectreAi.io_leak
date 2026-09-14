/**
 * AutoComposeModal — AI-driven canvas composition generator.
 *
 * Lets users pick Market Mood, Focus, and Density preferences,
 * then fires `onCompose({ mood, focus, density })` so StudioCanvas
 * can populate the canvas with a curated sticker layout.
 */
import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'


const MOODS = [
  { id: 'breakout',  label: 'Breakout'  },
  { id: 'risk-off',  label: 'Risk Off'  },
  { id: 'altseason', label: 'Altseason' },
  { id: 'earnings',  label: 'Earnings'  },
  { id: 'mean-rev',  label: 'Mean Rev'  },
  { id: 'chop',      label: 'Chop'      },
]

const FOCUSES = [
  { id: 'btc',       label: 'BTC'       },
  { id: 'btc-eth',   label: 'BTC + ETH' },
  { id: 'top-coins', label: 'Top Coins' },
  { id: 'mixed',     label: 'Mixed'     },
]

const DENSITIES = [
  { id: 'minimal',  label: 'Minimal'  },
  { id: 'balanced', label: 'Balanced' },
  { id: 'maximal',  label: 'Maximal'  },
]


export default function AutoComposeModal({ open, onClose, onCompose }) {
  const [mood, setMood]       = useState('risk-off')
  const [focus, setFocus]     = useState('mixed')
  const [density, setDensity] = useState('balanced')

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  const handleCompose = useCallback(() => {
    onCompose({ mood, focus, density })
    onClose()
  }, [mood, focus, density, onCompose, onClose])

  if (!open) return null

  return createPortal(
    <div style={styles.backdrop} onClick={handleBackdropClick}>
      <div style={styles.card}>
        {/* Close button */}
        <button style={styles.closeBtn} onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div style={styles.title}>Auto-Compose</div>
        <div style={styles.subtitle}>
          Let AI create a beautiful composition based on your preferences.
        </div>

        {/* Market Mood */}
        <PillSection label="Market Mood" options={MOODS} value={mood} onChange={setMood} />

        {/* Focus */}
        <PillSection label="Focus" options={FOCUSES} value={focus} onChange={setFocus} />

        {/* Density */}
        <PillSection label="Density" options={DENSITIES} value={density} onChange={setDensity} />

        {/* Action buttons */}
        <div style={styles.buttonRow}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.composeBtn} onClick={handleCompose}>Compose</button>
        </div>
      </div>
    </div>,
    document.body
  )
}


/* ── Pill Section ────────────────────────────────── */

function PillSection({ label, options, value, onChange }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionLabel}>{label}</div>
      <div style={styles.pillRow}>
        {options.map(opt => {
          const selected = opt.id === value
          return (
            <button
              key={opt.id}
              style={{
                ...styles.pill,
                ...(selected ? styles.pillSelected : {}),
              }}
              onMouseEnter={(e) => {
                if (!selected) {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
                }
              }}
              onMouseLeave={(e) => {
                if (!selected) {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                }
              }}
              onClick={() => onChange(opt.id)}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}


/* ── Inline Styles ───────────────────────────────── */

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },
  card: {
    position: 'relative',
    width: '100%',
    maxWidth: 480,
    background: 'rgba(14,14,20,0.97)',
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.06)',
    padding: 32,
    boxSizing: 'border-box',
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    color: 'var(--text-tertiary, rgba(255,255,255,0.5))',
    cursor: 'pointer',
    padding: 0,
    borderRadius: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-primary, #f5f5f7)',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-secondary, rgba(255,255,255,0.6))',
    marginBottom: 24,
    lineHeight: 1.5,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: 'var(--font-mono, monospace)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-muted, rgba(255,255,255,0.4))',
    marginBottom: 8,
  },
  pillRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    padding: '6px 16px',
    fontSize: 12,
    fontFamily: 'var(--font-mono, monospace)',
    fontWeight: 500,
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    transition: 'border-color 0.15s ease, background 0.15s ease, color 0.15s ease',
  },
  pillSelected: {
    background: 'var(--accent, #8b5cf6)',
    borderColor: 'transparent',
    color: '#fff',
  },
  buttonRow: {
    display: 'flex',
    gap: 12,
    justifyContent: 'flex-end',
    marginTop: 28,
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: '10px 24px',
    fontSize: 13,
    fontFamily: 'var(--font-mono, monospace)',
    color: 'var(--text-secondary, rgba(255,255,255,0.6))',
    cursor: 'pointer',
    fontWeight: 500,
  },
  composeBtn: {
    background: 'var(--accent, #8b5cf6)',
    border: 'none',
    borderRadius: 10,
    padding: '10px 24px',
    fontSize: 13,
    fontFamily: 'var(--font-mono, monospace)',
    fontWeight: 700,
    color: '#fff',
    cursor: 'pointer',
  },
}
