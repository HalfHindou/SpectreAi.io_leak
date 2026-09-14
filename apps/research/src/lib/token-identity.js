/**
 * token-identity.js — the SINGLE source of truth for turning a token/project
 * blob into its display identity (name · ticker/cashtag · X handle · logo).
 *
 * Every surface that shows a token's "who is this" — the X Intelligence graph
 * hub, its sidebar, its hover tooltip, and (over time) the X Dash drawer — must
 * go through here instead of hand-rolling the logic. The rules below were each
 * paid for with a real bug; encoding them once is the only way they stop
 * recurring.
 *
 * THE RULES
 *
 *  1. cgId is the ONLY unique key. Identity is NEVER derived from a ticker.
 *     Tickers collide: `$DOT` is BOTH Polkadot (cgId 'polkadot') and a ~$600K
 *     Base token (cgId null). Mapping a ticker → cgId routes you to the wrong
 *     coin — that was a real prod bug (search routed Base $DOT to /polkadot,
 *     fix #910). So this module never turns a symbol into a cgId; the caller
 *     must already hold the cgId from a trusted source (CoinGecko resolve or
 *     contract verification).
 *
 *  2. A project is shown by its $CASHTAG, never a fabricated "@<ticker>".
 *     A project's X handle is almost never its ticker (Zebec trades as $ZBCN
 *     but posts as @Zebec_HQ), and many projects have NO handle in the feed at
 *     all. `handle` here is a REAL X account or null — we never invent @ZBCN,
 *     and the "View on X" affordance only exists when a real handle exists.
 *
 *  3. A project can have MULTIPLE tickers (Spectre = $SPECT and $SPECTRE).
 *     `cashtags` is the full list; `cashtag` is the primary for compact display.
 *
 *  4. Authors are the opposite of projects: a KOL/author IS its @handle.
 *     `nodeIdentityLabel` applies rule 2 to hubs and this rule to authors.
 */

/**
 * Known multi-ticker projects, keyed by cgId (the unique key — never by the
 * colliding ticker). Add a row whenever a project is referenced by more than
 * one cashtag. Values are bare tickers (no `$`).
 */
export const TICKER_ALIASES = {
  'spectre-ai': ['SPECT', 'SPECTRE'],
}

function dedupeCashtags(list) {
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const v = String(raw || '').trim()
    if (!v) continue
    const bare = v.replace(/^\$/, '').toUpperCase()
    if (!bare || seen.has(bare)) continue
    seen.add(bare)
    out.push(`$${bare}`)
  }
  return out
}

/**
 * A handle is "real" only if the data gave us an actual X account. A handle
 * string that is exactly the ticker is the fabrication pattern (projects post
 * as @Zebec_HQ, not @ZBCN), so we reject it — UNLESS it came from a verified
 * posting account (`fromOwnAccount`), where it's a genuine screen_name.
 */
function isRealHandle(handle, symbol, fromOwnAccount) {
  const h = String(handle || '').replace(/^@/, '').trim()
  if (!h) return false
  if (fromOwnAccount) return true
  if (symbol && h.toLowerCase() === String(symbol).replace(/^\$/, '').toLowerCase()) return false
  return true
}

/**
 * Resolve a token/project blob into its canonical display identity.
 *
 * @param {object} token  An X Dash / leaderboard token shape. Accepts either a
 *                        flat token (`{cg_id, symbol, name, cashtag, handle,
 *                        twitter_url, image_*}`) or a nested `{token, metrics}`.
 * @param {object} [opts]
 * @param {object} [opts.ownAccount]  The author object verified to be the
 *                        project's own X account (provides a real screen_name +
 *                        avatar). Pass it when you've matched it among authors.
 * @returns {{cgId, name, symbol, cashtag, cashtags, handle, handleAt,
 *            twitterUrl, avatar, label}}
 */
export function resolveTokenIdentity(token = {}, opts = {}) {
  const t = token && (token.token || token.metrics) ? (token.token || token) : (token || {})
  const ownAccount = opts.ownAccount || null

  // Rule 1: cgId is read straight from the trusted blob — never derived.
  const cgId = t.cg_id || t.token_id || t.cgId || token.cg_id || token.cgId || null
  const symbol = String(t.symbol || token.symbol || '').replace(/^\$/, '').trim()
  const name = t.name || token.name || ownAccount?.name || symbol || null

  // Rule 3: cashtag(s) — display only. Primary from the data (or `$symbol`),
  // plus any curated aliases for multi-ticker projects.
  const aliases =
    (cgId && TICKER_ALIASES[cgId]) ||
    (symbol && TICKER_ALIASES[symbol.toUpperCase()]) ||
    []
  const primaryRaw = String(t.cashtag || token.cashtag || (symbol ? `$${symbol}` : '')).trim()
  const cashtags = dedupeCashtags([primaryRaw, ...aliases])
  const cashtag = (primaryRaw ? dedupeCashtags([primaryRaw])[0] : null) || cashtags[0] || null

  // Rule 2: a REAL handle or null — never the ticker. An own-account match
  // (a verified posting account) wins; otherwise the token's declared handle,
  // but only if it isn't just the ticker echoed back.
  const ownHandle = ownAccount?.screen_name ? String(ownAccount.screen_name).replace(/^@/, '').trim() : ''
  const declared = String(t.handle || token.handle || '').replace(/^@/, '').trim()
  const handle =
    (isRealHandle(ownHandle, symbol, true) && ownHandle) ||
    (isRealHandle(declared, symbol, false) && declared) ||
    null
  const handleAt = handle ? `@${handle}` : null
  // Rule 2: only link to X when there's a real account to open.
  const twitterUrl = t.twitter_url || token.twitter_url || (handle ? `https://x.com/${handle}` : null)

  const avatar =
    (t.image_large || t.image_small || t.image_url || token.image || ownAccount?.avatar_image_url ||
      ownAccount?.profile_image_url || '')
      .replace('_normal', '_200x200') || null

  // The identity line: a project leads with its real @handle, else its
  // $cashtag(s); a name is the last resort. (Authors use nodeIdentityLabel.)
  const label = handleAt || (cashtags.length > 1 ? cashtags.join(' · ') : cashtag) || name || null

  return { cgId, name, symbol: symbol || null, cashtag, cashtags, handle, handleAt, twitterUrl, avatar, label }
}

/**
 * Display identity for a graph NODE (hub or author). One rule, used by the
 * sidebar + tooltip + anywhere a node's "@/$" line is drawn, so the
 * project-vs-author distinction can't drift apart again.
 *
 * @returns {{label: string|null, twitterUrl: string|null}}
 */
export function nodeIdentityLabel(node) {
  if (!node) return { label: null, twitterUrl: null }
  const isHub = node.isHub || node.isProjectHub || node.type === 'project'

  if (!isHub) {
    // Rule 4: an author IS its @handle.
    const h = (node.handle ? String(node.handle).replace(/^@/, '').trim() : '') || node.id || ''
    return {
      label: h ? `@${h}` : (node.name || null),
      twitterUrl: node.twitterUrl || (h ? `https://x.com/${h}` : null),
    }
  }

  // Rule 2: a project shows its real @handle, else its $cashtag(s) — never an
  // invented @ticker.
  const realHandle = node.handle ? String(node.handle).replace(/^@/, '').trim() : ''
  const cashtagLabel = Array.isArray(node.cashtags) && node.cashtags.length > 1
    ? node.cashtags.join(' · ')
    : (node.cashtag || null)
  return {
    label: realHandle ? `@${realHandle}` : (cashtagLabel || node.name || null),
    twitterUrl: node.twitterUrl || (realHandle ? `https://x.com/${realHandle}` : null),
  }
}

export default resolveTokenIdentity
