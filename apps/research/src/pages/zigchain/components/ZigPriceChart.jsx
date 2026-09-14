/**
 * ZIGChain price chart — TradingView Advanced widget for ZIG/USDT.
 * Uses iframe embed (https://s.tradingview.com — already allowed in CSP frame-src)
 * so we don't need to whitelist a script source.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'

const TIMEFRAMES = [
  { label: '1H',  interval: '60' },
  { label: '4H',  interval: '240' },
  { label: '1D',  interval: 'D' },
  { label: '1W',  interval: 'W' },
  { label: '1M',  interval: 'M' },
]

const SYMBOLS = [
  { label: 'Bybit',  value: 'BYBIT:ZIGUSDT' },
  { label: 'KuCoin', value: 'KUCOIN:ZIGUSDT' },
  { label: 'Gate',   value: 'GATEIO:ZIGUSDT' },
]

// TradingView supports these locales — fall back to 'en' for anything else.
const TV_LOCALES = new Set(['en', 'ar', 'es', 'fr', 'hi', 'pt', 'ru', 'zh'])

function buildEmbedUrl(symbol, interval, dayMode, lang) {
  const base = (lang || 'en').split('-')[0].toLowerCase()
  const tvLocale = TV_LOCALES.has(base) ? base : 'en'
  const params = new URLSearchParams({
    frameElementId: 'zig_tv',
    symbol,
    interval,
    theme: dayMode ? 'light' : 'dark',
    style: '1',
    locale: tvLocale,
    hide_top_toolbar: '0',
    hide_side_toolbar: '1',
    hide_legend: '0',
    allow_symbol_change: '0',
    save_image: '0',
    studies: '[]',
    backgroundColor: dayMode ? 'rgba(255,255,255,1)' : 'rgba(15,15,17,1)',
    toolbar_bg: dayMode ? '#ffffff' : '#0f0f11',
  })
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`
}

export default function ZigPriceChart() {
  const { t, i18n } = useTranslation()
  const [resolution, setResolution] = useState('D') // renamed from [interval, setInterval] which shadowed the global setInterval
  const [symbol, setSymbol] = useState('BYBIT:ZIGUSDT')
  const [loaded, setLoaded] = useState(false)
  const dayMode = useSettingsStore((s) => s.dayMode)
  const iframeRef = useRef(null)

  // Force iframe remount on theme/symbol/interval/lang change
  const src = useMemo(() => buildEmbedUrl(symbol, resolution, dayMode, i18n.language), [symbol, resolution, dayMode, i18n.language])

  useEffect(() => { setLoaded(false) }, [src])

  const exchangeLabel = symbol.split(':')[0]

  return (
    <div className="zpx">
      <div className="zpx-head">
        <div className="zpx-id">
          <span className="zpx-eyebrow">{t('zigchainChrome.price.eyebrow', 'Price · ZIG / USDT')}</span>
          <div className="zpx-exchanges" role="tablist" aria-label={t('zigchainChrome.aria.exchange', 'Exchange')}>
            {SYMBOLS.map((s) => (
              <button
                key={s.value}
                role="tab"
                aria-selected={symbol === s.value}
                className={`zpx-exchange${symbol === s.value ? ' is-on' : ''}`}
                onClick={() => setSymbol(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="zpx-tfs" role="tablist" aria-label={t('zigchainChrome.aria.timeframe', 'Timeframe')}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.interval}
              role="tab"
              aria-selected={resolution === tf.interval}
              className={`zpx-tf${resolution === tf.interval ? ' is-on' : ''}`}
              onClick={() => setResolution(tf.interval)}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div className="zpx-frame">
        {!loaded && (
          <div className="zpx-skel" aria-hidden>
            <div className="zpx-skel-shimmer" />
          </div>
        )}
        <iframe
          key={src}
          ref={iframeRef}
          src={src}
          title={`${exchangeLabel} ZIG/USDT chart`}
          className="zpx-iframe"
          frameBorder="0"
          loading="lazy"
          allow="fullscreen"
          allowFullScreen
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  )
}
