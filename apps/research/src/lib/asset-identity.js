export const isStockAsset = token => Boolean(token && (token.isStock || token.type === 'stock' || token.assetClass === 'stock'))

// The caller supplies the owning watchlist's market, never a ticker guess.
// Stock and crypto watchlists are persisted in separate collections.
export function normalizeAssetForMarket(token, marketMode) {
  if (!token || marketMode !== 'stocks') return token
  if (token.isStock === true && token.assetClass === 'stock') return token
  return { ...token, isStock: true, assetClass: 'stock' }
}
