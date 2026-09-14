import { useEffect, useState } from 'react'
import useSettingsStore from '@/store/useSettingsStore'

/**
 * The PRO Theme Studio skin, resolved once and shared.
 *
 * `AppShell` puts these classes on the `.app` root, and every skin rule in
 * `pro-theme-studio.css` is scoped `.app.pro-paper …` / `.app.pro-glass …`.
 * Anything React PORTALS into `document.body` therefore lands OUTSIDE that
 * scope and silently loses the whole theme — which is exactly what happened
 * to the X-Dash drawers: they already mirrored `.app` / `.app-day-mode` /
 * `.nav-sidebar-*` onto their portal wrapper, but not the skin, so a bright
 * theme gave them light card backgrounds with the dark skin's ink on top.
 *
 * Rather than let each portal re-derive this (and drift — resolving `bright`
 * needs the 27KB backdrop catalog, loaded lazily), it lives here and both
 * AppShell and the portals read the same answer.
 *
 * `bright` is false until the deferred chunk lands, which only ever means
 * "not bright" for a frame — and `ready` gates the classes so a themed user
 * never gets a frame of skin markup with no stylesheet behind it.
 */
export default function useProThemeSkin() {
  const look = useSettingsStore((s) => s.proThemeLook) || 'off'
  const bg = useSettingsStore((s) => s.proThemeBg)
  const paper = useSettingsStore((s) => s.proThemePaper)
  const depth = useSettingsStore((s) => s.proThemeDepth)
  const dataPlane = useSettingsStore((s) => s.proDataPlane) || 'glass'
  const focus = useSettingsStore((s) => s.proThemeFocus)

  // `isBrightBg` lives in the backdrop catalog and its resolveBgDef walks every
  // pool, so a static import would put the WHOLE catalog on the boot chunk for
  // a single boolean.
  const [bright, setBright] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let done = false
    const load = () => Promise.all([
      import('@/components/pro-theme/pro-theme-studio'),
      import('@/pages/lite/components/lite-backdrops'),
    ])
      .then(([, cat]) => {
        if (done) return
        setBright(look === 'glass' && cat.isBrightBg(bg))
        setReady(true)
      })
      .catch(() => {})
    if (look !== 'off') { load(); return () => { done = true } }
    const ric = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(load, { timeout: 3000 })
      : setTimeout(load, 1200)
    return () => {
      done = true
      if (typeof cancelIdleCallback === 'function' && typeof ric === 'number') cancelIdleCallback(ric)
      else clearTimeout(ric)
    }
  }, [look, bg])

  // A BRIGHT backdrop runs the PAPER skin, not the glass one — it is the same
  // light, day-mode-native treatment, just with the chosen wallpaper behind it
  // instead of the pearl canvas (founder, 08-03: "paper is perfect. the bright
  // ones are like paper but with the other backgrounds"). Glass exists to make
  // DARK smoke read over a photo; on a white wallpaper that machinery has to be
  // inverted surface by surface, which is exactly the bug this replaces.
  const className = !ready ? '' : (look === 'glass'
    ? (bright
      ? ' pro-paper pro-bright'
      : ` pro-glass${depth === 'clear' ? ' pro-depth-clear' : depth === 'deep' ? ' pro-depth-deep' : ''}`)
    : look === 'paper' ? ' pro-paper' : '')
    + (look !== 'off' && focus ? ' pro-focus' : '')
    + (look !== 'off' && dataPlane !== 'glass' ? ` pro-plane-${dataPlane}` : '')

  return {
    look,
    bg,
    paper,
    bright,
    ready,
    className,
    // Paper is a light look → it must flow through the page-level dayMode PROPS
    // too (RZ/welcome components read the prop, not the .app class); Glass
    // forces dark unless the picked backdrop is bright.
    forcesDay: look === 'paper' || bright,
    forcesDark: look === 'glass' && !bright,
  }
}
