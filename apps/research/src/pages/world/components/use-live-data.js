/**
 * useLiveData — Multi-exchange real-time WebSocket data.
 *
 * ┌──────────────────┐    ┌──────────────┐    ┌─────────────┐
 * │  6 WebSockets    │───▸│  ONE ref buf │───▸│  ONE setState│
 * │  (100+ msg/sec)  │    │  (no render) │    │  (every 4s)  │
 * └──────────────────┘    └──────────────┘    └─────────────┘
 *
 * PERF v2: all 6 sources write to a SINGLE ref buffer.
 * ONE setInterval flushes to React state every 4 seconds.
 * Old version had 6 independent flushes = 6 re-renders per cycle.
 * Now: 1 re-render per 4s. Period.
 */
import { useState, useEffect, useRef } from 'react'
import { isDev } from '@/utils/env'
import { getSpectrePricesBySymbols } from '@/services/spectreMarketApi'

const FLUSH_MS = 4000
const RECONNECT_MS = 5000
const MAX_MEMPOOL_TXS = 8
const MEMPOOL_MIN_BTC = 0.5

const OKX_PAIRS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT', 'ADA-USDT', 'AVAX-USDT', 'DOT-USDT']
const BYBIT_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT']
const KRAKEN_PAIRS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'DOT/USD', 'ADA/USD']
const COINCAP_ASSETS = [
  'bitcoin', 'ethereum', 'binancecoin', 'solana', 'ripple', 'cardano',
  'dogecoin', 'polkadot', 'avalanche-2', 'chainlink', 'tron', 'toncoin',
  'uniswap', 'litecoin', 'near-protocol', 'stellar', 'sui', 'aptos',
].join(',')

/* ── Raw WebSocket with auto-reconnect. Returns cleanup fn. ── */
function connectWS(url, { onMessage, onOpen, onStatus }) {
  let active = true, ws = null, timer = null
  const connect = () => {
    if (!active) return
    try {
      ws = new WebSocket(url)
      ws.onopen = () => { if (active) { onStatus(true); onOpen?.(ws) } }
      ws.onmessage = (e) => { if (active) onMessage(e) }
      ws.onclose = () => { if (active) { onStatus(false); timer = setTimeout(connect, RECONNECT_MS) } }
      ws.onerror = () => ws?.close()
    } catch { if (active) timer = setTimeout(connect, RECONNECT_MS) }
  }
  connect()
  return () => { active = false; clearTimeout(timer); ws?.close() }
}

function sumValues(obj) {
  let s = 0; for (const k in obj) s += obj[k]; return s
}

const INITIAL = {
  prices: {}, totalVolume: 0, topPairs: [],
  connected: false, wsConnected: false,
  exchanges: {
    binance: { id: 'binance', volume: 0, connected: false },
    okx: { id: 'okx', volume: 0, connected: false },
    bybit: { id: 'bybit', volume: 0, connected: false },
    kraken: { id: 'kraken', volume: 0, connected: false },
  },
  mempool: { txs: [], connected: false },
  connectionCount: 0,
}

/* ═══════════════════════════════════════════════
   SINGLE HOOK — all 6 connections, 1 flush
   ═══════════════════════════════════════════════ */
export default function useLiveData() {
  const buf = useRef({
    binance: { volume: 0, pairs: [], connected: false },
    okx: { volumes: {}, connected: false },
    bybit: { volumes: {}, connected: false },
    kraken: { volumes: {}, connected: false },
    mempool: { txs: [], connected: false },
    coincap: { prices: {}, connected: false },
  })

  const [data, setData] = useState(INITIAL)

  useEffect(() => {
    let cancelled = false

    const applySpectreSnapshot = async () => {
      const prices = await getSpectrePricesBySymbols(['BTC', 'ETH', 'SOL', 'XRP']).catch(() => null)
      if (cancelled || !prices) return
      const pairs = ['BTC', 'ETH', 'SOL', 'XRP']
        .map((symbol) => {
          const row = prices[symbol]
          if (!row?.price) return null
          return {
            symbol,
            price: row.price,
            volume24h: row.volume || 0,
            change24h: row.change24 ?? row.change ?? 0,
          }
        })
        .filter(Boolean)

      if (!pairs.length) return

      setData((prev) => ({
        ...prev,
        prices: pairs.reduce((acc, pair) => {
          acc[pair.symbol.toLowerCase()] = pair.price
          return acc
        }, {}),
        totalVolume: pairs.reduce((sum, pair) => sum + (pair.volume24h || 0), 0),
        topPairs: pairs,
        connected: true,
        wsConnected: prev.wsConnected,
      }))
    }

    applySpectreSnapshot()

    if (isDev) {
      const fallbackTimer = setInterval(applySpectreSnapshot, 30_000)
      return () => { cancelled = true; clearInterval(fallbackTimer) }
    }

    const b = buf.current

    // All 6 sockets are (re)opened together. openAll() returns a disconnect fn
    // that closes every socket + stops its reconnect timer. We tear down on tab
    // hide and re-open on tab show so background tabs hold zero live sockets.
    function openAll() {
    // ── BINANCE ──
    const d1 = connectWS('wss://stream.binance.com:9443/ws/!miniTicker@arr', {
      onStatus: (c) => { b.binance.connected = c },
      onMessage: (e) => {
        try {
          const arr = JSON.parse(e.data)
          if (!Array.isArray(arr)) return
          const usdt = arr.filter(t => t.s?.endsWith('USDT'))
          b.binance.volume = usdt.reduce((s, t) => s + parseFloat(t.q || 0), 0)
          b.binance.pairs = usdt
            .map(t => ({
              symbol: t.s.replace('USDT', ''),
              price: parseFloat(t.c || 0),
              volume24h: parseFloat(t.q || 0),
              change24h: parseFloat(t.o) > 0
                ? ((parseFloat(t.c) - parseFloat(t.o)) / parseFloat(t.o)) * 100 : 0,
            }))
            .sort((a, bb) => bb.volume24h - a.volume24h)
            .slice(0, 15)
        } catch {}
      },
    })

    // ── OKX ──
    const d2 = connectWS('wss://ws.okx.com:8443/ws/v5/public', {
      onOpen: (ws) => {
        ws.send(JSON.stringify({ op: 'subscribe', args: OKX_PAIRS.map(id => ({ channel: 'tickers', instId: id })) }))
      },
      onStatus: (c) => { b.okx.connected = c },
      onMessage: (e) => {
        try {
          const msg = JSON.parse(e.data)
          const tick = msg.data?.[0]
          if (tick?.instId && tick?.volCcy24h) b.okx.volumes[tick.instId] = parseFloat(tick.volCcy24h)
        } catch {}
      },
    })

    // ── BYBIT ──
    const d3 = connectWS('wss://stream.bybit.com/v5/public/spot', {
      onOpen: (ws) => {
        ws.send(JSON.stringify({ op: 'subscribe', args: BYBIT_PAIRS.map(s => `tickers.${s}`) }))
      },
      onStatus: (c) => { b.bybit.connected = c },
      onMessage: (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.data?.symbol && msg.data?.turnover24h) b.bybit.volumes[msg.data.symbol] = parseFloat(msg.data.turnover24h)
        } catch {}
      },
    })

    // ── KRAKEN ──
    const d4 = connectWS('wss://ws.kraken.com/v2', {
      onOpen: (ws) => {
        ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ticker', symbol: KRAKEN_PAIRS } }))
      },
      onStatus: (c) => { b.kraken.connected = c },
      onMessage: (e) => {
        try {
          const msg = JSON.parse(e.data)
          const tick = msg.data?.[0]
          if (tick?.symbol && tick?.volume) b.kraken.volumes[tick.symbol] = parseFloat(tick.volume || 0) * parseFloat(tick.last || 0)
        } catch {}
      },
    })

    // ── BTC MEMPOOL ──
    const d5 = connectWS('wss://ws.blockchain.info/inv', {
      onOpen: (ws) => { ws.send(JSON.stringify({ op: 'unconfirmed_sub' })) },
      onStatus: (c) => { b.mempool.connected = c },
      onMessage: (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.op !== 'utx' || !msg.x) return
          const totalBTC = (msg.x.out || []).reduce((s, o) => s + (o.value || 0), 0) / 1e8
          if (totalBTC < MEMPOOL_MIN_BTC) return
          b.mempool.txs.push({ hash: msg.x.hash?.slice(0, 12), btc: totalBTC, timestamp: Date.now() })
          if (b.mempool.txs.length > MAX_MEMPOOL_TXS * 3) b.mempool.txs = b.mempool.txs.slice(-MAX_MEMPOOL_TXS)
        } catch {}
      },
    })

    // ── COINCAP ──
    const d6 = connectWS(`wss://ws.coincap.io/prices?assets=${COINCAP_ASSETS}`, {
      onStatus: (c) => { b.coincap.connected = c },
      onMessage: (e) => {
        try { Object.assign(b.coincap.prices, JSON.parse(e.data)) } catch {}
      },
    })

      return () => { d1(); d2(); d3(); d4(); d5(); d6() }
    }

    let disconnectAll = openAll()

    // Pause every socket while the tab is hidden; restore on return.
    const onVisibility = () => {
      if (document.hidden) {
        disconnectAll?.()
        disconnectAll = null
      } else if (!disconnectAll) {
        disconnectAll = openAll()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // ── SINGLE FLUSH — the only React state update ──
    const flushTimer = setInterval(() => {
      if (document.hidden) return
      const conns = [b.binance, b.okx, b.bybit, b.kraken, b.mempool, b.coincap]
      const connCount = conns.filter(c => c.connected).length

      setData({
        prices: { ...b.coincap.prices },
        totalVolume: b.binance.volume,
        topPairs: b.binance.pairs,
        connected: connCount > 0,
        wsConnected: connCount > 0,
        exchanges: {
          binance: { id: 'binance', volume: b.binance.volume, connected: b.binance.connected },
          okx:     { id: 'okx',     volume: sumValues(b.okx.volumes), connected: b.okx.connected },
          bybit:   { id: 'bybit',   volume: sumValues(b.bybit.volumes), connected: b.bybit.connected },
          kraken:  { id: 'kraken',  volume: sumValues(b.kraken.volumes), connected: b.kraken.connected },
        },
        mempool: { txs: b.mempool.txs.slice(-MAX_MEMPOOL_TXS), connected: b.mempool.connected },
        connectionCount: connCount,
      })
    }, FLUSH_MS)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      disconnectAll?.()
      clearInterval(flushTimer)
    }
  }, [])

  return data
}
