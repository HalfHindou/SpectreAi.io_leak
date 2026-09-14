// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { WatchlistsProvider, useWatchlists } from '../src/contexts/WatchlistsContext'
import { reorderExistingTokens } from '../src/lib/watchlist-market'

const settings = vi.hoisted(() => ({ marketMode: 'crypto', _syncEnabled: false }))
vi.mock('../src/store/useSettingsStore', () => ({ default: selector => selector(settings) }))
vi.mock('../src/services/analytics', () => ({ track: vi.fn(), Events: {} }))
vi.mock('../src/services/profileSync', () => ({ fetchResearchWatchlists: vi.fn(), pushResearchWatchlists: vi.fn() }))
let root, host, context
function Reader() { context = useWatchlists(); return null }
const render = () => act(() => root.render(React.createElement(WatchlistsProvider, null, React.createElement(Reader))))
const save = (key, tokens) => localStorage.setItem(key, JSON.stringify([{id:'default', name:'My Watchlist', tokens, updatedAt:1}]))
const stocks = () => JSON.parse(localStorage.getItem('spectre-stock-watchlists'))[0].tokens
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  settings.marketMode = 'crypto'
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Market-isolated watchlists', () => {
  it('routes a Trading Lite reply to crypto even after switching to Stocks', () => {
    save('spectre-watchlists', [{symbol:'BTC',name:'Bitcoin'}])
    save('spectre-stock-watchlists', [{symbol:'AAPL',name:'Apple Inc.'}])
    render()
    const delayedReply = context.syncTradingWatchlist
    settings.marketMode = 'stocks'; render()
    act(() => context.addToWatchlist({symbol:'META',name:'Meta Platforms Inc.'}))
    act(() => delayedReply([{symbol:'BTC',name:'Bitcoin'}, {symbol:'PALM',name:'PaLM AI',address:'0xpalm'}]))
    expect(context.watchlist.map(t => t.symbol)).toEqual(['AAPL','META'])
    expect(stocks().map(t => t.symbol)).toEqual(['AAPL','META'])
    expect(context.tradingWatchlist.map(t => t.symbol)).toEqual(['BTC','PALM'])
    settings.marketMode = 'crypto'; render()
    expect(context.watchlist.map(t => t.symbol)).toEqual(['BTC','PALM'])
    act(() => root.unmount()); root = createRoot(host)
    settings.marketMode = 'stocks'; render()
    expect(context.watchlist.map(t => t.symbol)).toEqual(['AAPL','META'])
  })
  it('hides contaminated crypto without destroying saved rows or hiding a real BTC ETF', () => {
    const bitcoin = {symbol:'BTC',name:'Bitcoin'}
    save('spectre-watchlists', [bitcoin])
    const misplaced = {...bitcoin,isStock:true,assetClass:'stock'}
    save('spectre-stock-watchlists', [misplaced, {symbol:'PALM',address:'0xpalm',isStock:true}, {symbol:'META',name:'Meta Platforms Inc.'}])
    settings.marketMode = 'stocks'; render()
    expect(context.watchlist.map(t => t.symbol)).toEqual(['META'])
    act(() => context.setActiveWatchlist('default'))
    expect(stocks()).toContainEqual(expect.objectContaining({symbol:'BTC',name:'Bitcoin'}))
    act(() => context.removeFromWatchlist('BTC'))
    act(() => context.addToWatchlist({symbol:'BTC',name:'Grayscale Bitcoin Mini Trust ETF',isStock:true,exchange:'NYSE'}))
    expect(context.watchlist.map(t => t.name)).toContain('Grayscale Bitcoin Mini Trust ETF')
  })
  it('adds favourites to the visible fallback list when the saved active id is stale', () => {
    save('spectre-stock-watchlists', [{symbol:'AAPL',name:'Apple Inc.'}])
    localStorage.setItem('spectre-stock-active-watchlist-id','deleted-list')
    settings.marketMode = 'stocks'; render()
    act(() => context.addToWatchlist({symbol:'GOOGL',name:'Alphabet Inc.'}))
    expect(context.activeWatchlistId).toBe('default')
    expect(stocks().map(t => t.symbol)).toEqual(['AAPL','GOOGL'])
  })
  it('reordering cannot replace favourites with foreign rows or quote metadata', () => {
    const original = [{symbol:'AAPL',name:'Apple Inc.'}, {symbol:'META',name:'Meta Platforms Inc.'}]
    expect(reorderExistingTokens(original,[{symbol:'BTC',name:'Bitcoin'}, {symbol:'META',name:'wrong'}])).toEqual([original[1],original[0]])
  })
})
