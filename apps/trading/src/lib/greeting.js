/**
 * greeting - the ONE place platform greetings are composed, so the
 * DiscoverHero hero line and the agent's personal salutations never drift.
 * Extracted from DiscoverHero.jsx (hour parts + name suffix), extended with
 * the agent's dry-wit salutation composer (Jarvis v2 persona).
 */

/** Usernames are not names: "Gleb02f" is a person called Gleb, "0xMaxi"
    is Maxi, "crypto_kev99" is Kev. Strip digits/symbols/0x, split on
    separators + camelCase, skip generic prefixes, take the first real
    word, capitalize. Nothing usable -> '' (greetings drop the name
    gracefully). Mirrored server-side in agent-core sanitizeDisplayName -
    keep the two in sync. */
const GENERIC_NAME_TOKENS = new Set(['crypto', 'the', 'mr', 'ms', 'mrs', 'dr', 'sir', 'ox', 'xx'])
export function humanizeName(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const tokens = s
    .replace(/^0x/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_.\-\d]+/)
    .map((t) => t.replace(/[^A-Za-z]/g, ''))
    .filter((t) => t.length >= 2)
  const pick = tokens.find((t) => !GENERIC_NAME_TOKENS.has(t.toLowerCase())) || ''
  if (!pick) return ''
  const body = pick === pick.toUpperCase() && pick.length > 2 ? pick.slice(1).toLowerCase() : pick.slice(1)
  return (pick[0].toUpperCase() + body).slice(0, 15)
}

/** Pull a human display name off the signed-in Privy account. Prefers a
    real name (Google), then a social handle, then the email local-part -
    always HUMANIZED (handles and local-parts carry digit/symbol junk).
    Returns '' when nothing usable is linked. (Moved from DiscoverHero so
    the hero greeting and the agent's name-awareness never drift.) */
export function deriveAccountName(user) {
  if (!user) return ''
  const g = user.google?.name
  if (g) return humanizeName(g.split(' ')[0] || g)
  const tw = user.twitter?.name || user.twitter?.username
  if (tw) return humanizeName(tw)
  const tg = user.telegram?.firstName || user.telegram?.username
  if (tg) return humanizeName(tg)
  const fc = user.farcaster?.displayName || user.farcaster?.username
  if (fc) return humanizeName(fc)
  const dc = user.discord?.username
  if (dc) return humanizeName(dc)
  const email = user.email?.address || user.google?.email
  if (email) return humanizeName(email.split('@')[0])
  return ''
}

export function dayPart(hour = new Date().getHours()) {
  return hour >= 5 && hour < 12 ? 'Morning'
    : hour >= 12 && hour < 17 ? 'Afternoon'
      : 'Evening'
}

/** DiscoverHero's exact greeting: "Good Morning, Gleb." / "Good Morning." */
export function getGreeting(name) {
  const part = `Good ${dayPart()}`
  return name ? `${part}, ${name}.` : `${part}.`
}

/* ── Agent brief salutation (client-composed - the brief doc is KV-shared
      across users, so the personal layer lives here) ──
   visitCount = how many times THIS device opened this token this session.
   witAllowed: the persona's no-jokes-about-risk rail applies here too -
   the caller gates it on the brief stance (clean/opportunity/neutral only). */
export function agentSalutation({ name, visitCount = 1, witAllowed = true, symbol }) {
  const n = String(name || '').trim()
  const part = dayPart()
  const base = n ? `Good ${part.toLowerCase()}, ${n}.` : `Good ${part.toLowerCase()}.`
  if (!witAllowed || visitCount <= 1 || !symbol) return base
  if (visitCount === 2) return n ? `Back to ${symbol}, ${n}.` : `Back to ${symbol}.`
  return `${symbol} again. I admire the persistence.`
}

/** Stale cached briefs (up to 6h past the prompt bump) still carry their own
    salutation-style greeting - detect so the client never doubles up.
    Covers analyse/analyze spellings and straight/curly apostrophes. */
export function greetingHasSalutation(greeting) {
  return /^\s*(good\s+(morning|afternoon|evening)|hey|hi\b|hello|welcome|i['’]?ve\s+analy[sz])/i.test(String(greeting || ''))
}
