/**
 * CoinGecko ID → Binance symbol mapping for TradingView widget embedding.
 * Used by tradingview-embed.jsx to build the `symbol=BINANCE:XYZUSDT` URL param.
 * Only tokens with active Binance USDT spot pairs are listed. For tokens not in
 * this map, the TradingView mode is disabled in the UI.
 */
export const CG_TO_BINANCE = {
  bitcoin: 'BTCUSDT',
  ethereum: 'ETHUSDT',
  solana: 'SOLUSDT',
  binancecoin: 'BNBUSDT',
  ripple: 'XRPUSDT',
  cardano: 'ADAUSDT',
  dogecoin: 'DOGEUSDT',
  'avalanche-2': 'AVAXUSDT',
  chainlink: 'LINKUSDT',
  polkadot: 'DOTUSDT',
  'matic-network': 'MATICUSDT',
  litecoin: 'LTCUSDT',
  'bitcoin-cash': 'BCHUSDT',
  tron: 'TRXUSDT',
  stellar: 'XLMUSDT',
  'ethereum-classic': 'ETCUSDT',
  monero: 'XMRUSDT',
  cosmos: 'ATOMUSDT',
  aptos: 'APTUSDT',
  arbitrum: 'ARBUSDT',
  optimism: 'OPUSDT',
  sui: 'SUIUSDT',
  'near': 'NEARUSDT',
  filecoin: 'FILUSDT',
  'internet-computer': 'ICPUSDT',
  'hedera-hashgraph': 'HBARUSDT',
  vechain: 'VETUSDT',
  'injective-protocol': 'INJUSDT',
  'the-graph': 'GRTUSDT',
  aave: 'AAVEUSDT',
  uniswap: 'UNIUSDT',
  maker: 'MKRUSDT',
  'curve-dao-token': 'CRVUSDT',
  'lido-dao': 'LDOUSDT',
  'pepe': '1000PEPEUSDT',
  'shiba-inu': 'SHIBUSDT',
  'bonk': 'BONKUSDT',
  'dogwifhat': 'WIFUSDT',
  'floki': 'FLOKIUSDT',
  render: 'RNDRUSDT',
  'fetch-ai': 'FETUSDT',
  immutable: 'IMXUSDT',
  'theta-token': 'THETAUSDT',
  algorand: 'ALGOUSDT',
  'sei-network': 'SEIUSDT',
  tia: 'TIAUSDT',
  'axie-infinity': 'AXSUSDT',
  'the-sandbox': 'SANDUSDT',
  decentraland: 'MANAUSDT',
  apecoin: 'APEUSDT',
}

export function getBinanceSymbol(cgId) {
  if (!cgId) return null
  return CG_TO_BINANCE[cgId.toLowerCase()] || null
}
