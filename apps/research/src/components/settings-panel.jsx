import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { track, Events, setUserProps } from '@/services/analytics'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { CURRENCY_LIST, LANGUAGE_LIST } from '@/lib/currencyConfig'
import useSettingsStore from '@/store/useSettingsStore'
import './settings-panel.css'

export default function SettingsPanel({ open, onClose, dayMode }) {
  const { t } = useTranslation()
  const { currency, setCurrency, language, setLanguage } = useCurrency()

  // Mood wall toggle - instant (no pending/apply needed)
  const showMoodWall = useSettingsStore((s) => s.showMoodWall)
  const toggleShowMoodWall = useSettingsStore((s) => s.toggleShowMoodWall)
  const moodWallBrightness = useSettingsStore((s) => s.moodWallBrightness)
  const setMoodWallBrightness = useSettingsStore((s) => s.setMoodWallBrightness)

  // Token coloring toggle - instant
  const tokenColoring = useSettingsStore((s) => s.tokenColoring)
  const toggleTokenColoring = useSettingsStore((s) => s.toggleTokenColoring)

  // Pending selections - nothing applies until user clicks Apply
  const [pendingCurrency, setPendingCurrency] = useState(currency)
  const [pendingLanguage, setPendingLanguage] = useState(language)

  // Sync pending state when panel opens or external values change
  useEffect(() => {
    if (open) {
      setPendingCurrency(currency)
      setPendingLanguage(language)
    }
  }, [open, currency, language])

  if (!open) return null

  const hasChanges = pendingCurrency !== currency || pendingLanguage !== language

  const handleApply = () => {
    if (pendingCurrency !== currency) {
      track(Events.SETTINGS_CHANGED, { setting: 'currency', value: pendingCurrency })
      setUserProps({ preferred_currency: pendingCurrency })
      setCurrency(pendingCurrency)
    }
    if (pendingLanguage !== language) {
      track(Events.SETTINGS_CHANGED, { setting: 'language', value: pendingLanguage })
      setUserProps({ preferred_language: pendingLanguage })
      setLanguage(pendingLanguage)
    }
    onClose()
  }

  return createPortal(
    <>
      <div className="settings-panel-backdrop" onClick={onClose} aria-hidden />
      <div className={`settings-panel${dayMode ? ' day-mode' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h3 className="settings-panel-title">{t('settings.title')}</h3>
          <button className="settings-panel-close" onClick={onClose} aria-label={t('settings.close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="settings-section">
          <label className="settings-section-label">{t('settings.currency')}</label>
          <div className="settings-currency-grid">
            {CURRENCY_LIST.map((c) => (
              <button
                key={c.code}
                aria-pressed={pendingCurrency === c.code}
                className={`settings-option-btn${pendingCurrency === c.code ? ' active' : ''}`}
                onClick={() => setPendingCurrency(c.code)}
              >
                <span className="settings-option-flag">{c.flag}</span>
                <span className="settings-option-code">{c.code}</span>
                <span className="settings-option-symbol">{c.symbol}</span>
              </button>
            ))}
          </div>
          <p className="settings-note">{t('settings.currencyNote')}</p>
        </div>

        <div className="settings-divider" />

        <div className="settings-section">
          <label className="settings-section-label">{t('settings.language')}</label>
          <div className="settings-language-grid">
            {LANGUAGE_LIST.map((l) => (
              <button
                key={l.code}
                aria-pressed={pendingLanguage === l.code}
                className={`settings-option-btn lang${pendingLanguage === l.code ? ' active' : ''}`}
                onClick={() => setPendingLanguage(l.code)}
              >
                <span className="settings-option-flag">{l.flag}</span>
                <span className="settings-option-native">{l.nativeName}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-divider" />

        <div className="settings-section">
          <label className="settings-section-label">Display</label>
          <button type="button" role="switch" aria-checked={showMoodWall} className="settings-toggle-row" onClick={() => { track(Events.SETTINGS_CHANGED, { setting: 'mood_walls', value: !showMoodWall }); toggleShowMoodWall() }}>
            <span className="settings-toggle-info">
              <span className="settings-toggle-label">Mood Walls</span>
              <span className="settings-toggle-desc">Ambient sentiment glow on landing</span>
            </span>
            <span className={`settings-toggle-switch${showMoodWall ? ' active' : ''}`}>
              <span className="settings-toggle-knob" />
            </span>
          </button>
          {showMoodWall && (
            <div className="settings-slider-row">
              <div className="settings-toggle-info">
                <span className="settings-toggle-label">Glow Brightness</span>
                <span className="settings-toggle-desc">Intensity of the mood-wall glow</span>
              </div>
              <div className="settings-slider-control">
                <input
                  type="range"
                  className="settings-slider"
                  min="0.3"
                  max="2"
                  step="0.1"
                  value={moodWallBrightness}
                  onChange={(e) => setMoodWallBrightness(parseFloat(e.target.value))}
                  onMouseUp={() => track(Events.SETTINGS_CHANGED, { setting: 'mood_wall_brightness', value: moodWallBrightness })}
                  aria-label="Mood wall glow brightness"
                />
                <span className="settings-slider-value">{Math.round(moodWallBrightness * 100)}%</span>
              </div>
            </div>
          )}
          <button type="button" role="switch" aria-checked={tokenColoring} className="settings-toggle-row" onClick={() => { track(Events.SETTINGS_CHANGED, { setting: 'token_coloring', value: !tokenColoring }); toggleTokenColoring() }}>
            <span className="settings-toggle-info">
              <span className="settings-toggle-label">Token Coloring</span>
              <span className="settings-toggle-desc">Brand color glow on token hover</span>
            </span>
            <span className={`settings-toggle-switch${tokenColoring ? ' active' : ''}`}>
              <span className="settings-toggle-knob" />
            </span>
          </button>
        </div>

        <div className="settings-divider" />

        <button
          className={`settings-apply-btn${hasChanges ? ' has-changes' : ''}`}
          onClick={handleApply}
          disabled={!hasChanges}
        >
          {t('settings.apply')}
        </button>
      </div>
    </>,
    document.body
  )
}
