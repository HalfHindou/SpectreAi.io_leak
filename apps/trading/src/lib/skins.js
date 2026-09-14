/**
 * skins — curated appearance bundles (tone ladder + accent), the way
 * game skins bundle a full cosmetic identity. Equipping a skin is
 * nothing more than setting bgTone + accentColor together, so a skin
 * is never separate state: the equipped skin is DERIVED by matching
 * the current settings (skinFor). Tweak either half afterwards and
 * you simply have a custom setup — no drift, nothing to migrate.
 *
 * Tiers are cosmetic labels (collectible-card language, crypto slang
 * for the top shelf). All skins are available to everyone today; the
 * tier field is the hook for future unlocks (referrals, holdings...).
 */

export const SKIN_TIERS = {
  core:  { label: 'Core',  color: '#8A8F98' },
  rare:  { label: 'Rare',  color: '#5CA8FF' },
  epic:  { label: 'Epic',  color: '#A78BFA' },
  grail: { label: 'Grail', color: '#F5C542' },
}

/**
 * accent: null = stock lime channel. Every tone id must exist in
 * lib/bgTone.js TONES. Keep taglines to one short sentence — they
 * render on the card.
 */
export const SKINS = [
  // Spectre = the stock terminal: black and white, nothing else. The
  // platform's default accent channel IS warm white (design-tokens.css),
  // so accent: null both means "stock" and looks the part — fresh users
  // boot with this skin equipped.
  { id: 'spectre',  label: 'Spectre',     tagline: 'Black and white. Nothing else.',         tone: 'obsidian',   accent: null,      tier: 'core' },
  { id: 'satoshi',  label: 'Satoshi',     tagline: 'Bitcoin orange on warm mocha black.',    tone: 'mocha',      accent: '#F7931A', tier: 'grail' },
  { id: 'midas',    label: 'Midas',       tagline: 'Whale gold on gilded onyx.',             tone: 'gold',       accent: '#F5C542', tier: 'grail' },
  { id: 'ether',    label: 'Ether',       tagline: 'Validator violet on midnight blue.',     tone: 'midnight',   accent: '#A78BFA', tier: 'epic' },
  { id: 'miami',    label: 'Miami',       tagline: 'Degen pink on rosé black.',              tone: 'rose',       accent: '#FF5CA8', tier: 'epic' },
  { id: 'tape',     label: 'Ticker Tape', tagline: 'Exchange-floor amber on graphite.',      tone: 'graphite',   accent: '#FFB000', tier: 'epic' },
  { id: 'phosphor', label: 'Phosphor',    tagline: 'CRT green on pure black.',               tone: 'pure-black', accent: '#3DFF7A', tier: 'rare' },
  { id: 'glacier',  label: 'Glacier',     tagline: 'Arctic cyan on cold slate.',             tone: 'slate',      accent: '#7DD3FC', tier: 'rare' },
]

/** The skin matching a tone + accent pair, or null if the setup is custom. */
export function skinFor(tone, accent) {
  const a = accent || null
  return SKINS.find((s) => s.tone === tone && (s.accent || null) === a) || null
}
