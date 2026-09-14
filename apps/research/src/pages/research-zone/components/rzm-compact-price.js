// GMGN/DexScreener-style micro-price compression for mobile surfaces.
// Runs of 4+ zeros right after the decimal point collapse into a subscript
// zero-count digit: $0.00000501 -> $0.0₅501 (read: five zeros, then 501).
// String-level (Unicode subscript digits) so it works inside composed
// strings (ranges, converter rate) and flows through child components via
// a wrapped fmtPrice without any JSX changes. Guard group keeps digits
// inside larger numbers (e.g. 10.00001) from matching.

const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉'
const toSub = (n) => String(n).split('').map((d) => SUB_DIGITS[+d] ?? d).join('')
const MICRO_RE = /(^|[^\d.])0\.(0{4,})(\d+)/g

export function compressZeros(str) {
  if (typeof str !== 'string' || str.indexOf('.0000') === -1) return str
  return str.replace(MICRO_RE, (_, pre, zeros, sig) =>
    `${pre}0.0${toSub(zeros.length)}${sig.slice(0, 3)}`)
}
