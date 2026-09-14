// PRO Theme Studio (localhost test) - brings the LITE theme system (Glass +
// Paper looks, the full backdrop catalog) to the full PRO app. Mounted by
// AppShell on every page. This file stays on the boot path (the backdrop must
// paint with the shell); the picker panel is code-split into pro-theme-panel
// and only loads on first open.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import lazy from '@/lib/lazy-with-retry'
import useSettingsStore from '@/store/useSettingsStore'
import {
  ALL_PHOTO_SCENES, BG_PHOTO_IDS,
  resolveCssBg, resolvePaperBg, isBrightBg, bgUrl, readCustomBg,
} from '@/pages/lite/components/lite-backdrops'
import { THEME_STUDIO_EVENT } from '@/lib/theme-studio'
import ThemeGlobe from './theme-globe'
import './pro-theme-studio.css'

const ProThemePanel = lazy(() => import('./pro-theme-panel'))

export const DEFAULT_PRO_BG = { mode: 'scene', scene: 'peaks' }

// Never show a black void: if a photo fails (unsplash throttling) or an id is
// unknown, fall back to the graphite gradient.
const FALLBACK_CSS = 'linear-gradient(165deg, #26262c 0%, #131316 60%, #060608 100%)'

// LITE's "Daily mix" is time-of-day: morning shore, daytime mountains,
// night stars (lite-page.jsx bgIndex logic).
function mixPhotoId() {
  const h = new Date().getHours()
  const idx = h >= 5 && h < 12 ? 1 : h < 18 ? 0 : 4
  return BG_PHOTO_IDS[idx]
}

// Exported so any surface that wants to dress itself in the current theme —
// the GM screen does — resolves it through THIS function rather than
// re-deriving the mode ladder and drifting from it.
export function resolveThemeBackdrop(look, bg, paper) {
  return resolveTarget(look, bg, paper)
}

// Daily mix, for a surface that can CROSS-FADE. LITE shows one slice of the mix
// at a time because it has a single still layer; GM has a fader, so it takes the
// whole pool and drifts it — opening on the photo LITE would be showing right
// now, so switching between the two surfaces doesn't jump.
export function mixPhotoPool() {
  const lead = mixPhotoId()
  return [lead, ...BG_PHOTO_IDS.filter((id) => id !== lead)]
}

function resolveTarget(look, bg, paper) {
  if (look === 'paper') return { css: resolvePaperBg(paper || 'pearl') }
  const b = bg || DEFAULT_PRO_BG
  if (b.mode === 'mix') return { photo: bgUrl(mixPhotoId()) }
  if (b.mode === 'custom') {
    const data = readCustomBg()
    return data ? { photo: data } : { css: FALLBACK_CSS }
  }
  if (b.mode === 'scene') {
    const sc = ALL_PHOTO_SCENES.find((s) => s.id === b.scene)
    return sc ? { photo: bgUrl(sc.photo) } : { css: FALLBACK_CSS }
  }
  const css = resolveCssBg(b)
  return css ? { css } : { css: FALLBACK_CSS }
}

// Fixed full-viewport layer behind the app chrome. Photos are PRELOADED and
// the previous backdrop stays up until the new one is ready - a slow unsplash
// response used to leave the scrim alone on screen, which read as "the theme
// didn't load" (founder-reported).
export function ProThemeBackdrop({ look, bg, paper }) {
  const targetKey = `${look}|${bg ? `${bg.mode}:${bg.scene || ''}` : ''}|${paper || ''}`
  const target = useMemo(() => resolveTarget(look, bg, paper), [targetKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [shown, setShown] = useState(target)

  useEffect(() => {
    if (!target.photo) { setShown(target); return undefined }
    let dead = false
    const img = new Image()
    img.onload = () => {
      if (dead) return
      setShown(target)
      // cache the URL for the index.html parse-time preload — the next cold
      // load starts this download seconds before the catalog chunk resolves
      try { localStorage.setItem('spectre-pro-bg-url-v1', target.photo) } catch { /* noop */ }
    }
    img.onerror = () => { if (!dead) setShown({ css: FALLBACK_CSS }) }
    img.src = target.photo
    if (img.complete && img.naturalWidth) setShown(target)
    return () => { dead = true }
  }, [target])

  const bright = look === 'paper' || isBrightBg(bg)
  const style = shown.photo ? { backgroundImage: `url(${shown.photo})` } : { background: shown.css }
  return (
    <div className={`pro-theme-backdrop${bright ? ' pro-theme-backdrop--bright' : ''}`} aria-hidden="true">
      <div className="pts-bgfill" style={style} />
      <div className="pts-scrim" />
    </div>
  )
}

// The studio is now OPENED FROM ELSEWHERE — header, Mission Control, nav
// sidebar, mobile drawer — via the `spectre:theme-studio` event. The floating
// fab it used to carry is gone: a pill parked over the bottom-right of every
// screen sat on a Top Coins row and clipped the watchlist Add tile, and a
// permanent overlay is the wrong home for a control you touch once a week.
// This component still owns the panel, so there is exactly one instance of it.
// The globe orb — a second, always-there way into the studio (founder, 08-04:
// "nice styled globe … make it draggable … should be above monarch right
// bottom icon"). Tap opens the studio; drag repositions it. On release it
// snaps to the nearer screen edge and the spot persists (side + height as a
// viewport fraction, so it survives rotation/resize via CSS clamp).
export default function ProThemeStudio() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = () => setOpen((v) => !v)
    window.addEventListener(THEME_STUDIO_EVENT, onOpen)
    return () => window.removeEventListener(THEME_STUDIO_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <ThemeGlobe />
      {open && (
        <Suspense fallback={null}>
          <ProThemePanel onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
