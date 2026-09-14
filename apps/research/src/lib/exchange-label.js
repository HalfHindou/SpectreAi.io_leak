/**
 * shortExchange — collapse a raw upstream venue string to the code a trader
 * recognises.
 *
 * `tokenData.exchange` is whatever the upstream handed us, and Yahoo is not
 * consistent: the same AAPL listing arrives as "NMS", "NasdaqGS" or
 * "NASDAQ NMS - GLOBAL MARKET" depending on the endpoint. The long form
 * overflowed every slot it was rendered into — most visibly the hero's corner
 * badge, where it wrapped straight across the logo and read as a corrupted
 * image (founder report 2026-08-02, on AAPL and SPCX).
 */
export function shortExchange(raw) {
  const s = String(raw || '').toUpperCase().trim()
  if (!s) return null
  if (/NASDAQ|\bNMS\b|\bNGS\b|\bNCM\b|\bNGM\b/.test(s)) return 'NASDAQ'
  if (/NYSE|\bNYQ\b/.test(s)) return 'NYSE'
  if (/\bARCA\b|\bPCX\b/.test(s)) return 'ARCA'
  if (/AMEX|\bASE\b|\bAMX\b/.test(s)) return 'AMEX'
  if (/CBOE|\bBATS\b|\bBTS\b/.test(s)) return 'CBOE'
  if (/\bOTC\b|\bPNK\b|\bOBB\b/.test(s)) return 'OTC'
  if (/\bLSE\b|LONDON/.test(s)) return 'LSE'
  if (/\bTSX\b|TORONTO/.test(s)) return 'TSX'
  // Unknown venue: first word only, never long enough to wrap a badge.
  return s.split(/[\s\-–—/,]+/)[0].slice(0, 6)
}
