// A ticker alone cannot distinguish a coin from a listed fund (BTC/ETH).
// Use saved identity, including the user's original crypto collections.
export function isCryptoWatchlistEntry(token, cryptoLists = []) {
  if (!token) return false
  if (token.address || token.cgId || token.cg_id || token.assetClass === 'crypto' || token.type === 'crypto') return true
  const symbol = String(token.symbol || '').toUpperCase()
  const name = String(token.name || '').trim().toLowerCase()
  if (!symbol || !name) return false
  return cryptoLists.some(list => (list.tokens || []).some(coin =>
    String(coin.symbol || '').toUpperCase() === symbol &&
    String(coin.name || '').trim().toLowerCase() === name
  ))
}

// Reordering cannot import another market's rows, delete favourites, or replace
// saved identity with display data (such as an ETF quote matched by ticker).
export function reorderExistingTokens(tokens, order) {
  const remaining = [...tokens]
  const result = []
  for (const item of order) {
    const index = remaining.findIndex(token => item.address && token.address
      ? String(item.address).toLowerCase() === String(token.address).toLowerCase()
      : String(item.symbol || '').toUpperCase() === String(token.symbol || '').toUpperCase())
    if (index >= 0) result.push(...remaining.splice(index, 1))
  }
  return [...result, ...remaining]
}
