import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import i18n from 'i18next'
import useSettingsStore from '@/store/useSettingsStore'
import { CURRENCIES, LANGUAGES } from '@/lib/currencyConfig'
import { fetchExchangeRates, getRate } from '@/lib/exchangeRates'
import {
  formatPrice as fmtP,
  formatLargeNumber as fmtL,
  formatPriceShort as fmtPS,
  formatLargeNumberShort as fmtLS,
  getCurrencySymbol,
} from '@/lib/formatCurrency'

// Two separate contexts so format-only consumers don't re-render on language change,
// and settings-only consumers don't re-render when exchange rates refresh.
const CurrencySettingsContext = createContext(null)
const CurrencyFormatContext = createContext(null)

export function I18nCurrencyProvider({ children }) {
  const currency = useSettingsStore((s) => s.currency)
  const language = useSettingsStore((s) => s.language)
  const storeCurrency = useSettingsStore((s) => s.setCurrency)
  const storeLanguage = useSettingsStore((s) => s.setLanguage)

  const [rates, setRates] = useState(null)

  useEffect(() => {
    // USD is the default and needs no FX rate (getRate('USD', …) returns 1), so
    // skip the boot request + the 15-min timer entirely for USD users (the
    // majority). When the user switches to a non-USD currency, the `currency`
    // dep re-runs this effect and fetches then.
    if (currency === 'USD') return
    const load = async () => {
      const r = await fetchExchangeRates()
      setRates(r)
    }
    load()
    const interval = setInterval(() => {
      if (document.hidden) return
      load()
    }, 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [currency])

  const exchangeRate = useMemo(() => getRate(currency, rates), [currency, rates])

  const setCurrency = useCallback((code) => {
    if (CURRENCIES[code]) {
      storeCurrency(code)
    }
  }, [storeCurrency])

  const setLanguage = useCallback(async (code) => {
    if (LANGUAGES[code]) {
      storeLanguage(code)
      if (code !== 'en') {
        try {
          if (!i18n.hasResourceBundle(code, 'translation')) {
            const mod = await import(`../i18n/locales/${code}.json`)
            i18n.addResourceBundle(code, 'translation', mod.default)
          }
        } catch (err) {
          // silently handled
        }
      }
      i18n.changeLanguage(code)
      document.documentElement.dir = LANGUAGES[code].dir || 'ltr'
      document.documentElement.lang = code
    }
  }, [storeLanguage])

  useEffect(() => {
    const lang = LANGUAGES[language]
    if (lang) {
      document.documentElement.dir = lang.dir || 'ltr'
      document.documentElement.lang = language
    }
    // Keep i18n in sync with the Zustand language on every change, including
    // mutations that bypass the setLanguage callback (e.g. mergeServerSettings).
    ;(async () => {
      try {
        if (language !== 'en' && !i18n.hasResourceBundle(language, 'translation')) {
          const mod = await import(`../i18n/locales/${language}.json`)
          i18n.addResourceBundle(language, 'translation', mod.default)
        }
        if (i18n.language !== language) i18n.changeLanguage(language)
      } catch {
        if (i18n.language !== 'en') i18n.changeLanguage('en')
      }
    })()
  }, [language])

  const fmtPrice = useCallback((usdValue) => fmtP(usdValue, currency, exchangeRate), [currency, exchangeRate])
  const fmtLarge = useCallback((usdValue) => fmtL(usdValue, currency, exchangeRate), [currency, exchangeRate])
  const fmtPriceShort = useCallback((usdValue) => fmtPS(usdValue, currency, exchangeRate), [currency, exchangeRate])
  const fmtLargeShort = useCallback((usdValue) => fmtLS(usdValue, currency, exchangeRate), [currency, exchangeRate])

  const currencySymbol = getCurrencySymbol(currency)
  const currencyConfig = CURRENCIES[currency] || CURRENCIES.USD
  const languageConfig = LANGUAGES[language] || LANGUAGES.en

  const settingsValue = useMemo(() => ({
    currency,
    setCurrency,
    language,
    setLanguage,
    currencySymbol,
    currencyConfig,
    languageConfig,
  }), [currency, setCurrency, language, setLanguage, currencySymbol, currencyConfig, languageConfig])

  const formatValue = useMemo(() => ({
    exchangeRate,
    fmtPrice,
    fmtLarge,
    fmtPriceShort,
    fmtLargeShort,
  }), [exchangeRate, fmtPrice, fmtLarge, fmtPriceShort, fmtLargeShort])

  return (
    <CurrencySettingsContext.Provider value={settingsValue}>
      <CurrencyFormatContext.Provider value={formatValue}>
        {children}
      </CurrencyFormatContext.Provider>
    </CurrencySettingsContext.Provider>
  )
}

export const useCurrencySettings = () => useContext(CurrencySettingsContext)
export const useCurrencyFormat = () => useContext(CurrencyFormatContext)

// Backward-compatible composite hook. New code should prefer the narrower hooks above.
export const useCurrency = () => {
  const settings = useContext(CurrencySettingsContext)
  const format = useContext(CurrencyFormatContext)
  return useMemo(() => ({ ...settings, ...format }), [settings, format])
}

export default CurrencyFormatContext
