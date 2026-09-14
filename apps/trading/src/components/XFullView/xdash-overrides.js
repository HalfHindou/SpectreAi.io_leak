/**
 * Manual cg_id overrides for the X Dash views (inline column + full view).
 *
 * Some tokens are keyed in X Dash under a name that does NOT match the
 * on-chain symbol, or share a ticker with several CoinGecko tokens so a
 * symbol search resolves to the wrong asset.
 *
 * $ANSEM is the canonical case: the runner is the Solana pump.fun token
 * "The Black Bull" (cg_id `the-black-bull`), but 3 different CoinGecko tokens
 * share the ticker "ANSEM" — so a symbol lookup is ambiguous. We pin it by
 * contract address (unambiguous) and, as a fallback, by symbol.
 *
 * This lives outside services/xDashApi.js on purpose: it augments the token
 * BEFORE resolveCgId() runs (resolveCgId checks token.cgId first), so the fix
 * holds regardless of how the shared symbol-search fallback behaves.
 */

const BY_ADDRESS = {
  // $ANSEM -> The Black Bull (Solana pump.fun, ~$82-90M mcap)
  '9crcn9rgt8v2imem2baks13yhmeais3rum3rpvtgpump': 'the-black-bull',
}

const BY_SYMBOL = {
  ansem: 'the-black-bull',
}

/**
 * Returns the override cg_id for a token, or null if none applies.
 * @param {object} token - { address, symbol, ... }
 * @returns {string|null}
 */
export function overrideCgId(token) {
  if (!token) return null
  const addr = token.address ? String(token.address).toLowerCase() : null
  if (addr && BY_ADDRESS[addr]) return BY_ADDRESS[addr]
  const sym = token.symbol ? String(token.symbol).toLowerCase() : null
  if (sym && BY_SYMBOL[sym]) return BY_SYMBOL[sym]
  return null
}

/**
 * Returns the token with cgId forced to the override when one applies, so the
 * downstream resolveCgId() keys X Dash by the correct cg_id. No-op otherwise.
 * @param {object} token
 * @returns {object}
 */
export function withXDashCgId(token) {
  if (!token) return token
  const override = overrideCgId(token)
  return override ? { ...token, cgId: override } : token
}
