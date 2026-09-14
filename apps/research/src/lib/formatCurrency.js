import { CURRENCIES } from './currencyConfig'

export function getCurrencySymbol(code) {
  return CURRENCIES[code]?.symbol || '$'
}

function getDecimals(code) {
  return CURRENCIES[code]?.decimals
}

function getLocale(code) {
  return CURRENCIES[code]?.locale || 'en-US'
}

function sym(code) {
  return getCurrencySymbol(code)
}

function locNum(value, code, minDec, maxDec) {
  const locale = getLocale(code)
  return value.toLocaleString(locale, {
    minimumFractionDigits: minDec,
    maximumFractionDigits: maxDec,
  })
}

export function formatPrice(usdValue, currencyCode = 'USD', rate = 1) {
  const p = typeof usdValue === 'number' ? usdValue : parseFloat(usdValue)
  if (!p || isNaN(p) || !isFinite(p)) return `${sym(currencyCode)}0.00`

  const converted = p * rate
  const abs = Math.abs(converted)
  const zeroDecimal = getDecimals(currencyCode) === 0

  if (zeroDecimal) {
    if (abs >= 1) return `${sym(currencyCode)}${locNum(Math.round(converted), currencyCode, 0, 0)}`
    return `${sym(currencyCode)}${converted.toFixed(4)}`
  }

  if (abs >= 1000) return `${sym(currencyCode)}${locNum(converted, currencyCode, 2, 2)}`
  if (abs >= 1) return `${sym(currencyCode)}${converted.toFixed(2)}`
  if (abs >= 0.01) return `${sym(currencyCode)}${converted.toFixed(4)}`
  if (abs >= 0.0001) return `${sym(currencyCode)}${converted.toFixed(6)}`
  return `${sym(currencyCode)}${converted.toFixed(8)}`
}

export function formatLargeNumber(usdValue, currencyCode = 'USD', rate = 1) {
  const n = typeof usdValue === 'number' ? usdValue : parseFloat(usdValue)
  if (!n || isNaN(n) || !isFinite(n)) return `${sym(currencyCode)}0`

  const converted = n * rate
  const abs = Math.abs(converted)

  if (abs >= 1e12) return `${sym(currencyCode)}${locNum(converted / 1e12, currencyCode, 2, 2)}T`
  if (abs >= 1e9) return `${sym(currencyCode)}${locNum(converted / 1e9, currencyCode, 2, 2)}B`
  if (abs >= 1e6) return `${sym(currencyCode)}${locNum(converted / 1e6, currencyCode, 2, 2)}M`
  if (abs >= 1000) return `${sym(currencyCode)}${Math.round(converted).toLocaleString(getLocale(currencyCode))}`
  if (abs >= 100) return `${sym(currencyCode)}${locNum(converted, currencyCode, 1, 1)}`
  return `${sym(currencyCode)}${locNum(converted, currencyCode, 2, 2)}`
}

export function formatPriceShort(usdValue, currencyCode = 'USD', rate = 1) {
  const p = typeof usdValue === 'number' ? usdValue : parseFloat(usdValue)
  if (!p || isNaN(p) || !isFinite(p)) return `${sym(currencyCode)}0`

  const converted = p * rate
  const abs = Math.abs(converted)

  if (abs >= 1e9) return `${sym(currencyCode)}${(converted / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sym(currencyCode)}${(converted / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sym(currencyCode)}${(converted / 1e3).toFixed(1)}K`
  if (abs >= 1) return `${sym(currencyCode)}${converted.toFixed(2)}`
  if (abs >= 0.01) return `${sym(currencyCode)}${converted.toFixed(4)}`
  return `${sym(currencyCode)}${converted.toFixed(6)}`
}

export function formatLargeNumberShort(usdValue, currencyCode = 'USD', rate = 1) {
  const n = typeof usdValue === 'number' ? usdValue : parseFloat(usdValue)
  if (!n || isNaN(n) || !isFinite(n)) return `${sym(currencyCode)}0`

  const converted = n * rate
  const abs = Math.abs(converted)

  if (abs >= 1e12) return `${sym(currencyCode)}${(converted / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${sym(currencyCode)}${(converted / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sym(currencyCode)}${(converted / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sym(currencyCode)}${(converted / 1e3).toFixed(1)}K`
  if (abs >= 1) return `${sym(currencyCode)}${converted.toFixed(1)}`
  return `${sym(currencyCode)}${converted.toFixed(2)}`
}
