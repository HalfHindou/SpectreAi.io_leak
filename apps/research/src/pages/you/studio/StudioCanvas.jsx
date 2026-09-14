/**
 * Spectre Studio — Market Intelligence Canvas (Phase 1)
 *
 * A freeform canvas where users drag-and-drop live data widgets
 * ("stickers") onto themed backgrounds. Bloomberg Terminal meets Pinterest.
 *
 * Architecture:
 *   - Top Toolbar: theme dropdown, presets, auto-compose, export, share, undo
 *   - Canvas: themed background with draggable stickers
 *   - Right Panel: [+Add] [Layers] [Edit] tabs
 *
 * Phase 2: CORE stickers render live data. Other categories show placeholders.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { STICKER_REGISTRY, STICKER_CATEGORIES } from './sticker-registry'
import { STUDIO_THEMES, getThemeList } from './studio-themes'
import { STUDIO_PRESETS } from './studio-presets'
import { getStickerComponent } from './sticker-renderer'
import StickerWrapper from './stickers/StickerWrapper'
import AutoComposeModal from './AutoComposeModal'
import './StudioCanvas.css'


export default function StudioCanvas({ studio }) {
  const {
    theme,
    stickers,
    panelOpen,
    panelTab,
    selectedSticker,
    canUndo,
    addSticker,
    removeSticker,
    updateSticker,
    bringToFront,
    selectSticker,
    setTheme,
    setPanelOpen,
    setPanelTab,
    loadPreset,
    clearCanvas,
    undo,
  } = studio
  const canvasRef = useRef(null)
  const [autoComposeOpen, setAutoComposeOpen] = useState(false)

  // Auto-Compose handler — builds a sticker layout from preferences
  const handleAutoCompose = useCallback(({ mood, focus, density }) => {
    // Determine sticker set based on preferences
    const tokenSet = focus === 'btc' ? ['BTC']
      : focus === 'btc-eth' ? ['BTC', 'ETH']
      : focus === 'top-coins' ? ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE']
      : ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE', 'ADA', 'DOT', 'LINK']

    const stickerCount = density === 'minimal' ? 5 : density === 'balanced' ? 9 : 15

    // Build sticker list based on mood
    const stickerTypes = []
    // Always include: big-price for primary token, fear-greed-gauge
    stickerTypes.push({ type: 'big-price', token: tokenSet[0] })
    stickerTypes.push({ type: 'fear-greed-gauge' })

    if (mood === 'breakout' || mood === 'altseason') {
      stickerTypes.push({ type: 'line-chart', token: tokenSet[0] })
      stickerTypes.push({ type: 'top-coins-ladder' })
      stickerTypes.push({ type: 'narrative-tag', data: { text: mood === 'breakout' ? 'Breakout' : 'Altseason' } })
    } else if (mood === 'risk-off') {
      stickerTypes.push({ type: 'regime-badge' })
      stickerTypes.push({ type: 'correlation-breakdown' })
      stickerTypes.push({ type: 'narrative-tag', data: { text: 'Risk Off' } })
    } else if (mood === 'earnings') {
      stickerTypes.push({ type: 'macro-strip' })
      stickerTypes.push({ type: 'signal-stack' })
    } else if (mood === 'mean-rev') {
      stickerTypes.push({ type: 'liquidation-bars' })
      stickerTypes.push({ type: 'funding-strip' })
      stickerTypes.push({ type: 'oi-pulse' })
    } else { // chop
      stickerTypes.push({ type: 'ct-mood' })
      stickerTypes.push({ type: 'breadth-meter' })
      stickerTypes.push({ type: 'narrative-tag', data: { text: 'Chop Zone' } })
    }

    // Add more based on density
    if (tokenSet.length > 1) {
      tokenSet.slice(1, density === 'minimal' ? 1 : 3).forEach(t => {
        stickerTypes.push({ type: 'big-price', token: t })
      })
    }

    if (stickerCount >= 8) {
      stickerTypes.push({ type: 'dominance-strip' })
      stickerTypes.push({ type: 'quote-block' })
      stickerTypes.push({ type: 'candle-ghost', token: tokenSet[0] })
    }
    if (stickerCount >= 12) {
      stickerTypes.push({ type: 'ticker-tape' })
      stickerTypes.push({ type: 'smart-money-flow' })
      stickerTypes.push({ type: 'whale-activity' })
    }
    if (stickerCount >= 15) {
      stickerTypes.push({ type: 'market-clock' })
      stickerTypes.push({ type: 'audio-visualizer' })
      stickerTypes.push({ type: 'sector-heatmap' })
    }

    // Trim to desired count and generate positions
    const finalStickers = stickerTypes.slice(0, stickerCount).map((s, i) => ({
      ...s,
      x: 0.05 + (i % 4) * 0.23,
      y: 0.05 + Math.floor(i / 4) * 0.28,
      scale: s.type === 'big-price' && i === 0 ? 1.3 : 1,
    }))

    loadPreset(finalStickers)
  }, [loadPreset])

  // Load morning-brief preset on first mount if canvas is empty
  const hasLoadedRef = useRef(false)
  useEffect(() => {
    if (!hasLoadedRef.current && stickers.length === 0) {
      hasLoadedRef.current = true
      const preset = STUDIO_PRESETS.find(p => p.id === 'morning-brief')
      if (preset) {
        loadPreset(preset.stickers)
        setTheme(preset.theme || 'zen-minimal')
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Deselect on canvas background click
  const handleCanvasClick = useCallback((e) => {
    if (e.target === canvasRef.current || e.target.classList.contains('sc-canvas-bg')) {
      selectSticker(null)
    }
  }, [selectSticker])

  // Close dropdowns on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        selectSticker(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectSticker])

  // Get theme object
  const themeObj = STUDIO_THEMES[theme] || STUDIO_THEMES['zen-minimal']
  const isLightTheme = themeObj.group === 'light' || themeObj.group === 'color'
  const isStreetArt = theme === 'street-art'

  return (
    <div
      className={`sc-wrapper${isLightTheme ? ' sc-light' : ''}`}
      data-studio-theme={theme}
    >
      {/* Top Toolbar */}
      <StudioToolbar
        theme={theme}
        themeObj={themeObj}
        onThemeChange={setTheme}
        onPresetLoad={(preset) => { loadPreset(preset.stickers); setTheme(preset.theme || theme) }}
        onAutoCompose={() => setAutoComposeOpen(true)}
        onUndo={undo}
        isStreetArt={isStreetArt}
        stickerCount={stickers.length}
      />

      {/* Main Content: Canvas + Panel */}
      <div className="sc-content">
        {/* Canvas */}
        <div
          className="sc-canvas"
          ref={canvasRef}
          onClick={handleCanvasClick}
          style={{ background: themeObj.canvasBg }}
        >
          {/* Theme ambient layer */}
          <div className={`sc-canvas-bg sc-ambient-${theme}`} />

          {/* Stickers */}
          {stickers.filter(s => s.visible !== false).map(sticker => (
            <StickerWrapper
              key={sticker.id}
              sticker={sticker}
              isSelected={selectedSticker === sticker.id}
              onSelect={() => { selectSticker(sticker.id); setPanelTab('edit') }}
              onUpdate={(updates) => updateSticker(sticker.id, updates)}
              onRemove={() => removeSticker(sticker.id)}
              onBringToFront={() => bringToFront(sticker.id)}
              canvasRef={canvasRef}
              themeId={theme}
            >
              <RenderSticker sticker={sticker} themeObj={themeObj} />
            </StickerWrapper>
          ))}

          {/* Empty state — only if no stickers AND not loading preset */}
          {stickers.length === 0 && (
            <div className="sc-empty">
              <div className="sc-empty-title">Your Canvas</div>
              <div className="sc-empty-text">
                Add data stickers from the panel, or load a preset to get started.
              </div>
            </div>
          )}
        </div>

        {/* Right Panel */}
        {panelOpen && (
          <StickerPanel
            tab={panelTab}
            onTabChange={setPanelTab}
            onClose={() => setPanelOpen(false)}
            onAddSticker={addSticker}
            stickers={stickers}
            selectedSticker={selectedSticker ? stickers.find(s => s.id === selectedSticker) : null}
            onUpdateSticker={updateSticker}
            onRemoveSticker={removeSticker}
            onReorderStickers={() => {}} // Phase 4
            isStreetArt={isStreetArt}
            themeObj={themeObj}
          />
        )}

        {/* Panel toggle (when closed) */}
        {!panelOpen && (
          <button
            className="sc-panel-toggle"
            onClick={() => setPanelOpen(true)}
            title="Open panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>

      <AutoComposeModal
        open={autoComposeOpen}
        onClose={() => setAutoComposeOpen(false)}
        onCompose={handleAutoCompose}
      />
    </div>
  )
}


/**
 * RenderSticker — Resolves a sticker type to its real component.
 * Falls back to StickerPlaceholder for unimplemented types.
 */
function RenderSticker({ sticker, themeObj }) {
  const Component = getStickerComponent(sticker.type)
  if (Component) {
    return <Component sticker={sticker} themeObj={themeObj} />
  }
  return <StickerPlaceholder sticker={sticker} themeObj={themeObj} />
}

/**
 * StickerPlaceholder — renders a gray box with the sticker name
 * for sticker types not yet implemented (Phase 3+).
 */
function StickerPlaceholder({ sticker, themeObj }) {
  const reg = STICKER_REGISTRY.find(r => r.id === sticker.type)
  const name = reg ? reg.name : sticker.type
  const cat = reg ? reg.category : '?'

  return (
    <div
      className="sc-sticker-placeholder"
      style={{
        width: reg ? reg.defaultSize.w : 200,
        height: reg ? reg.defaultSize.h : 100,
        background: themeObj.stickerBg.background,
        border: themeObj.stickerBg.border,
        boxShadow: themeObj.stickerBg.shadow,
        backdropFilter: themeObj.stickerBg.backdropFilter || undefined,
        color: themeObj.stickerText.secondary,
      }}
    >
      <span className="sc-ph-cat">{cat.toUpperCase()}</span>
      <span className="sc-ph-name">{name}</span>
      {sticker.token && <span className="sc-ph-token">{sticker.token}</span>}
    </div>
  )
}


/* ═══════════════════════════════════════════════════════
   Top Toolbar
   ═══════════════════════════════════════════════════════ */

function StudioToolbar({ theme, themeObj, onThemeChange, onPresetLoad, onAutoCompose, onUndo, isStreetArt, stickerCount }) {
  const [themeDropdown, setThemeDropdown] = useState(false)
  const [presetDropdown, setPresetDropdown] = useState(false)
  const themeRef = useRef(null)
  const presetRef = useRef(null)

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (themeRef.current && !themeRef.current.contains(e.target)) setThemeDropdown(false)
      if (presetRef.current && !presetRef.current.contains(e.target)) setPresetDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const themes = getThemeList()
  const groups = ['dark', 'light', 'color', 'mood']
  const groupNames = { dark: 'Dark Themes', light: 'Light Themes', color: 'Color Themes', mood: 'Mood Themes' }

  const currentThemeName = (STUDIO_THEMES[theme] || {}).name || 'Zen Minimal'

  return (
    <div className="sc-toolbar" style={{ background: themeObj.toolbarBg }}>
      {/* Theme Dropdown */}
      <div className="sc-tb-dropdown-wrap" ref={themeRef}>
        <button
          className={`sc-tb-btn${themeDropdown ? ' active' : ''}`}
          onClick={() => { setThemeDropdown(!themeDropdown); setPresetDropdown(false) }}
        >
          <span className="sc-tb-dot" style={{ background: themeObj.accentColor }} />
          <span>{currentThemeName}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </button>

        {themeDropdown && (
          <div className="sc-dropdown sc-dropdown-theme">
            {groups.map(group => {
              const groupThemes = themes.filter(t => t.group === group)
              if (groupThemes.length === 0) return null
              return (
                <div key={group} className="sc-dd-group">
                  <div className="sc-dd-group-label">{groupNames[group]}</div>
                  {groupThemes.map(t => (
                    <button
                      key={t.id}
                      className={`sc-dd-item${theme === t.id ? ' active' : ''}`}
                      onClick={() => { onThemeChange(t.id); setThemeDropdown(false) }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Presets Dropdown */}
      <div className="sc-tb-dropdown-wrap" ref={presetRef}>
        <button
          className={`sc-tb-btn${presetDropdown ? ' active' : ''}`}
          onClick={() => { setPresetDropdown(!presetDropdown); setThemeDropdown(false) }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
          <span>Presets</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </button>

        {presetDropdown && (
          <div className="sc-dropdown">
            {STUDIO_PRESETS
              .filter(p => !p.artOnly || isStreetArt)
              .map(p => (
                <button
                  key={p.id}
                  className="sc-dd-item"
                  onClick={() => { onPresetLoad(p); setPresetDropdown(false) }}
                >
                  <span>{p.name}</span>
                  {p.artOnly && <span className="sc-dd-badge">ART</span>}
                </button>
              ))
            }
          </div>
        )}
      </div>

      {/* Auto-Compose */}
      <button className="sc-tb-btn sc-tb-btn-accent" onClick={onAutoCompose}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <span>Auto-Compose</span>
      </button>

      <div className="sc-tb-spacer" />

      {/* Right side actions */}
      <span className="sc-tb-count">{stickerCount} stickers</span>

      <button className="sc-tb-btn sc-tb-btn-icon" onClick={onUndo} title="Undo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>
    </div>
  )
}


/* ═══════════════════════════════════════════════════════
   Right Panel — [+Add] [Layers] [Edit]
   ═══════════════════════════════════════════════════════ */

function StickerPanel({
  tab,
  onTabChange,
  onClose,
  onAddSticker,
  stickers,
  selectedSticker,
  onUpdateSticker,
  onRemoveSticker,
  isStreetArt,
  themeObj,
}) {
  return (
    <div className="sc-panel">
      {/* Panel Header — tabs */}
      <div className="sc-panel-header">
        <div className="sc-panel-tabs">
          <button
            className={`sc-panel-tab${tab === 'add' ? ' active' : ''}`}
            onClick={() => onTabChange('add')}
          >+ Add</button>
          <button
            className={`sc-panel-tab${tab === 'layers' ? ' active' : ''}`}
            onClick={() => onTabChange('layers')}
          >Layers</button>
          <button
            className={`sc-panel-tab${tab === 'edit' ? ' active' : ''}`}
            onClick={() => onTabChange('edit')}
          >Edit</button>
        </div>
        <button className="sc-panel-close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Panel Body */}
      <div className="sc-panel-body">
        {tab === 'add' && (
          <AddTab
            onAddSticker={onAddSticker}
            isStreetArt={isStreetArt}
          />
        )}
        {tab === 'layers' && (
          <LayersTab
            stickers={stickers}
            onUpdateSticker={onUpdateSticker}
            onRemoveSticker={onRemoveSticker}
          />
        )}
        {tab === 'edit' && (
          <EditTab
            sticker={selectedSticker}
            onUpdateSticker={onUpdateSticker}
            onRemoveSticker={onRemoveSticker}
          />
        )}
      </div>
    </div>
  )
}


/* ─── Add Tab ─────────────────────────────────────── */

function AddTab({ onAddSticker, isStreetArt }) {
  const categories = STICKER_CATEGORIES.filter(c => !c.artOnly || isStreetArt)

  return (
    <div className="sc-add-tab">
      {categories.map(cat => {
        const catStickers = STICKER_REGISTRY.filter(s => s.category === cat.id)
        if (catStickers.length === 0) return null

        return (
          <div key={cat.id} className="sc-add-section">
            <div className="sc-add-section-label">
              <span className="sc-add-section-icon">{cat.icon || '\u25CF'}</span>
              <span>{cat.name}</span>
            </div>
            <div className="sc-add-grid">
              {catStickers.map(sticker => (
                <button
                  key={sticker.id}
                  className="sc-add-item"
                  onClick={() => onAddSticker(sticker.id, {
                    token: sticker.defaultToken,
                    data: sticker.defaultData || {},
                  })}
                >
                  <span className="sc-add-plus">+</span>
                  <span className="sc-add-name">{sticker.name}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}


/* ─── Layers Tab ──────────────────────────────────── */

function LayersTab({ stickers, onUpdateSticker, onRemoveSticker }) {
  if (stickers.length === 0) {
    return <div className="sc-layers-empty">No stickers on canvas.</div>
  }

  // Sort by zIndex descending (top layer first)
  const sorted = [...stickers].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))

  return (
    <div className="sc-layers-tab">
      {sorted.map(sticker => {
        const reg = STICKER_REGISTRY.find(r => r.id === sticker.type)
        const name = reg ? reg.name : sticker.type

        return (
          <div key={sticker.id} className="sc-layer-row">
            <button
              className={`sc-layer-vis${sticker.visible === false ? ' off' : ''}`}
              onClick={() => onUpdateSticker(sticker.id, { visible: sticker.visible === false ? true : false })}
              title="Toggle visibility"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {sticker.visible !== false
                  ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                  : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><line x1="1" y1="1" x2="23" y2="23" /></>
                }
              </svg>
            </button>
            <button
              className={`sc-layer-lock${sticker.locked ? ' on' : ''}`}
              onClick={() => onUpdateSticker(sticker.id, { locked: !sticker.locked })}
              title="Toggle lock"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {sticker.locked
                  ? <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>
                  : <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></>
                }
              </svg>
            </button>
            <span className="sc-layer-name">{name}</span>
            {sticker.token && <span className="sc-layer-token">{sticker.token}</span>}
          </div>
        )
      })}
    </div>
  )
}


/* ─── Edit Tab ────────────────────────────────────── */

const TOKEN_OPTIONS = ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE', 'ADA', 'DOT', 'LINK', 'MATIC', 'XRP']

function EditTab({ sticker, onUpdateSticker, onRemoveSticker }) {
  if (!sticker) {
    return (
      <div className="sc-edit-empty">
        Select a sticker on the canvas to edit its properties.
      </div>
    )
  }

  const reg = STICKER_REGISTRY.find(r => r.id === sticker.type)
  const name = reg ? reg.name : sticker.type

  return (
    <div className="sc-edit-tab">
      <div className="sc-edit-title">{name}</div>

      {/* Token selector (for price stickers) */}
      {sticker.token && (
        <div className="sc-edit-row">
          <span className="sc-edit-label">Token</span>
          <select
            className="sc-edit-select"
            value={sticker.token}
            onChange={(e) => onUpdateSticker(sticker.id, { token: e.target.value })}
          >
            {TOKEN_OPTIONS.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      )}

      {/* Scale slider */}
      <div className="sc-edit-row">
        <span className="sc-edit-label">Size</span>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.05"
          value={sticker.scale || 1}
          onChange={(e) => onUpdateSticker(sticker.id, { scale: parseFloat(e.target.value) })}
          className="sc-edit-slider"
        />
        <span className="sc-edit-value">{Math.round((sticker.scale || 1) * 100)}%</span>
      </div>

      {/* Opacity slider */}
      <div className="sc-edit-row">
        <span className="sc-edit-label">Opacity</span>
        <input
          type="range"
          min="0.2"
          max="1"
          step="0.05"
          value={sticker.opacity || 1}
          onChange={(e) => onUpdateSticker(sticker.id, { opacity: parseFloat(e.target.value) })}
          className="sc-edit-slider"
        />
        <span className="sc-edit-value">{Math.round((sticker.opacity || 1) * 100)}%</span>
      </div>

      {/* Rotation slider */}
      <div className="sc-edit-row">
        <span className="sc-edit-label">Rotation</span>
        <input
          type="range"
          min="-45"
          max="45"
          step="1"
          value={sticker.rotation || 0}
          onChange={(e) => onUpdateSticker(sticker.id, { rotation: parseInt(e.target.value) })}
          className="sc-edit-slider"
        />
        <span className="sc-edit-value">{sticker.rotation || 0}&deg;</span>
      </div>

      {/* Delete */}
      <button
        className="sc-edit-delete"
        onClick={() => onRemoveSticker(sticker.id)}
      >
        Delete Sticker
      </button>
    </div>
  )
}
