/**
 * img-settle — let a list image ARRIVE instead of popping.
 *
 * Token logos in the long mobile lists are lazy, so on a cold load (and on a
 * reload) they land in a ragged burst: the row is already drawn, then a logo
 * snaps in at full opacity, then the next one, then the next. Each row's box is
 * already reserved, so nothing MOVES — it is purely the hard on/off that reads
 * as "icons flashing" while the page settles.
 *
 * Usage on any <img>:
 *     <img ref={settleImgRef} onLoad={onImgSettled} … />
 * plus, in that component's CSS:
 *     .thing img[data-settled="0"] { opacity: 0 }
 *     .thing img { transition: opacity 180ms ease }
 *
 * The attribute is only ever "0" (decoding) or "1" (on screen). An image with
 * NO attribute stays fully visible, so a surface that forgets the ref, or a
 * render before hydration, can never end up with an invisible logo.
 *
 * `complete && naturalWidth > 0` covers the case the naive onLoad approach gets
 * wrong: an image already in the HTTP cache finishes before React attaches the
 * handler, so `load` never fires for it and it would sit at opacity 0 forever.
 */
export function settleImgRef(el) {
  if (!el) return
  if (el.complete && el.naturalWidth > 0) {
    el.dataset.settled = '1'
    return
  }
  el.dataset.settled = '0'
}

export function onImgSettled(e) {
  const el = e?.currentTarget
  if (el) el.dataset.settled = '1'
}
