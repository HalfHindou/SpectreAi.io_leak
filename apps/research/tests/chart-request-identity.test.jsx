// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChartData } from '../src/hooks/codex/useChartData'

const mocks = vi.hoisted(() => ({ getBars: vi.fn(), subscribe: vi.fn() }))
vi.mock('../src/services/codexApi', () => ({ getBars: mocks.getBars }))
vi.mock('../src/services/binanceApi', () => ({ getBinanceKlines: vi.fn() }))
vi.mock('../src/services/binanceCatalog', () => ({ hasBinancePair: () => false }))
vi.mock('../src/services/spectreMarketApi', () => ({
  getSpectreTokenProfile: async () => null,
  getSpectreSearch: async () => ({ coins: [] }),
}))
vi.mock('../src/services/spectreDataApi', () => ({ getTokenChart: vi.fn() }))
vi.mock('../src/services/codexStreamApi', () => ({ subscribe: mocks.subscribe }))
vi.mock('../src/constants/majorTokens', () => ({ SYMBOL_TO_COINGECKO_ID: {} }))
vi.mock('../src/lib/idleManager', () => ({ isAppActive: () => false }))

let host, root, result, requests, streamCallbacks, symbol, sequence = 0
const day = 86400
const nowSec = Date.UTC(2026, 8, 13, 18) / 1000
function Reader({ resolution, hours = 26280, networkId = 1 }) {
  result = useChartData(symbol, resolution, networkId, hours, 'spectre-ai', 'SPECTRE', null, { preferOhlc: true })
  return null
}
const render = (props) => act(async () => root.render(React.createElement(Reader, props)))
const settle = (request, value, reject = false) => act(async () => request[reject ? 'reject' : 'resolve'](value))
function bars(count, interval, end = Math.floor(nowSec / interval) * interval) {
  return {
    source: 'codex',
    getBars: Array.from({ length: count }, (_, i) => ({
      t: end - (count - 1 - i) * interval,
      o: 0.4, h: 0.45, l: 0.39, c: 0.42, v: 10,
    })),
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(nowSec * 1000)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  symbol = `0x${String(++sequence).padStart(40, '0')}:1`
  requests = []
  streamCallbacks = []
  mocks.getBars.mockReset().mockImplementation((...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })))
  mocks.subscribe.mockReset().mockImplementation((keys, callback) => { streamCallbacks.push(callback); return () => {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Chart response identity across timeframe changes', () => {
  it('keeps weekly ALL bars when the earlier daily 1Y response finishes last', async () => {
    await render({ resolution: '1D' })
    await render({ resolution: '1W' })
    await settle(requests[1], bars(147, day * 7))
    const weekly = result.bars
    await settle(requests[0], bars(1029, day))
    expect(result.bars).toBe(weekly)
    expect(result.bars).toHaveLength(147)
    expect(result.bars[1].time - result.bars[0].time).toBe(day * 7 * 1000)
  })

  it('does not clear current loading or data when an older request fails', async () => {
    await render({ resolution: '1D' })
    await render({ resolution: '1W' })
    await settle(requests[0], new Error('late daily failure'), true)
    expect(result.loading).toBe(true)
    expect(result.error).toBeNull()
    await settle(requests[1], bars(147, day * 7))
    expect(result.loading).toBe(false)
    expect(result.bars).toHaveLength(147)
  })

  it.each([
    [{ resolution: '60', hours: 168 }, { resolution: '60', hours: 720 }],
    [{ resolution: '60', networkId: 1 }, { resolution: '60', networkId: 8453 }],
  ])('also isolates window and network changes with the same resolution', async (before, after) => {
    await render(before)
    await render(after)
    await settle(requests[1], bars(80, 3600))
    const current = result.bars
    await settle(requests[0], bars(30, 3600))
    expect(result.bars).toBe(current)
  })

  it('invalidates the first A request even when the user switches A -> B -> A', async () => {
    await render({ resolution: '1D' })
    await render({ resolution: '1W' })
    await render({ resolution: '1D' })
    await settle(requests[0], bars(30, day))
    expect(result.loading).toBe(true)
    expect(result.bars).toHaveLength(0)
    await settle(requests[2], bars(365, day))
    await settle(requests[1], bars(147, day * 7))
    expect(result.bars).toHaveLength(365)
  })

  it('rejects a late old-resolution history page without clearing the current history loader', async () => {
    await render({ resolution: '1D' })
    const dailyHead = bars(10, day)
    await settle(requests[0], dailyHead)
    let oldHistory
    await act(async () => { oldHistory = result.fetchMoreHistory() })
    const oldPage = requests[1]
    await render({ resolution: '1W' })
    const weeklyHead = bars(10, day * 7)
    await settle(requests[2], weeklyHead)
    let currentHistory
    await act(async () => { currentHistory = result.fetchMoreHistory() })
    const currentPage = requests[3]
    expect(result.loadingMore).toBe(true)
    await settle(oldPage, bars(5, day, dailyHead.getBars[0].t - day))
    expect(await oldHistory).toBe(false)
    expect(result.bars).toHaveLength(10)
    expect(result.loadingMore).toBe(true)
    await settle(currentPage, bars(5, day * 7, weeklyHead.getBars[0].t - day * 7))
    expect(await currentHistory).toBe(true)
    expect(result.bars).toHaveLength(15)
    expect(result.loadingMore).toBe(false)
  })

  it('waits for matching head bars before applying live ticks, then keeps valid live updates', async () => {
    await render({ resolution: '1W' })
    await settle(requests[0], bars(10, day * 7))
    const weekly = result.bars
    await render({ resolution: '1D' })
    act(() => streamCallbacks.at(-1)({ priceUsd: '0.44' }))
    expect(result.bars).toBe(weekly)
    expect(result.loading).toBe(true)
    await settle(requests[1], bars(20, day))
    act(() => streamCallbacks.at(-1)({ priceUsd: '0.44' }))
    expect(result.bars).toHaveLength(20)
    expect(result.bars.at(-1).close).toBe(0.44)
  })

  it('preserves loaded history and live ticks during a refresh of the same timeframe', async () => {
    await render({ resolution: '1D' })
    const head = bars(10, day)
    await settle(requests[0], head)
    let history
    await act(async () => { history = result.fetchMoreHistory() })
    await settle(requests[1], bars(5, day, head.getBars[0].t - day))
    expect(await history).toBe(true)
    const oldestTime = result.bars[0].time
    let refresh
    await act(async () => { refresh = result.refresh() })
    act(() => streamCallbacks.at(-1)({ priceUsd: '0.44' }))
    expect(result.bars.at(-1).close).toBe(0.44)
    await settle(requests[2], head)
    await refresh
    expect(result.bars).toHaveLength(15)
    expect(result.bars[0].time).toBe(oldestTime)
    act(() => streamCallbacks.at(-1)({ priceUsd: '0.445' }))
    expect(result.bars.at(-1).close).toBe(0.445)
  })
})
