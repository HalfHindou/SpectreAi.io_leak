/**
 * Settings section - appearance toggles, currency grid, language grid.
 * All changes apply instantly (no pending/apply pattern).
 */
import { CURRENCY_LIST, LANGUAGE_LIST } from '@/lib/currencyConfig'

export default function UdSettingsSection({
  currency, language, dayMode, showMoodWall, tokenColoring,
  onCurrencyChange, onLanguageChange, onToggleDayMode, onToggleMoodWall, onToggleTokenColoring
}) {
  return (
    <section className="ud-card ud-settings">
      <h2 className="ud-card-title">Settings</h2>

      {/* Appearance toggles */}
      <div className="ud-settings-group">
        <span className="ud-settings-group-label">Appearance</span>

        <div className="ud-settings-toggle-row" onClick={onToggleDayMode}>
          <div className="ud-settings-toggle-info">
            <svg className="ud-settings-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {dayMode
                ? <><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></>
                : <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              }
            </svg>
            <span className="ud-settings-toggle-label">{dayMode ? 'Day Mode' : 'Dark Mode'}</span>
          </div>
          <div className={`ud-toggle${dayMode ? ' is-on' : ''}`}>
            <div className="ud-toggle-thumb" />
          </div>
        </div>

        <div className="ud-settings-toggle-row" onClick={onToggleMoodWall}>
          <div className="ud-settings-toggle-info">
            <svg className="ud-settings-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
            <span className="ud-settings-toggle-label">Mood Walls</span>
          </div>
          <div className={`ud-toggle${showMoodWall ? ' is-on' : ''}`}>
            <div className="ud-toggle-thumb" />
          </div>
        </div>

        <div className="ud-settings-toggle-row" onClick={onToggleTokenColoring}>
          <div className="ud-settings-toggle-info">
            <svg className="ud-settings-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.7 1.5-1.5 0-.39-.15-.74-.39-1.04-.23-.29-.37-.63-.37-1.02 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.17-4.49-8.94-10-8.94z" /><circle cx="7.5" cy="11.5" r="1.5" /><circle cx="12" cy="7.5" r="1.5" /><circle cx="16.5" cy="11.5" r="1.5" /></svg>
            <span className="ud-settings-toggle-label">Token Coloring</span>
          </div>
          <div className={`ud-toggle${tokenColoring ? ' is-on' : ''}`}>
            <div className="ud-toggle-thumb" />
          </div>
        </div>
      </div>

      {/* Currency */}
      <div className="ud-settings-group">
        <span className="ud-settings-group-label">Currency</span>
        <div className="ud-settings-grid">
          {CURRENCY_LIST.map((c) => (
            <button
              key={c.code}
              type="button"
              className={`ud-settings-chip${currency === c.code ? ' is-active' : ''}`}
              onClick={() => onCurrencyChange(c.code)}
            >
              <span className="ud-settings-chip-flag">{c.flag}</span>
              <span className="ud-settings-chip-code">{c.code}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="ud-settings-group">
        <span className="ud-settings-group-label">Language</span>
        <div className="ud-settings-grid">
          {LANGUAGE_LIST.map((l) => (
            <button
              key={l.code}
              type="button"
              className={`ud-settings-chip${language === l.code ? ' is-active' : ''}`}
              onClick={() => onLanguageChange(l.code)}
            >
              <span className="ud-settings-chip-flag">{l.flag}</span>
              <span className="ud-settings-chip-code">{l.nativeName}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
