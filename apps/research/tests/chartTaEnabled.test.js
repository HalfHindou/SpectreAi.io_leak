import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { chartTaMobileOverride } from '../src/lib/chart-ta-enabled.js'

// The TA layer ships desktop-only; `?chartTa=1` is the dev door that keeps the
// in-progress mobile read testable on a real phone without shipping it. It has
// to be sticky (a standalone PWA window has no address bar to retype into) and
// it must resolve, not throw, when storage is blocked.
//
// Stubbed rather than run under jsdom: the module touches exactly two globals,
// and jsdom is not a dependency of this repo.

const makeStore = () => {
  let bag = {}
  return {
    getItem: (k) => (k in bag ? bag[k] : null),
    setItem: (k, v) => { bag[k] = String(v) },
    removeItem: (k) => { delete bag[k] },
    clear: () => { bag = {} },
  }
}

const hadWindow = 'window' in globalThis
const setSearch = (search) => { globalThis.window.location = { search } }

beforeEach(() => {
  globalThis.window = { location: { search: '' }, localStorage: makeStore() }
})
afterAll(() => { if (!hadWindow) delete globalThis.window })

describe('chart TA mobile override', () => {
  it('is off by default', () => {
    expect(chartTaMobileOverride()).toBe(false)
  })

  it('turns on with ?chartTa=1 and stays on once the query string is gone', () => {
    setSearch('?chartTa=1')
    expect(chartTaMobileOverride()).toBe(true)
    setSearch('')                       // the reload a home-screen PWA launch does
    expect(chartTaMobileOverride()).toBe(true)
  })

  it('accepts the readable spellings', () => {
    for (const v of ['1', 'on', 'mobile']) {
      globalThis.window = { location: { search: `?chartTa=${v}` }, localStorage: makeStore() }
      expect(chartTaMobileOverride()).toBe(true)
    }
  })

  it('turns back off with ?chartTa=0, and stays off', () => {
    setSearch('?chartTa=1')
    expect(chartTaMobileOverride()).toBe(true)
    setSearch('?chartTa=0')
    expect(chartTaMobileOverride()).toBe(false)
    setSearch('')
    expect(chartTaMobileOverride()).toBe(false)
  })

  it('resolves to false rather than throwing when storage is blocked', () => {
    globalThis.window = {
      location: { search: '' },
      get localStorage() { throw new Error('SecurityError: storage blocked') },
    }
    expect(() => chartTaMobileOverride()).not.toThrow()
    expect(chartTaMobileOverride()).toBe(false)
  })

  it('is off when there is no window at all (SSR/prerender)', () => {
    delete globalThis.window
    expect(chartTaMobileOverride()).toBe(false)
  })
})
