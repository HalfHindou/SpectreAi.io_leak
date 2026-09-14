/**
 * Stock Market Constants
 * Default stocks, sectors, and logos for stock mode
 *
 * Includes comprehensive commodity database:
 *   - Precious Metals (Gold, Silver, Platinum, Palladium)
 *   - Energy (Oil, Natural Gas, Brent Crude)
 *   - Agriculture (Corn, Wheat, Soybeans, Sugar, Coffee, Cocoa, Livestock)
 *   - Industrial Metals (Copper, Lithium, Uranium, Rare Earth, Steel)
 *   - Broad Commodity Baskets (Bloomberg, GSCI, Diversified)
 *   - Mining Stocks (Gold miners, Copper miners, Diversified miners)
 */

// Top stocks to show by default (equivalent to TOP_COINS)
export const TOP_STOCKS = [
  // Major ETFs / Indices
  { symbol: 'SPY', name: 'S&P 500 ETF', sector: 'Index', exchange: 'NYSE' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', sector: 'Index', exchange: 'NASDAQ' },
  { symbol: 'IWM', name: 'Russell 2000 ETF', sector: 'Index', exchange: 'NYSE' },

  // ── Commodity Futures (actual spot/futures contracts) ──
  { symbol: 'GC=F', name: 'Gold Futures', sector: 'Commodity', exchange: 'COMEX' },
  { symbol: 'SI=F', name: 'Silver Futures', sector: 'Commodity', exchange: 'COMEX' },
  { symbol: 'CL=F', name: 'Crude Oil WTI Futures', sector: 'Commodity', exchange: 'NYMEX' },
  { symbol: 'NG=F', name: 'Natural Gas Futures', sector: 'Commodity', exchange: 'NYMEX' },
  { symbol: 'HG=F', name: 'Copper Futures', sector: 'Commodity', exchange: 'COMEX' },
  { symbol: 'PL=F', name: 'Platinum Futures', sector: 'Commodity', exchange: 'NYMEX' },
  { symbol: 'PA=F', name: 'Palladium Futures', sector: 'Commodity', exchange: 'NYMEX' },

  // ── Commodities: Precious Metals (ETFs) ──
  { symbol: 'GLD', name: 'SPDR Gold Trust', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'IAU', name: 'iShares Gold Trust', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'SGOL', name: 'Aberdeen Physical Gold', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'SLV', name: 'iShares Silver Trust', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'PPLT', name: 'abrdn Physical Platinum', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'PALL', name: 'abrdn Physical Palladium', sector: 'Commodity', exchange: 'NYSE' },

  // ── Commodities: Energy (ETFs) ──
  { symbol: 'USO', name: 'United States Oil Fund', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'BNO', name: 'United States Brent Oil', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'UNG', name: 'United States Natural Gas', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'AMLP', name: 'Alerian MLP ETF', sector: 'Commodity', exchange: 'NYSE' },

  // ── Commodities: Agriculture ──
  { symbol: 'DBA', name: 'Invesco DB Agriculture', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'CORN', name: 'Teucrium Corn Fund', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'WEAT', name: 'Teucrium Wheat Fund', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'SOYB', name: 'Teucrium Soybean Fund', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'CANE', name: 'Teucrium Sugar Fund', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'COW', name: 'iPath Livestock ETN', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'JO', name: 'iPath Coffee ETN', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'NIB', name: 'iPath Cocoa ETN', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'TAGS', name: 'Teucrium Agricultural', sector: 'Commodity', exchange: 'NYSE' },

  // ── Commodities: Industrial Metals ──
  { symbol: 'CPER', name: 'United States Copper', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'LIT', name: 'Global X Lithium & Battery', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'URA', name: 'Global X Uranium ETF', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'REMX', name: 'VanEck Rare Earth ETF', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'PICK', name: 'iShares MSCI Metals & Mining', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'SLX', name: 'VanEck Steel ETF', sector: 'Commodity', exchange: 'NYSE' },

  // ── Commodities: Broad Baskets ──
  { symbol: 'DJP', name: 'iPath Bloomberg Commodity', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'GSG', name: 'iShares S&P GSCI Commodity', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'PDBC', name: 'Invesco Diversified Commodity', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'COM', name: 'Direxion Auspice Commodity', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'COMT', name: 'iShares GSCI Commodity ETF', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'FTGC', name: 'First Trust Global Tactical', sector: 'Commodity', exchange: 'NASDAQ' },
  { symbol: 'BCI', name: 'abrdn Bloomberg All Commodity', sector: 'Commodity', exchange: 'NYSE' },

  // ── Mining Stocks (Commodity Producers) ──
  { symbol: 'NEM', name: 'Newmont Corp.', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'GOLD', name: 'Barrick Gold Corp.', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'AEM', name: 'Agnico Eagle Mines', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'WPM', name: 'Wheaton Precious Metals', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'RGLD', name: 'Royal Gold Inc.', sector: 'Commodity', exchange: 'NASDAQ' },
  { symbol: 'FNV', name: 'Franco-Nevada Corp.', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'VALE', name: 'Vale S.A.', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'BHP', name: 'BHP Group Ltd.', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'RIO', name: 'Rio Tinto plc', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'SCCO', name: 'Southern Copper Corp.', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'TECK', name: 'Teck Resources Ltd.', sector: 'Commodity', exchange: 'NYSE' },
  { symbol: 'AA', name: 'Alcoa Corp.', sector: 'Commodity', exchange: 'NYSE' },

  // Magnificent 7
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer', exchange: 'NASDAQ' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Automotive', exchange: 'NASDAQ' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Technology', exchange: 'NASDAQ' },
  // Newly public — SpaceX (NASDAQ:SPCX), IPO'd 2026-06-12
  { symbol: 'SPCX', name: 'SpaceX', sector: 'Aerospace & Defense', exchange: 'NASDAQ' },
  // Tech
  { symbol: 'NFLX', name: 'Netflix Inc.', sector: 'Communication', exchange: 'NASDAQ' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'INTC', name: 'Intel Corp.', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'Technology', exchange: 'NYSE' },
  { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'ORCL', name: 'Oracle Corp.', sector: 'Technology', exchange: 'NYSE' },
  // Financial
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financial', exchange: 'NYSE' },
  { symbol: 'V', name: 'Visa Inc.', sector: 'Financial', exchange: 'NYSE' },
  { symbol: 'MA', name: 'Mastercard Inc.', sector: 'Financial', exchange: 'NYSE' },
  { symbol: 'BAC', name: 'Bank of America', sector: 'Financial', exchange: 'NYSE' },
  { symbol: 'GS', name: 'Goldman Sachs', sector: 'Financial', exchange: 'NYSE' },
  { symbol: 'COIN', name: 'Coinbase Global', sector: 'Financial', exchange: 'NASDAQ' },
  { symbol: 'PYPL', name: 'PayPal Holdings', sector: 'Financial', exchange: 'NASDAQ' },
  // Healthcare
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', exchange: 'NYSE' },
  { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', exchange: 'NYSE' },
  // Consumer
  { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer', exchange: 'NYSE' },
  { symbol: 'HD', name: 'Home Depot', sector: 'Consumer', exchange: 'NYSE' },
  { symbol: 'DIS', name: 'Walt Disney Co.', sector: 'Communication', exchange: 'NYSE' },
  // Energy
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', exchange: 'NYSE' },
  { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer', exchange: 'NYSE' },
]

// Welcome widget stocks (like BTC, ETH, SOL for crypto) - top 3 most watched
export const WELCOME_STOCKS = ['SPY', 'AAPL', 'NVDA']

// IPO reference prices for newly-public names (the first-trade print) —
// drives the below/above-IPO milestone on the stock page + the command
// center key-events line. Keep in sync with the data-api box's
// worker-equity-events IPO_REFERENCE (the bell-feed detector).
// SPCX verified vs Yahoo daily candles: first trade 2026-06-12 @ $150.00.
// `lockup` = IPO lock-up expiry — when insider / early-investor shares become
// sellable, a supply-overhang event that can pressure the price. Curated per
// name; add verified dates as more IPOs land (Q4 2026: Anthropic, etc.).
export const IPO_REFERENCE = {
  SPCX: { price: 150.0, date: '2026-06-12', lockup: '2026-08-12' },
}

// Stock sectors — Commodity promoted to #2 position (after Index)
export const STOCK_SECTORS = [
  { id: 'all', label: 'All Sectors' },
  { id: 'index', label: 'Index/ETF' },
  { id: 'commodity', label: 'Commodity' },
  { id: 'technology', label: 'Technology' },
  { id: 'healthcare', label: 'Healthcare' },
  { id: 'financial', label: 'Financial' },
  { id: 'consumer', label: 'Consumer' },
  { id: 'industrial', label: 'Industrial' },
  { id: 'energy', label: 'Energy' },
  { id: 'automotive', label: 'Automotive' },
  { id: 'communication', label: 'Communication' },
  { id: 'materials', label: 'Materials' },
  { id: 'utilities', label: 'Utilities' },
  { id: 'realestate', label: 'Real Estate' },
]

// Stock logos — Clearbit fallbacks (FMP CDN is primary via getStockLogo)
export const STOCK_LOGOS = {
  // Indices / ETFs
  'SPY': 'https://logo.clearbit.com/ssga.com',
  'QQQ': 'https://logo.clearbit.com/invesco.com',
  'IWM': 'https://logo.clearbit.com/ishares.com',
  'DIA': 'https://logo.clearbit.com/ssga.com',
  'VOO': 'https://logo.clearbit.com/vanguard.com',
  'VTI': 'https://logo.clearbit.com/vanguard.com',

  // ── Commodity Futures ──
  'GC=F': 'https://financialmodelingprep.com/image-stock/GLD.png',   // Gold uses GLD logo
  'SI=F': 'https://financialmodelingprep.com/image-stock/SLV.png',   // Silver uses SLV logo
  'CL=F': 'https://financialmodelingprep.com/image-stock/USO.png',   // Crude Oil uses USO logo
  'NG=F': 'https://financialmodelingprep.com/image-stock/UNG.png',   // Natural Gas uses UNG logo
  'HG=F': 'https://financialmodelingprep.com/image-stock/CPER.png',  // Copper uses CPER logo
  'PL=F': 'https://financialmodelingprep.com/image-stock/PPLT.png',  // Platinum uses PPLT logo
  'PA=F': 'https://financialmodelingprep.com/image-stock/PALL.png',  // Palladium uses PALL logo

  // ── Commodity ETFs: Precious Metals ──
  'GLD': 'https://logo.clearbit.com/ssga.com',
  'IAU': 'https://logo.clearbit.com/ishares.com',
  'SGOL': 'https://logo.clearbit.com/abrdn.com',
  'SLV': 'https://logo.clearbit.com/ishares.com',
  'PPLT': 'https://logo.clearbit.com/abrdn.com',
  'PALL': 'https://logo.clearbit.com/abrdn.com',

  // ── Commodity ETFs: Energy ──
  'USO': 'https://logo.clearbit.com/uscfinvestments.com',
  'BNO': 'https://logo.clearbit.com/uscfinvestments.com',
  'UNG': 'https://logo.clearbit.com/uscfinvestments.com',
  'AMLP': 'https://logo.clearbit.com/invesco.com',

  // ── Commodity ETFs: Agriculture ──
  'DBA': 'https://logo.clearbit.com/invesco.com',
  'CORN': 'https://logo.clearbit.com/teucrium.com',
  'WEAT': 'https://logo.clearbit.com/teucrium.com',
  'SOYB': 'https://logo.clearbit.com/teucrium.com',
  'CANE': 'https://logo.clearbit.com/teucrium.com',
  'TAGS': 'https://logo.clearbit.com/teucrium.com',

  // ── Commodity ETFs: Industrial Metals & Broad ──
  'CPER': 'https://logo.clearbit.com/uscfinvestments.com',
  'LIT': 'https://logo.clearbit.com/globalxetfs.com',
  'URA': 'https://logo.clearbit.com/globalxetfs.com',
  'REMX': 'https://logo.clearbit.com/vaneck.com',
  'PICK': 'https://logo.clearbit.com/ishares.com',
  'SLX': 'https://logo.clearbit.com/vaneck.com',
  'DJP': 'https://logo.clearbit.com/ipathetn.com',
  'GSG': 'https://logo.clearbit.com/ishares.com',
  'PDBC': 'https://logo.clearbit.com/invesco.com',
  'COM': 'https://logo.clearbit.com/direxion.com',
  'COMT': 'https://logo.clearbit.com/ishares.com',
  'FTGC': 'https://logo.clearbit.com/ftportfolios.com',
  'BCI': 'https://logo.clearbit.com/abrdn.com',

  // ── Mining Stocks ──
  'NEM': 'https://logo.clearbit.com/newmont.com',
  'GOLD': 'https://logo.clearbit.com/barrick.com',
  'AEM': 'https://logo.clearbit.com/agnicoeagle.com',
  'WPM': 'https://logo.clearbit.com/wheatonpm.com',
  'RGLD': 'https://logo.clearbit.com/royalgold.com',
  'FNV': 'https://logo.clearbit.com/franco-nevada.com',
  'FCX': 'https://logo.clearbit.com/fcx.com',
  'VALE': 'https://logo.clearbit.com/vale.com',
  'BHP': 'https://logo.clearbit.com/bhp.com',
  'RIO': 'https://logo.clearbit.com/riotinto.com',
  'SCCO': 'https://logo.clearbit.com/southerncopper.com',
  'TECK': 'https://logo.clearbit.com/teck.com',
  'AA': 'https://logo.clearbit.com/alcoa.com',

  // Technology
  'AAPL': 'https://logo.clearbit.com/apple.com',
  'MSFT': 'https://logo.clearbit.com/microsoft.com',
  'GOOGL': 'https://logo.clearbit.com/google.com',
  'GOOG': 'https://logo.clearbit.com/google.com',
  'AMZN': 'https://logo.clearbit.com/amazon.com',
  'NVDA': 'https://logo.clearbit.com/nvidia.com',
  'META': 'https://logo.clearbit.com/meta.com',
  'TSLA': 'https://logo.clearbit.com/tesla.com',
  'NFLX': 'https://logo.clearbit.com/netflix.com',
  'ADBE': 'https://logo.clearbit.com/adobe.com',
  'CRM': 'https://logo.clearbit.com/salesforce.com',
  'ORCL': 'https://logo.clearbit.com/oracle.com',
  'INTC': 'https://logo.clearbit.com/intel.com',
  'AMD': 'https://logo.clearbit.com/amd.com',
  'CSCO': 'https://logo.clearbit.com/cisco.com',
  'IBM': 'https://logo.clearbit.com/ibm.com',
  'PYPL': 'https://logo.clearbit.com/paypal.com',
  'SQ': 'https://logo.clearbit.com/squareup.com',
  'SHOP': 'https://logo.clearbit.com/shopify.com',
  'UBER': 'https://logo.clearbit.com/uber.com',
  'LYFT': 'https://logo.clearbit.com/lyft.com',
  'SNAP': 'https://logo.clearbit.com/snap.com',
  'TWTR': 'https://logo.clearbit.com/twitter.com',
  'SPOT': 'https://logo.clearbit.com/spotify.com',
  'ZM': 'https://logo.clearbit.com/zoom.us',
  'DOCU': 'https://logo.clearbit.com/docusign.com',
  'NOW': 'https://logo.clearbit.com/servicenow.com',
  'SNOW': 'https://logo.clearbit.com/snowflake.com',
  'PLTR': 'https://logo.clearbit.com/palantir.com',
  'COIN': 'https://logo.clearbit.com/coinbase.com',
  'HOOD': 'https://logo.clearbit.com/robinhood.com',

  // Financial
  'JPM': 'https://logo.clearbit.com/jpmorganchase.com',
  'BAC': 'https://logo.clearbit.com/bankofamerica.com',
  'WFC': 'https://logo.clearbit.com/wellsfargo.com',
  'C': 'https://logo.clearbit.com/citi.com',
  'GS': 'https://logo.clearbit.com/goldmansachs.com',
  'MS': 'https://logo.clearbit.com/morganstanley.com',
  'V': 'https://logo.clearbit.com/visa.com',
  'MA': 'https://logo.clearbit.com/mastercard.com',
  'AXP': 'https://logo.clearbit.com/americanexpress.com',
  'BLK': 'https://logo.clearbit.com/blackrock.com',
  'SCHW': 'https://logo.clearbit.com/schwab.com',

  // Healthcare
  'JNJ': 'https://logo.clearbit.com/jnj.com',
  'UNH': 'https://logo.clearbit.com/unitedhealthgroup.com',
  'PFE': 'https://logo.clearbit.com/pfizer.com',
  'MRK': 'https://logo.clearbit.com/merck.com',
  'ABBV': 'https://logo.clearbit.com/abbvie.com',
  'LLY': 'https://logo.clearbit.com/lilly.com',
  'TMO': 'https://logo.clearbit.com/thermofisher.com',
  'ABT': 'https://logo.clearbit.com/abbott.com',
  'DHR': 'https://logo.clearbit.com/danaher.com',
  'BMY': 'https://logo.clearbit.com/bms.com',
  'MRNA': 'https://logo.clearbit.com/modernatx.com',

  // Consumer
  'WMT': 'https://logo.clearbit.com/walmart.com',
  'HD': 'https://logo.clearbit.com/homedepot.com',
  'PG': 'https://logo.clearbit.com/pg.com',
  'KO': 'https://logo.clearbit.com/coca-cola.com',
  'PEP': 'https://logo.clearbit.com/pepsico.com',
  'COST': 'https://logo.clearbit.com/costco.com',
  'DIS': 'https://logo.clearbit.com/disney.com',
  'NKE': 'https://logo.clearbit.com/nike.com',
  'MCD': 'https://logo.clearbit.com/mcdonalds.com',
  'SBUX': 'https://logo.clearbit.com/starbucks.com',
  'TGT': 'https://logo.clearbit.com/target.com',
  'LOW': 'https://logo.clearbit.com/lowes.com',

  // Industrial
  'BA': 'https://logo.clearbit.com/boeing.com',
  'CAT': 'https://logo.clearbit.com/caterpillar.com',
  'GE': 'https://logo.clearbit.com/ge.com',
  'MMM': 'https://logo.clearbit.com/3m.com',
  'HON': 'https://logo.clearbit.com/honeywell.com',
  'UPS': 'https://logo.clearbit.com/ups.com',
  'FDX': 'https://logo.clearbit.com/fedex.com',
  'LMT': 'https://logo.clearbit.com/lockheedmartin.com',
  'RTX': 'https://logo.clearbit.com/rtx.com',
  'DE': 'https://logo.clearbit.com/deere.com',

  // Energy
  'XOM': 'https://logo.clearbit.com/exxonmobil.com',
  'CVX': 'https://logo.clearbit.com/chevron.com',
  'COP': 'https://logo.clearbit.com/conocophillips.com',
  'SLB': 'https://logo.clearbit.com/slb.com',
  'EOG': 'https://logo.clearbit.com/eogresources.com',

  // Communication
  'T': 'https://logo.clearbit.com/att.com',
  'VZ': 'https://logo.clearbit.com/verizon.com',
  'TMUS': 'https://logo.clearbit.com/t-mobile.com',
  'CMCSA': 'https://logo.clearbit.com/comcast.com',
  'CHTR': 'https://logo.clearbit.com/charter.com',
}

// Sector colors for fallback logo generation
const SECTOR_COLORS = {
  'Technology': '#8B5CF6',
  'Financial': '#10B981',
  'Healthcare': '#EC4899',
  'Consumer': '#F59E0B',
  'Industrial': '#6366F1',
  'Energy': '#EF4444',
  'Materials': '#14B8A6',
  'Utilities': '#06B6D4',
  'Real Estate': '#84CC16',
  'Communication': '#3B82F6',
  'Index': '#6366F1',
  'Commodity': '#D97706',
  'Automotive': '#A855F7',
  'default': '#8B5CF6',
}

// Futures symbols don't have FMP logos — map to their ETF equivalents
const FUTURES_LOGO_MAP = {
  'GC=F': 'GLD', 'SI=F': 'SLV', 'CL=F': 'USO', 'NG=F': 'UNG',
  'HG=F': 'CPER', 'PL=F': 'PPLT', 'PA=F': 'PALL',
}

// Get stock logo - uses FinancialModelingPrep CDN (free, no API key, 250x250 PNG)
// Clearbit logos are DEAD - always use FMP as primary source
// Logo overrides for tickers the FMP CDN doesn't carry yet (e.g. brand-new
// listings). TradingView's symbol-logo CDN (img-src allows https: in the CSP).
//
// SPCX override REMOVED 2026-08-02: TradingView serves a NASDAQ "NMS - GLOBAL
// MARKET" listing badge for it, not a brand mark - it rendered as a ring of
// exchange text around a tiny wordmark. FMP does carry SPCX now (verified: a
// clean SpaceX wordmark on black), so the default path is correct here and the
// override was actively making it worse. Re-add an entry ONLY after eyeballing
// the actual image the URL returns.
const STOCK_LOGO_OVERRIDES = {}

export function getStockLogo(symbol, sector = null) {
  if (!symbol) return null
  const upper = symbol.toUpperCase()

  if (STOCK_LOGO_OVERRIDES[upper]) return STOCK_LOGO_OVERRIDES[upper]

  // Futures → use corresponding ETF logo
  const mapped = FUTURES_LOGO_MAP[upper]
  if (mapped) return `https://financialmodelingprep.com/image-stock/${mapped}.png`

  // Primary: FMP stock logo CDN (works for all US equities + ETFs)
  return `https://financialmodelingprep.com/image-stock/${upper}.png`
}

// Stock descriptions (like COIN_DESCRIPTIONS for crypto)
export const STOCK_DESCRIPTIONS = {
  'SPY': 'SPDR S&P 500 ETF Trust - Tracks the S&P 500 index, representing 500 of the largest U.S. companies. One of the most liquid ETFs in the world.',
  'QQQ': 'Invesco QQQ Trust - Tracks the Nasdaq-100 Index, heavily weighted towards large-cap technology companies including Apple, Microsoft, and Amazon.',
  'AAPL': 'Apple Inc. - World\'s largest company by market cap. Designs, manufactures, and markets consumer electronics, software, and services including iPhone, iPad, Mac, and Apple Watch.',
  'MSFT': 'Microsoft Corporation - Global technology leader in software, cloud computing (Azure), and productivity solutions. Creator of Windows, Office 365, and Xbox.',
  'GOOGL': 'Alphabet Inc. - Parent company of Google. Dominates internet search, digital advertising, and owns YouTube, Android, and Google Cloud Platform.',
  'AMZN': 'Amazon.com Inc. - World\'s largest e-commerce company and leading cloud computing provider (AWS). Also operates in digital streaming, AI, and logistics.',
  'NVDA': 'NVIDIA Corporation - Leading designer of graphics processing units (GPUs). Dominates AI chip market and gaming graphics. Key supplier for data centers.',
  'TSLA': 'Tesla Inc. - Electric vehicle manufacturer and clean energy company. Led by Elon Musk. Also produces energy storage systems and solar panels.',
  'META': 'Meta Platforms Inc. - Social media giant operating Facebook, Instagram, WhatsApp, and Messenger. Investing heavily in metaverse and VR/AR technology.',
  'JPM': 'JPMorgan Chase & Co. - Largest U.S. bank by assets. Provides investment banking, financial services, asset management, and commercial banking.',
  'V': 'Visa Inc. - Global payments technology company. Operates the world\'s largest retail electronic payments network connecting consumers, businesses, and banks.',
  'JNJ': 'Johnson & Johnson - Diversified healthcare conglomerate. Develops medical devices, pharmaceuticals, and consumer packaged goods.',
  // ── Commodity Futures ──
  'GC=F': 'Gold Futures (COMEX) - Front-month gold futures contract. Gold is the world\'s primary store-of-value commodity, priced per troy ounce.',
  'SI=F': 'Silver Futures (COMEX) - Front-month silver futures contract. Silver has both industrial and monetary value, priced per troy ounce.',
  'CL=F': 'WTI Crude Oil Futures (NYMEX) - Front-month West Texas Intermediate crude oil futures. The primary U.S. oil price benchmark.',
  'NG=F': 'Natural Gas Futures (NYMEX) - Front-month Henry Hub natural gas futures. Key benchmark for U.S. natural gas pricing.',
  'HG=F': 'Copper Futures (COMEX) - Front-month copper futures. Copper is a key industrial metal and economic bellwether, often called "Dr. Copper".',
  'PL=F': 'Platinum Futures (NYMEX) - Front-month platinum futures. Used in automotive catalysts, jewelry, and industrial applications.',
  'PA=F': 'Palladium Futures (NYMEX) - Front-month palladium futures. Critical for catalytic converters in gasoline vehicles.',
  // ── Commodity ETF Descriptions ──
  'GLD': 'SPDR Gold Trust - World\'s largest physically backed gold ETF. Each share represents approximately 1/10th of an ounce of gold stored in HSBC London vaults.',
  'IAU': 'iShares Gold Trust - Low-cost gold bullion ETF by BlackRock. Tracks gold spot price with shares representing fractional ownership of gold bars.',
  'SGOL': 'Aberdeen Standard Physical Gold - Swiss-vaulted gold ETF. All gold bars stored in secure vaults in Zurich, Switzerland.',
  'SLV': 'iShares Silver Trust - Largest physical silver ETF. Tracks the spot price of silver with bullion stored in JPMorgan Chase London and New York vaults.',
  'PPLT': 'abrdn Physical Platinum - Physically backed platinum ETF. Provides exposure to platinum spot price, used in automotive catalysts and jewelry.',
  'PALL': 'abrdn Physical Palladium - Physically backed palladium ETF. Palladium is critical for catalytic converters and increasingly rare.',
  'USO': 'United States Oil Fund - Tracks WTI crude oil futures (front-month contracts). The most liquid crude oil ETF for short-term oil exposure.',
  'BNO': 'United States Brent Oil Fund - Tracks Brent crude oil futures. Brent is the global benchmark for two-thirds of world oil pricing.',
  'UNG': 'United States Natural Gas Fund - Tracks natural gas futures (Henry Hub). Highly volatile, used for short-term natural gas exposure.',
  'DBA': 'Invesco DB Agriculture Fund - Diversified agriculture basket: corn, soybeans, wheat, sugar, cocoa, coffee, cotton, cattle, hogs.',
  'CORN': 'Teucrium Corn Fund - Pure-play corn futures ETF using a laddered contract strategy to reduce roll risk.',
  'WEAT': 'Teucrium Wheat Fund - Pure-play wheat futures ETF. Wheat is a staple grain traded globally on CBOT.',
  'SOYB': 'Teucrium Soybean Fund - Pure-play soybean futures ETF. Soybeans are the world\'s most traded oilseed crop.',
  'CANE': 'Teucrium Sugar Fund - Pure-play sugar futures ETF. Tracks ICE Sugar No. 11 futures contracts.',
  'CPER': 'United States Copper Fund - Tracks copper futures. Copper is a key industrial metal and economic bellwether.',
  'LIT': 'Global X Lithium & Battery Tech ETF - Companies in the full lithium cycle: mining, refining, and battery production.',
  'URA': 'Global X Uranium ETF - Companies in uranium mining and nuclear energy. Beneficiary of clean energy transition.',
  'NEM': 'Newmont Corporation - World\'s largest gold mining company. Operations across the Americas, Australia, and Africa.',
  'GOLD': 'Barrick Gold Corporation - Second-largest gold miner globally. Major operations in Nevada, Dominican Republic, and Tanzania.',
  'FCX': 'Freeport-McMoRan - World\'s largest publicly traded copper producer. Also mines gold and molybdenum from the massive Grasberg mine.',
  'VALE': 'Vale S.A. - Brazilian mining giant. World\'s largest iron ore producer and major nickel producer.',
  'BHP': 'BHP Group - World\'s largest mining company by market cap. Produces iron ore, copper, coal, nickel, and potash globally.',
  'RIO': 'Rio Tinto plc - Global mining giant producing iron ore, aluminum, copper, diamonds, and minerals across 35+ countries.',
  'DJP': 'iPath Bloomberg Commodity Index - Broad commodity exposure across energy, metals, and agriculture via Bloomberg Commodity Total Return Index.',
  'GSG': 'iShares S&P GSCI Commodity - Broad commodity exposure weighted heavily toward energy via S&P GSCI Total Return Index.',
  'PDBC': 'Invesco Optimum Yield Diversified Commodity - Actively managed commodity ETF targeting 14 commodities with optimized futures roll.',
}

// Common stock indices
export const MARKET_INDICES = [
  { symbol: '^GSPC', name: 'S&P 500', shortName: 'SPX' },
  { symbol: '^DJI', name: 'Dow Jones Industrial Average', shortName: 'DOW' },
  { symbol: '^IXIC', name: 'Nasdaq Composite', shortName: 'NASDAQ' },
  { symbol: '^RUT', name: 'Russell 2000', shortName: 'RUT' },
  { symbol: '^VIX', name: 'CBOE Volatility Index', shortName: 'VIX' },
]

export default {
  TOP_STOCKS,
  WELCOME_STOCKS,
  STOCK_SECTORS,
  STOCK_LOGOS,
  STOCK_DESCRIPTIONS,
  MARKET_INDICES,
  getStockLogo,
}
