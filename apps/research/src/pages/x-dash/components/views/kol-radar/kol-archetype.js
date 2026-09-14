/**
 * Archetype + credibility shared meta for the KOL Radar "Edge" surfaces
 * (Call Ledger card, profile header, dossier header).
 *
 * The backend (dossier `/api/kol/:handle`) classifies each KOL into one of
 * eight archetypes and grades credibility A–F (or '—' when unproven). The
 * UX rule is firm: NEVER make a KOL look bad on thin data. So the tone for
 * 'building'/'unproven' is neutral grey, never red — even though they share
 * a card with red archetypes. Red is reserved for KOLs the data actually
 * indicts (exit-liquidity / rug-magnet) on a SUFFICIENT sample.
 *
 *   tone: 'green' = early-sniper / market-beater / consistent / diamond
 *         'red'   = exit-liquidity / rug-magnet
 *         'grey'  = building / unproven  (calm, never punitive)
 *
 * `cls` maps to the shared archetype-chip CSS (--good / --bad / --neutral).
 * Labels carry i18n keys + English fallbacks (no locale-file edit needed —
 * the fallback renders until a translation is added, same as every other
 * KOL Radar string).
 */
export const ARCHETYPE_META = {
  'early-sniper': {
    key: 'kolRadar.archetype.earlySniper',
    fallback: 'Early Sniper',
    tone: 'green',
    cls: 'good',
    blurb: 'In before the market — calls beat BTC and they front-run the crowd.',
  },
  'market-beater': {
    key: 'kolRadar.archetype.marketBeater',
    fallback: 'Market Beater',
    tone: 'green',
    cls: 'good',
    blurb: 'Their calls outperform just holding BTC over the same window.',
  },
  consistent: {
    key: 'kolRadar.archetype.consistent',
    fallback: 'Consistent',
    tone: 'green',
    cls: 'good',
    blurb: 'Steady hit-rate — wins more than they lose, sample after sample.',
  },
  diamond: {
    key: 'kolRadar.archetype.diamond',
    fallback: 'Diamond Hands',
    tone: 'green',
    cls: 'good',
    blurb: 'Their calls keep running to big peaks — high conviction that pays.',
  },
  'exit-liquidity': {
    key: 'kolRadar.archetype.exitLiquidity',
    fallback: 'Exit Liquidity',
    tone: 'red',
    cls: 'bad',
    blurb: 'Calls tend to fade after they post — followers buy the top.',
  },
  'rug-magnet': {
    key: 'kolRadar.archetype.rugMagnet',
    fallback: 'Rug Magnet',
    tone: 'red',
    cls: 'bad',
    blurb: 'A pattern of calls that went to zero — handle with care.',
  },
  building: {
    key: 'kolRadar.archetype.building',
    fallback: 'Building Track Record',
    tone: 'grey',
    cls: 'neutral',
    blurb: 'Not enough realized calls yet to grade — track record still forming.',
  },
  unproven: {
    key: 'kolRadar.archetype.unproven',
    fallback: 'Unproven',
    tone: 'grey',
    cls: 'neutral',
    blurb: 'No scored calls on record yet.',
  },
}

const FALLBACK_ARCHETYPE = ARCHETYPE_META.building

export function archetypeMeta(archetype) {
  return ARCHETYPE_META[String(archetype || '').toLowerCase()] || FALLBACK_ARCHETYPE
}

/* Credibility grade → chip tone. A/B = strong (green), C = even (amber),
   D/F = weak (red), '—' = unrated (grey). Mirrors the archetype tone scale
   but keyed off the letter so the badge color matches the grade. A grade
   only ever goes red on a SUFFICIENT sample — the backend returns basis
   'limited'/'health' (never a D/F letter) on thin data, so this map is safe. */
export function gradeTone(grade) {
  const g = String(grade || '').toUpperCase()
  if (g === 'A' || g === 'B') return 'good'
  if (g === 'C') return 'even'
  if (g === 'D' || g === 'F') return 'bad'
  return 'neutral'
}

/* A KOL is "still building" — show the calm forming-track-record state, never
   a grade or a red archetype — when the realized sample is too thin to judge.
   Drives off BOTH the track-record sample and the credibility basis so either
   signal triggers the soft state. */
export function isBuilding({ trackRecord, credibility } = {}) {
  const sample = String(trackRecord?.sample || '').toLowerCase()
  const basis = String(credibility?.basis || '').toLowerCase()
  if (sample === 'sufficient') return false
  return sample === 'limited' || sample === 'none' || basis === 'limited' || basis === 'health'
}
