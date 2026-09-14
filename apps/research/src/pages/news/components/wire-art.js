/**
 * wire-art.js - the Macro Wire's visual vocabulary (category kinds, shock lane,
 * branded posters, verified photo pools + the headline->photo picker).
 * Shared by the PRO newsroom (NewsPage.jsx) and LITE's News view (lite-news.jsx)
 * so both surfaces draw the same story the same way, without LITE importing the
 * whole PRO page.
 */

export const hashStr = (s = '') => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Branded glass poster per wire category (public/images/wire/*.svg) — the
// desk's own art, not stock chart photos (founder 07-30: "the design is crap
// … not like i asked for heatmaps"). Repetition within a category reads as a
// brand pattern, the way category art does on a real wire service.
export const MACRO_POSTERS = {
  macro: '/images/wire/rates.svg',
  political: '/images/wire/geo.svg',
  regulatory: '/images/wire/reg.svg',
  crypto: '/images/wire/crypto.svg',
  market: '/images/wire/market.svg',
  energy: '/images/wire/energy.svg',
}
export const macroPoster = (cat) => MACRO_POSTERS[String(cat || '').toLowerCase()] || MACRO_POSTERS.macro

// Story kinds — the app twin of the TG lane differentiation (🌍 Macro Shocks /
// ⚡️ Breaking / …): every wire story wears its kind in color, and importance
// >= 85 earns the red SHOCK chip (the 🌍🔴 tier).
export const WIRE_KINDS = {
  macro:      { label: 'Macro',       color: '#2DD4BF' },
  political:  { label: 'Geopolitics', color: '#EF4444' },
  regulatory: { label: 'Regulatory',  color: '#F59E0B' },
  crypto:     { label: 'Crypto',      color: '#F7931A' },
  market:     { label: 'Markets',     color: '#22C55E' },
  energy:     { label: 'Energy',      color: '#F97316' },
}
export const WIRE_SHOCK_MIN = 85

/* Wire photography — every image VISUALLY verified on a contact sheet before
 * shipping (founder 07-31: "use better images. obama japan?!" — an Unsplash ID
 * tells you nothing; several "oil rig" IDs rendered as castles and pasta).
 * Hard rules: no identifiable people, no specific parliaments, no chart
 * screenshots. Selection order: TOPIC (tariffs/oil/gold) → PLACE named in the
 * headline (Japan→Tokyo, China→Shanghai…) → neutral category pool. */
const U = (id) => `https://images.unsplash.com/${id}?w=900&h=500&fit=crop`
const IMG = {
  dollars: U('photo-1526304640581-d334cdbbf45e'),
  cityAerial: U('photo-1517935706615-2717063c2225'),
  nyc: U('photo-1480714378408-67cf0d13bc1b'),
  towers: U('photo-1486406146926-c627a92ad1ab'),
  bizPaper: U('photo-1518186285589-2f7649de83e0'),
  earthNight: U('photo-1451187580459-43490279c0fa'),
  globeMap: U('photo-1589262804704-c5aa9e6def89'),
  statues: U('photo-1505664194779-8beaceb93744'),
  tokyoCrossing: U('photo-1540959733332-eab4deabeeaf'),
  tokyoNeon: U('photo-1503899036084-c55cdd92da26'),
  tokyoTower: U('photo-1536098561742-ca998e48cbcc'),
  shanghai: U('photo-1474181487882-5abf3f0ba6c2'),
  forbiddenCity: U('photo-1547981609-4b6bfe67ca0b'),
  dcMonument: U('photo-1617581629397-a72507c3de9e'),
  europeBridge: U('photo-1519677100203-a0e668c92439'),
  london: U('photo-1513635269975-59663e0ac1ad'),
  goldBars: U('photo-1610375461246-83df859d849d'),
  indiaGate: U('photo-1587474260584-136574528ed5'),
  moscow: U('photo-1513326738677-b964603b136d'),
  containerPort: U('photo-1494412574643-ff11b0a5c1c3'),
  solar: U('photo-1509391366360-2e959784a276'),
  refinery: U('photo-1516937941344-00b4e0337589'),
  chainBlocks: U('photo-1639762681485-074b7f938ba0'),
  btcCoin: U('photo-1622630998477-20aa696ecb05'),
}
const WIRE_IMAGE_RULES = [
  // topics beat places: "US tariffs on China" wants the port, not DC
  [/\bgold\b|bullion/, [IMG.goldBars]],
  [/tariff|trade war|trade deal|export|import|shipping|supply chain|freight/, [IMG.containerPort]],
  [/\boil\b|crude|opec|barrel|refinery|natural gas|energy price/, [IMG.refinery, IMG.solar]],
  [/bitcoin|\bbtc\b|ethereum|\beth\b|crypto|stablecoin/, [IMG.btcCoin, IMG.chainBlocks]],
  [/japan|tokyo|\byen\b|\bboj\b|nikkei/, [IMG.tokyoCrossing, IMG.tokyoNeon, IMG.tokyoTower]],
  [/china|chinese|beijing|shanghai|yuan|renminbi|pboc/, [IMG.shanghai, IMG.forbiddenCity]],
  [/russia|moscow|kremlin/, [IMG.moscow]],
  [/\bindia\b|rupee|new delhi|\brbi\b/, [IMG.indiaGate]],
  [/\buk\b|britain|london|sterling|\bboe\b|\bpound\b/, [IMG.london]],
  [/\beu\b|europe|euro\b|eurozone|\becb\b|germany|france|brussels/, [IMG.europeBridge]],
  [/\bus\b|\bu\.s\.|united states|america|washington|federal reserve|\bfed\b|treasury|white house|congress|senate/, [IMG.dcMonument, IMG.dollars, IMG.nyc]],
]
const MACRO_PHOTOS = {
  macro: [IMG.dollars, IMG.cityAerial, IMG.nyc],
  political: [IMG.earthNight, IMG.globeMap],
  regulatory: [IMG.statues, IMG.globeMap],
  market: [IMG.nyc, IMG.towers, IMG.bizPaper, IMG.cityAerial],
  crypto: [IMG.chainBlocks, IMG.btcCoin],
  energy: [IMG.refinery, IMG.solar],
}
export function wireImage(headline, cat, key) {
  const t = ` ${String(headline || '').toLowerCase()} `
  for (const [rx, pool] of WIRE_IMAGE_RULES) {
    if (rx.test(t)) return pool[hashStr(String(key)) % pool.length]
  }
  const pool = MACRO_PHOTOS[String(cat || '').toLowerCase()] || MACRO_PHOTOS.macro
  return pool[hashStr(String(key)) % pool.length]
}
