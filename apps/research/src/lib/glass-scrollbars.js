/* Pairs with the "Glass Scrollbars" block in index.css.
   Scrollbars are invisible at rest; this stamps `data-scrolling` on whatever
   element is actually scrolling (capture phase - element scroll events don't
   bubble) so the CSS reveals the pill only while motion happens, then hides
   it again - true macOS-overlay behavior. Works for both the webkit-pseudo
   path (glass pills) and the standard-property path (Firefox scrollbar-color). */
const timers = new WeakMap()
const HIDE_MS = 900

window.addEventListener(
  'scroll',
  (e) => {
    let el = e.target
    if (el === document || el === window) el = document.documentElement
    if (!(el instanceof Element)) return
    if (!el.hasAttribute('data-scrolling')) el.setAttribute('data-scrolling', '')
    clearTimeout(timers.get(el))
    timers.set(el, setTimeout(() => el.removeAttribute('data-scrolling'), HIDE_MS))
  },
  { capture: true, passive: true }
)
