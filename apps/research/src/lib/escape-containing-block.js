/**
 * escapeContainingBlocks — make `position: fixed` mean the VIEWPORT again.
 * ─────────────────────────────────────────────────────────────────────────
 * Extracted 2026-08-17 from use-chart-fullscreen.js, which paid for every line
 * of it. It was needed a second time the moment the Research Zone agent chat
 * grew a pop-out window, and a second copy of this reasoning would have drifted
 * from the first — so it lives in one place and both callers use it.
 *
 * TWO separate ancestor problems, and an overlay needs both undone:
 *
 * 1. CONTAINING BLOCK. `position: fixed` anchors to the nearest ancestor
 *    carrying transform / filter / perspective / will-change — not to the
 *    viewport. Overriding the PROPERTY is not enough: an element whose
 *    ANIMATION has keyframes touching transform keeps the containing block even
 *    when the computed value reads `none`, so the animation itself has to be
 *    suspended. Measured on the liquidation page: property-only left the
 *    overlay at (244, 337); killing the animation snapped it to (0, 0).
 *
 *    CSS CONTAINMENT is the second half of this and was missing until
 *    2026-08-27: `contain: layout | paint | strict | content` traps fixed
 *    descendants just as hard as a transform. Verified in Chrome 151 with an
 *    isolated probe - a fixed `inset: 0` child of a `contain: layout` host
 *    resolved to the HOST's box, not the viewport.
 *
 *    `container-type` is ENGINE-DEPENDENT, so we ASK the engine rather than
 *    guess (containerTypeTrapsFixed below). It applies layout containment per
 *    spec, so it should trap - WebKit does, and that is what broke the agent
 *    pop-out inside Traders Corner, whose `.tc` / `.tc-center` columns are
 *    query containers (founder, Safari, 2026-08-27). Chrome 151 does NOT trap,
 *    for either `inline-size` or `size`.
 *    🪤 Do NOT "just neutralize it everywhere". Forcing `container-type: normal`
 *    reflows the page BEHIND the overlay wherever container queries drive the
 *    layout: measured on Research Zone at a 1360px viewport it swung the left
 *    rail 240px -> 400px, the centre column 620px -> 380px and the hero 106px
 *    -> 308px tall. We pay that only on engines that would otherwise trap the
 *    overlay outright, where a reflow behind it is the lesser damage.
 *
 * 2. STACKING CONTEXT. An ancestor that is `position: relative; z-index: 1`
 *    caps our z-index inside it, so the overlay painted UNDER the header and
 *    the sidebar however high its own z-index went.
 *
 * 🪤 Restore PER PROPERTY, never via a cssText snapshot. These ancestors are app
 * chrome that other code writes to while the overlay is open; putting a whole
 * cssText back would revert those writes too. Absent stays absent, !important
 * stays !important.
 *
 * @param {Element} el the overlay element (its ANCESTORS get patched)
 * @returns {() => void} restore
 */

const CONTAINING_BLOCK_KEYS = ['transform', 'filter', 'perspective', 'backdropFilter', 'translate', 'rotate', 'scale']

/**
 * Does THIS engine make a query container a containing block for
 * `position: fixed`? Probed once off-screen and cached - the answer cannot
 * change for the life of the document. Chrome 151 says no, WebKit says yes.
 */
let cqTrapsFixed = null
function containerTypeTrapsFixed() {
  if (cqTrapsFixed !== null) return cqTrapsFixed
  cqTrapsFixed = false
  try {
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;top:-9999px;left:0;width:100px;height:100px;container-type:inline-size'
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:10px;pointer-events:none'
    host.appendChild(probe)
    document.body.appendChild(host)
    // Trapped -> the probe resolves against the 100px host, not the viewport.
    cqTrapsFixed = Math.round(probe.getBoundingClientRect().width) !== Math.round(window.innerWidth)
    host.remove()
  } catch { cqTrapsFixed = false }
  return cqTrapsFixed
}

export default function escapeContainingBlocks(el) {
  if (!el) return () => {}

  const patched = new Map() // element -> Map<prop, {value, priority}>
  const setProp = (node, prop, value) => {
    let saved = patched.get(node)
    if (!saved) { saved = new Map(); patched.set(node, saved) }
    if (!saved.has(prop)) {
      saved.set(prop, { value: node.style.getPropertyValue(prop), priority: node.style.getPropertyPriority(prop) })
    }
    node.style.setProperty(prop, value, 'important')
  }

  for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
    const s = getComputedStyle(node)

    const byProp = s.transform !== 'none' || s.filter !== 'none' ||
      s.perspective !== 'none' || s.willChange !== 'auto' ||
      (s.backdropFilter && s.backdropFilter !== 'none') ||
      /\b(layout|paint|strict|content)\b/.test(s.contain || '')
    const byContainerType = !!s.containerType && s.containerType !== 'normal' && containerTypeTrapsFixed()
    const byAnimation = typeof node.getAnimations === 'function' && node.getAnimations().some((a) => {
      try {
        return a.effect?.getKeyframes?.().some((k) => CONTAINING_BLOCK_KEYS.some((p) => p in k))
      } catch { return false }
    })

    if (byProp || byAnimation || byContainerType) {
      for (const prop of ['transform', 'filter', 'backdrop-filter', '-webkit-backdrop-filter', 'perspective']) {
        setProp(node, prop, 'none')
      }
      setProp(node, 'will-change', 'auto')
      // Containment - restored on teardown, so the paint isolation and the
      // container queries come back the moment the overlay closes.
      if (/\b(layout|paint|strict|content)\b/.test(s.contain || '')) setProp(node, 'contain', 'none')
      if (byContainerType) setProp(node, 'container-type', 'normal')
      // Only when the animation is the culprit — an opacity-only pulse
      // elsewhere creates no containing block and should keep running.
      if (byAnimation) setProp(node, 'animation', 'none')
    }

    const stacks = (s.position !== 'static' && s.zIndex !== 'auto') ||
      parseFloat(s.opacity) < 1 || s.isolation === 'isolate' ||
      (s.mixBlendMode && s.mixBlendMode !== 'normal')
    if (stacks) {
      if (s.position !== 'static' && s.zIndex !== 'auto') setProp(node, 'z-index', '2147483000')
      if (parseFloat(s.opacity) < 1) setProp(node, 'opacity', '1')
      if (s.isolation === 'isolate') setProp(node, 'isolation', 'auto')
      if (s.mixBlendMode && s.mixBlendMode !== 'normal') setProp(node, 'mix-blend-mode', 'normal')
    }
  }

  return () => {
    for (const [node, props] of patched) {
      for (const [prop, { value, priority }] of props) {
        if (value) node.style.setProperty(prop, value, priority)
        else node.style.removeProperty(prop)
      }
    }
    patched.clear()
  }
}
