/**
 * AppearanceStudio — the full customization surface for the terminal,
 * opened from the header ToneControl popover.
 *
 * Three instruments, all applying LIVE on click:
 *   SKINS   — curated tone + accent bundles with collectible tiers
 *             (lib/skins.js). Equipping just sets both settings; the
 *             equipped card is derived by matching, never stored.
 *   TONE    — the 8 curated black ladders + depth fine-tune (lib/bgTone.js)
 *   ACCENT  — preset swatches + a free custom color picker (lib/accent.js)
 *
 * Everything persists through useSettingsStore (device-local) and is
 * applied by App.jsx's appearance effect; this modal previews changes
 * directly for zero-lag feedback, then commits to the store.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { X, RotateCcw, SunDim, Sun, Check, Pipette } from 'lucide-react'
import useSettingsStore from '../../store/useSettingsStore'
import {
  applyBgTone,
  clampDepth,
  tonePreview,
  getTone,
  TONES,
  DEFAULT_TONE,
  DEPTH_MIN,
  DEPTH_MAX,
} from '../../lib/bgTone'
import {
  applyAccent,
  sanitizeAccent,
  ACCENT_PRESETS,
  STOCK_ACCENT_HEX,
  DEFAULT_ACCENT,
} from '../../lib/accent'
import { SKINS, SKIN_TIERS, skinFor } from '../../lib/skins'
import { DECOR_SKINS, getDecorSkin, applyDecorSkin, DEFAULT_DECOR_SKIN } from '../../lib/decorSkins'
import { Motif } from '../SkinArt/motifs'
import { MURALS, withSlice } from '../SkinArt/murals'
import './studio.css'

const SNAP = 3
const snapDepth = (v) => (Math.abs(v) <= SNAP ? 0 : v)

/* Sparkline path drawn on every skin card — one shared shape so the
   cards differ by palette only, exactly like a weapon-skin lineup. */
const SPARK_POINTS = '0,26 12,22 22,27 34,14 46,18 58,8 72,13 86,4 100,9'

function SkinCard({ skin, equipped, onEquip }) {
  const { low, high } = tonePreview(skin.tone)
  const accent = skin.accent || STOCK_ACCENT_HEX
  const tier = SKIN_TIERS[skin.tier] || SKIN_TIERS.core
  return (
    <button
      type="button"
      className={`stu-skin${equipped ? ' stu-skin--on' : ''}`}
      onClick={() => onEquip(skin)}
      aria-pressed={equipped}
      aria-label={`${skin.label} skin — ${skin.tagline}${equipped ? ' (equipped)' : ''}`}
      style={{ '--sk-accent': accent, '--sk-low': low, '--sk-high': high }}
    >
      <span className="stu-skin-preview" aria-hidden="true">
        <svg className="stu-skin-spark" viewBox="0 0 100 32" preserveAspectRatio="none">
          <polyline points={SPARK_POINTS} />
        </svg>
        <span className="stu-skin-bar stu-skin-bar--1" />
        <span className="stu-skin-bar stu-skin-bar--2" />
        <span className="stu-skin-dot" />
        {equipped && (
          <span className="stu-skin-equipped">
            <Check size={9} strokeWidth={3} aria-hidden="true" />
            Equipped
          </span>
        )}
      </span>
      <span className="stu-skin-meta">
        <span className="stu-skin-name">{skin.label}</span>
        <span className="stu-skin-tier" style={{ color: tier.color }}>{tier.label}</span>
      </span>
      <span className="stu-skin-tagline">{skin.tagline}</span>
    </button>
  )
}

/**
 * DecorCard — one cosmetic skin in the SKINS grid. The preview tile is
 * a cropped slice of the skin's tabs mural — a finish swatch, the way
 * a weapon skin is presented in an inventory. Equipping only sets the
 * decorSkin store field (fully independent from Themes).
 */
function DecorCard({ skin, equipped, onEquip }) {
  const tier = SKIN_TIERS[skin?.tier] || SKIN_TIERS.core
  const isNone = !skin
  const swatch = isNone ? null : MURALS[skin.id]?.[skin.preview]
  return (
    <button
      type="button"
      className={`stu-decor-card${equipped ? ' stu-decor-card--on' : ''}${isNone ? ' stu-decor-card--none' : ''}`}
      onClick={() => onEquip(isNone ? null : skin.id)}
      aria-pressed={equipped}
      aria-label={isNone ? `No skin${equipped ? ' (equipped)' : ''}` : `${skin.label} skin — ${skin.tagline}${equipped ? ' (equipped)' : ''}`}
    >
      <span className="stu-decor-preview" aria-hidden="true">
        {isNone ? (
          <span className="stu-decor-none-mark">—</span>
        ) : (
          swatch && <Motif svg={withSlice(swatch)} className="stu-decor-swatch" />
        )}
        {equipped && (
          <span className="stu-skin-equipped stu-decor-equipped">
            <Check size={9} strokeWidth={3} aria-hidden="true" />
            Equipped
          </span>
        )}
      </span>
      <span className="stu-skin-meta">
        <span className="stu-skin-name">{isNone ? 'None' : skin.label}</span>
        <span className="stu-skin-tier" style={{ color: isNone ? SKIN_TIERS.core.color : tier.color }}>
          {isNone ? 'Core' : tier.label}
        </span>
      </span>
    </button>
  )
}

export default function AppearanceStudio({ onClose }) {
  const tone = useSettingsStore((s) => s.bgTone)
  const depth = useSettingsStore((s) => s.bgDepth)
  const accentColor = useSettingsStore((s) => s.accentColor)
  const decorSkin = useSettingsStore((s) => s.decorSkin)
  const setDecorSkin = useSettingsStore((s) => s.setDecorSkin)
  const chartFollowsTheme = useSettingsStore((s) => s.chartFollowsTheme)
  const setBgTone = useSettingsStore((s) => s.setBgTone)
  const setBgDepth = useSettingsStore((s) => s.setBgDepth)
  const setAccentColor = useSettingsStore((s) => s.setAccentColor)
  const setChartFollowsTheme = useSettingsStore((s) => s.setChartFollowsTheme)

  const [liveDepth, setLiveDepth] = useState(depth)
  const liveDepthRef = useRef(depth)
  liveDepthRef.current = liveDepth
  useEffect(() => { setLiveDepth(depth) }, [depth])

  const panelRef = useRef(null)
  const colorInputRef = useRef(null)
  const customRafRef = useRef(0)

  const equippedSkin = skinFor(tone, accentColor)
  const isStock = tone === DEFAULT_TONE && depth === 0 && !accentColor && !decorSkin
  const equippedDecor = getDecorSkin(decorSkin)

  const equipDecor = useCallback((id) => {
    applyDecorSkin(id)
    setDecorSkin(id)
  }, [setDecorSkin])
  const isPresetAccent = ACCENT_PRESETS.some((p) => (p.hex || null) === (accentColor || null))

  /* --- actions (apply live, commit to store) ---------------------- */

  const equipSkin = useCallback((skin) => {
    applyBgTone(skin.tone, liveDepthRef.current)
    applyAccent(skin.accent)
    setBgTone(skin.tone)
    setAccentColor(skin.accent)
  }, [setBgTone, setAccentColor])

  const pickTone = useCallback((id) => {
    applyBgTone(id, liveDepthRef.current)
    setBgTone(id)
  }, [setBgTone])

  const pickAccent = useCallback((hex) => {
    applyAccent(hex)
    setAccentColor(hex)
  }, [setAccentColor])

  const previewDepth = useCallback((value, toneId) => {
    const v = clampDepth(value)
    setLiveDepth(v)
    applyBgTone(toneId, v)
  }, [])

  const commitDepth = useCallback(() => {
    setBgDepth(liveDepthRef.current)
  }, [setBgDepth])

  const resetAll = useCallback(() => {
    setLiveDepth(0)
    applyBgTone(DEFAULT_TONE, 0)
    applyAccent(DEFAULT_ACCENT)
    applyDecorSkin(DEFAULT_DECOR_SKIN)
    setBgTone(DEFAULT_TONE)
    setBgDepth(0)
    setAccentColor(DEFAULT_ACCENT)
    setDecorSkin(DEFAULT_DECOR_SKIN)
  }, [setBgTone, setBgDepth, setAccentColor, setDecorSkin])

  /* Custom color picker: preview while scrubbing (rAF-throttled, no
     store churn), commit on close/change. */
  const onCustomInput = (e) => {
    const hex = e.target.value
    if (customRafRef.current) return
    customRafRef.current = requestAnimationFrame(() => {
      customRafRef.current = 0
      applyAccent(hex)
    })
  }
  const onCustomCommit = (e) => {
    const hex = sanitizeAccent(e.target.value)
    if (hex) pickAccent(hex)
  }

  /* --- modal chrome: esc, scroll lock ------------------------------ */

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (customRafRef.current) cancelAnimationFrame(customRafRef.current)
    }
  }, [onClose])

  const onOverlayDown = (e) => {
    if (!panelRef.current?.contains(e.target)) onClose()
  }

  return ReactDOM.createPortal(
    <div className="stu-overlay" onMouseDown={onOverlayDown}>
      <div
        ref={panelRef}
        className="stu-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Appearance studio"
      >
        {/* HEADER */}
        <div className="stu-head">
          <div className="stu-head-copy">
            <span className="stu-title">Appearance</span>
            <span className="stu-subtitle">Make the terminal yours — changes apply live behind this panel.</span>
          </div>
          <div className="stu-head-actions">
            <button
              type="button"
              className="stu-reset"
              onClick={resetAll}
              disabled={isStock}
            >
              <RotateCcw size={11} strokeWidth={2} aria-hidden="true" />
              Reset all
            </button>
            <button type="button" className="stu-close" onClick={onClose} aria-label="Close">
              <X size={15} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* SKINS — decorative cosmetics (CS:GO-style), independent from Themes */}
        <div className="stu-section">
          <div className="stu-section-head">
            <span className="stu-section-title">Skins</span>
            <span className="stu-section-note">
              {equippedDecor ? equippedDecor.label : 'None'}
            </span>
          </div>
          <div className="stu-decor" role="radiogroup" aria-label="Decorative skin">
            <DecorCard skin={null} equipped={!decorSkin} onEquip={equipDecor} />
            {DECOR_SKINS.map((skin) => (
              <DecorCard
                key={skin.id}
                skin={skin}
                equipped={decorSkin === skin.id}
                onEquip={equipDecor}
              />
            ))}
          </div>
        </div>

        {/* THEMES — tone + accent color bundles */}
        <div className="stu-section">
          <div className="stu-section-head">
            <span className="stu-section-title">Themes</span>
            <span className="stu-section-note">
              {equippedSkin ? equippedSkin.label : ((tone === DEFAULT_TONE && depth === 0 && !accentColor) ? 'Stock' : 'Custom')}
            </span>
          </div>
          <div className="stu-skins">
            {SKINS.map((skin) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                equipped={equippedSkin?.id === skin.id}
                onEquip={equipSkin}
              />
            ))}
          </div>
        </div>

        <div className="stu-columns">
          {/* BACKGROUND TONE */}
          <div className="stu-section">
            <div className="stu-section-head">
              <span className="stu-section-title">Background Tone</span>
              <span className="stu-section-note">{getTone(tone).label}</span>
            </div>
            <div className="stu-tones" role="radiogroup" aria-label="Background tone">
              {TONES.map((t) => {
                const { low, high } = tonePreview(t.id)
                const selected = t.id === tone
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`stu-tone${selected ? ' stu-tone--on' : ''}`}
                    onClick={() => pickTone(t.id)}
                  >
                    <span
                      className="stu-tone-chip"
                      aria-hidden="true"
                      style={{ background: `linear-gradient(180deg, ${high} 0%, ${low} 100%)` }}
                    />
                    <span className="stu-tone-name">{t.label}</span>
                  </button>
                )
              })}
            </div>
            {/* "Apply tone to chart" mark — ON by default: picking a skin or
                tone re-tones the chart background too. An explicit chart bg
                (Chart Style popover) always outranks the theme. */}
            <button
              type="button"
              className={`stu-follow${chartFollowsTheme ? ' stu-follow--on' : ''}`}
              role="switch"
              aria-checked={chartFollowsTheme}
              onClick={() => setChartFollowsTheme(!chartFollowsTheme)}
            >
              <span className="stu-follow-box" aria-hidden="true">
                {chartFollowsTheme && <Check size={9} strokeWidth={3.2} />}
              </span>
              Apply tone to chart
            </button>
          </div>

          {/* ACCENT */}
          <div className="stu-section">
            <div className="stu-section-head">
              <span className="stu-section-title">Accent</span>
              <span className="stu-section-note">
                {ACCENT_PRESETS.find((p) => (p.hex || null) === (accentColor || null))?.label
                  || accentColor
                  || 'White'}
              </span>
            </div>
            <div className="stu-accents" role="radiogroup" aria-label="Accent color">
              {ACCENT_PRESETS.map((p) => {
                const selected = (p.hex || null) === (accentColor || null)
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`stu-accent${selected ? ' stu-accent--on' : ''}`}
                    onClick={() => pickAccent(p.hex)}
                    title={p.label}
                    aria-label={p.label}
                  >
                    <span
                      className="stu-accent-chip"
                      aria-hidden="true"
                      style={{ background: p.hex || STOCK_ACCENT_HEX }}
                    />
                  </button>
                )
              })}
              {/* Custom picker */}
              <button
                type="button"
                className={`stu-accent stu-accent--custom${accentColor && !isPresetAccent ? ' stu-accent--on' : ''}`}
                onClick={() => colorInputRef.current?.click()}
                title="Custom color"
                aria-label="Custom color"
              >
                <span className="stu-accent-chip stu-accent-chip--custom" aria-hidden="true">
                  <Pipette size={10} strokeWidth={2} />
                </span>
              </button>
              <input
                ref={colorInputRef}
                type="color"
                className="stu-color-input"
                value={accentColor || STOCK_ACCENT_HEX}
                onInput={onCustomInput}
                onChange={onCustomCommit}
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        {/* DEPTH */}
        <div className="stu-section">
          <div className="stu-section-head">
            <span className="stu-section-title">Depth</span>
            <span className={`stu-depth-value${liveDepth === 0 ? ' stu-depth-value--default' : ''}`}>
              {liveDepth === 0 ? 'As designed' : (liveDepth > 0 ? `+${liveDepth}` : `${liveDepth}`)}
            </span>
          </div>
          <div className="stu-slider-row">
            <span className="stu-slider-end" aria-hidden="true">
              <SunDim size={13} strokeWidth={1.7} />
            </span>
            <div className="stu-slider-wrap">
              <input
                type="range"
                className="stu-slider"
                min={DEPTH_MIN}
                max={DEPTH_MAX}
                step={1}
                value={liveDepth}
                onChange={(e) => previewDepth(snapDepth(Number(e.target.value)), tone)}
                onPointerUp={commitDepth}
                onKeyUp={commitDepth}
                onBlur={commitDepth}
                aria-label="Tone depth"
              />
            </div>
            <span className="stu-slider-end" aria-hidden="true">
              <Sun size={13} strokeWidth={1.7} />
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
