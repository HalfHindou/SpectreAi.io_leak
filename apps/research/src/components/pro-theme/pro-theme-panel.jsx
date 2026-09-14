// The Theme Studio picker panel - code-split off the boot path, loaded on
// first open of the fab. All catalogs come from the shared lite-backdrops
// module (same source of truth as LITE's Themes page).
import { useRef, useState } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import { SCROLL_TINTS } from '@/constants/scrollTints'
import {
  BG_CATALOG, BG_PAPER_CATALOG, storeCustomBg, readCustomBg,
} from '@/pages/lite/components/lite-backdrops'
import { DEFAULT_PRO_BG } from './pro-theme-studio'

// 🪤 These two were a COPY of the section list, not a reference to it — which
// is why a new section could ship to LITE and be absent here. They are now the
// shared catalog; adding a section is one edit in lite-backdrops.js.
const GLASS_CATALOG = BG_CATALOG
const PAPER_CATALOG = BG_PAPER_CATALOG

const LOOKS = [
  { id: 'off', name: 'Spectre', desc: 'The classic Spectre appearance' },
  { id: 'glass', name: 'Glass', desc: 'Frosted panels over a backdrop' },
  { id: 'paper', name: 'Paper', desc: 'Soft light surfaces' },
]
// Heatmap tiles, treemap cells and table rows are TINTED WASHES - they cannot
// carry their own opacity without killing the colour coding, so this shades the
// plane UNDER them. Backdrop behind the data, never through it.
const PLANES = [
  { id: 'clear', name: 'Clear', desc: 'Backdrop shows through the data' },
  { id: 'glass', name: 'Glass', desc: 'Readable, scene still breathes' },
  { id: 'solid', name: 'Solid', desc: 'Data first, backdrop around it' },
]

const DEPTHS = [
  { id: 'clear', name: 'Clear', desc: 'More backdrop' },
  { id: 'standard', name: 'Standard', desc: 'Balanced' },
  { id: 'deep', name: 'Deep', desc: 'More legible' },
]

// The bright/white backdrops were locked here for one release while they moved
// off the glass skin onto Paper (AppShell decides that now). Re-lock with:
//   const isLockedSwatch = (item, mode) => item.light === true || mode === 'bright'
// and pass `locked` through to Swatch again.
function Swatch({ item, kind, active, onPick }) {
  return (
    <button
      type="button"
      className={`pts-swatch${active ? ' pts-swatch--active' : ''}`}
      onClick={onPick}
      title={item.name}
    >
      <span className="pts-swatch-thumb">
        {kind === 'photo'
          ? <img src={`https://images.unsplash.com/${item.photo}?w=200&q=60&auto=format&fit=crop`} alt="" loading="lazy" />
          : <span className="pts-swatch-fill" style={{ background: item.css }} />}
      </span>
      <span className="pts-swatch-name">{item.name}</span>
    </button>
  )
}

export default function ProThemePanel({ onClose }) {
  const look = useSettingsStore((s) => s.proThemeLook) || 'off'
  const bg = useSettingsStore((s) => s.proThemeBg)
  const paper = useSettingsStore((s) => s.proThemePaper) || 'pearl'
  const depth = useSettingsStore((s) => s.proThemeDepth) || 'standard'
  const focus = useSettingsStore((s) => s.proThemeFocus)
  const setLook = useSettingsStore((s) => s.setProThemeLook)
  const setBg = useSettingsStore((s) => s.setProThemeBg)
  const setPaper = useSettingsStore((s) => s.setProThemePaper)
  const setDepth = useSettingsStore((s) => s.setProThemeDepth)
  const plane = useSettingsStore((s) => s.proDataPlane) || 'glass'
  const setPlane = useSettingsStore((s) => s.setProDataPlane)
  const setFocus = useSettingsStore((s) => s.setProThemeFocus)
  // Scrollbar tint is a WHOLE-APP setting (App.jsx stamps data-sb-tint on
  // <html>), and its own copy says "tints every scrollbar across LITE and PRO"
  // — but the picker only ever existed on LITE's Themes page, so a PRO user had
  // no way to reach a setting that changes PRO (founder 08-08: "i dont see
  // scroll bar option in pro"). Same store key, same swatches, one behaviour.
  const scrollTint = useSettingsStore((s) => s.scrollTint)
  const setScrollTint = useSettingsStore((s) => s.setScrollTint)
  // AppShell mounts ProThemeStudio as a SIBLING of the app tree, so the panel
  // has no `.app` ancestor and `.app.app-day-mode .pts-…` never matches (the
  // scrollbar-tint chips carried exactly such a rule and it was dead). Carry
  // the flag on the panel itself - same trick the x-dash portals use.
  const dayMode = useSettingsStore((s) => s.dayMode)
  const fileRef = useRef(null)
  const [photoError, setPhotoError] = useState(null)
  const [photoBusy, setPhotoBusy] = useState(false)

  const activeBg = bg || DEFAULT_PRO_BG
  const hasCustom = !!readCustomBg()
  const isCustomActive = activeBg.mode === 'custom'

  const onUpload = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoError(null)
    setPhotoBusy(true)
    storeCustomBg(file, (data, reason) => {
      setPhotoBusy(false)
      if (!data) { setPhotoError(reason || "Couldn't use that photo"); return }
      // The `scene` slot is unused for a custom backdrop, so it carries a stamp:
      // ProThemeBackdrop keys its resolve on `${mode}:${scene}`, so REPLACING the
      // photo while custom was already selected produced an identical key and the
      // old image stayed on screen - the replace looked like it did nothing.
      setBg({ mode: 'custom', scene: String(Date.now()) })
    })
  }

  return (
    <div className={`pts-panel-wrap${dayMode ? ' pts-panel-wrap--day' : ''}`}>
      <div className="pts-panel-scrim" onClick={onClose} />
      <aside className="pts-panel">
        <div className="pts-head">
          <div>
            <div className="pts-title">Theme studio</div>
            <div className="pts-sub">Choose your surfaces and background</div>
          </div>
          <button type="button" className="pts-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="pts-body">
          <div className="pts-group-title">Look</div>
          <div className="pts-looks">
            {LOOKS.map((lk) => (
              <button
                key={lk.id}
                type="button"
                className={`pts-look${look === lk.id ? ' pts-look--active' : ''} pts-look--${lk.id}`}
                aria-pressed={look === lk.id}
                onClick={() => setLook(lk.id)}
              >
                <span className="pts-look-name">{lk.name}</span>
                <span className="pts-look-desc">{lk.desc}</span>
              </button>
            ))}
          </div>

          {look !== 'off' && (
            <button
              type="button"
              className={`pts-toggle${focus ? ' pts-toggle--on' : ''}`}
              aria-pressed={focus}
              onClick={() => setFocus(!focus)}
            >
              <span>
                <span className="pts-toggle-name">Soft focus</span>
                <span className="pts-toggle-desc">Blur &amp; dim the backdrop for dense reading</span>
              </span>
              <span className="pts-toggle-knob" />
            </button>
          )}

          {look !== 'off' && (
            <div className="pts-group">
              <div className="pts-group-title">Data panels</div>
              <div className="pts-depths">
                {PLANES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`pts-depth${plane === p.id ? ' pts-depth--active' : ''}`}
                    aria-pressed={plane === p.id}
                    onClick={() => setPlane(p.id)}
                  >
                    <span className="pts-depth-name">{p.name}</span>
                    <span className="pts-depth-desc">{p.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pts-group">
            <div className="pts-group-title">Scrollbar</div>
            <div className="pts-sbtints" role="radiogroup" aria-label="Scrollbar tint">
              {SCROLL_TINTS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  role="radio"
                  aria-checked={(scrollTint || 'default') === sc.id}
                  title={sc.label}
                  className={`pts-sbtint${(scrollTint || 'default') === sc.id ? ' pts-sbtint--active' : ''}`}
                  onClick={() => setScrollTint(sc.id)}
                >
                  <span className="pts-sbtint-pill" style={{ background: sc.swatch }} />
                  <span className="pts-sbtint-name">{sc.label}</span>
                </button>
              ))}
            </div>
            <p className="pts-note">Choose a scrollbar color for the app.</p>
          </div>

          {look === 'glass' && (
            <div className="pts-group">
              <div className="pts-group-title">Glass depth</div>
              <div className="pts-depths">
                {DEPTHS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`pts-depth${depth === d.id ? ' pts-depth--active' : ''}`}
                    aria-pressed={depth === d.id}
                    onClick={() => setDepth(d.id)}
                  >
                    <span className="pts-depth-name">{d.name}</span>
                    <span className="pts-depth-desc">{d.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {look === 'glass' && (
            <div className="pts-group">
              <div className="pts-group-title">Yours</div>
              <div className="pts-depths pts-depths--pair">
                <button
                  type="button"
                  className={`pts-depth${activeBg.mode === 'mix' ? ' pts-depth--active' : ''}`}
                  onClick={() => setBg({ mode: 'mix' })}
                >
                  <span className="pts-depth-name">Daily mix</span>
                  <span className="pts-depth-desc">Follows the time of day</span>
                </button>
                {/* ONE photo control, not two. "Your photo" and "Replace" were
                    the same control wearing two labels, and neither opened a
                    picker on a phone: iOS will not open the file dialog for a
                    programmatic .click() on a display:none input. So whenever a
                    tap should open the picker the tile IS a <label> wrapping the
                    input — native activation, which is what LITE has always
                    done. When a photo is stored but not in use, the tap selects
                    it instead; tapping the one in use replaces it. */}
                {(!hasCustom || isCustomActive) ? (
                  <label className={`pts-depth pts-photo${isCustomActive ? ' pts-depth--active' : ''}`}>
                    <span className="pts-depth-name">Your photo</span>
                    <span className="pts-depth-desc">
                      {photoBusy ? 'Adding…' : hasCustom ? 'Tap to replace' : 'Upload an image'}
                    </span>
                    <input
                      ref={fileRef}
                      className="pts-photo-input"
                      type="file"
                      accept="image/*"
                      onChange={onUpload}
                    />
                  </label>
                ) : (
                  <button
                    type="button"
                    className="pts-depth pts-photo"
                    onClick={() => setBg({ mode: 'custom', scene: String(Date.now()) })}
                  >
                    <span className="pts-depth-name">Your photo</span>
                    <span className="pts-depth-desc">Use your upload</span>
                  </button>
                )}
              </div>
              {photoError && <div className="pts-photo-error" role="status">{photoError}</div>}
            </div>
          )}

          {look === 'glass' && GLASS_CATALOG.map((group) => (
            <div key={group.title} className="pts-group">
              <div className="pts-group-title">{group.title}</div>
              <div className="pts-grid">
                {group.items.map((item) => (
                  <Swatch
                    key={item.id}
                    item={item}
                    kind={group.kind}
                    active={activeBg.mode !== 'mix' && activeBg.mode !== 'custom' && activeBg.scene === item.id}
                    onPick={() => setBg({ mode: group.mode, scene: item.id })}
                  />
                ))}
              </div>
            </div>
          ))}

          {look === 'paper' && PAPER_CATALOG.map((group) => (
            <div key={group.title} className="pts-group">
              <div className="pts-group-title">{group.title}</div>
              <div className="pts-grid">
                {group.items.map((item) => (
                  <Swatch
                    key={item.id}
                    item={item}
                    active={paper === item.id}
                    onPick={() => setPaper(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}

          {look === 'off' && (
            <div className="pts-note">
              Choose Glass or Paper to browse backgrounds. Your selection previews immediately.
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
