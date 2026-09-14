/**
 * Curated X (Twitter) handles for the tracked funds. Keyed by vc-database id.
 * Used to pull each fund's live posts (for the tweet feed) and to feed their
 * current narrative into the AI Analyst thesis. Conservative on purpose — a
 * missing handle just means no tweet feed for that fund (graceful), which is
 * better than surfacing the wrong account.
 */
export const VC_HANDLES = {
  'a16z-crypto': 'a16zcrypto',
  'paradigm': 'paradigm',
  'pantera-capital': 'PanteraCapital',
  'polychain-capital': 'polychaincap',
  'multicoin-capital': 'multicoincap',
  'coinbase-ventures': 'cbventures',
  'binance-labs': 'BinanceLabs',
  'dragonfly-capital': 'dragonfly_xyz',
  'framework-ventures': 'hiFramework',
  'electric-capital': 'ElectricCapital',
  'delphi-ventures': 'Delphi_Digital',
  'blockchain-capital': 'blockchaincap',
  'galaxy-digital-ventures': 'galaxyhq',
  'hack-vc': 'hackvc',
  'placeholder-vc': 'placeholdervc',
  'coinfund': 'coinfund_io',
  'animoca-brands': 'animocabrands',
  'okx-ventures': 'OKX_Ventures',
  'dwf-labs': 'DWFLabs',
  'shima-capital': 'ShimaCapital',
  'hashed': 'hashed_official',
  'haun-ventures': 'haunventures',
  'sevenx-ventures': 'SevenXVentures',
  'sequoia-capital': 'sequoia',
  'lightspeed-venture-partners': 'lightspeedvp',
  'accel': 'Accel',
  'usv-union-square-ventures': 'usv',
  'founders-fund': 'foundersfund',
  'grayscale-investments': 'Grayscale',
  'blackrock-ibit': 'BlackRock',
  'ark-invest': 'ARKInvest',
  'vaneck': 'vaneck_us',
  '21shares': '21Shares_',
  'bitwise': 'BitwiseInvest',
  'wisdomtree': 'WisdomTreeFunds',
  'invesco': 'Invesco',
  'proshares': 'ProShares',
  'microstrategy': 'Strategy',
  'tesla': 'Tesla',
  'marathon-digital': 'MarathonDH',
  'riot-platforms': 'RiotPlatforms',
  'coinbase-corp': 'coinbase',
  'metaplanet': 'Metaplanet_JP',
  'square-enix': 'SquareEnix',
  'el-salvador': 'nayibbukele',
  'mubadala': 'Mubadala',
  'iosg-ventures': 'IOSGVC',
  'primitive-ventures': 'primitivecrypto',
  'alliancedao': 'alliancedao',
  '1kx': '1kxnetwork',
  'nascent': 'nascentxyz',
  'maven-11': 'Maven11Capital',
  'fabric-ventures': 'fabric_vc',
  '1confirmation': '1confirmation',
}

export function handleForVc(id) {
  return VC_HANDLES[id] || null
}
