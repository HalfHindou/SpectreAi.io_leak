import { isStockAsset, normalizeAssetForMarket } from '../../../lib/asset-identity'

export function buildWelcomeChartToken(token, marketData, fallbackLogo) {
  const stock = isStockAsset(token)
  return {
    ...normalizeAssetForMarket(token, stock ? 'stocks' : 'crypto'),
    name: token.name || token.symbol,
    cgId: stock ? null : token.cgId || token.id || null,
    logo: token.logo || fallbackLogo,
    sparkline_7d: token.sparkline_7d ?? (stock ? null : marketData?.sparkline_7d) ?? null,
  }
}
