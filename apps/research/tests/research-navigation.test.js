import { describe, it, expect } from 'vitest'
import { INITIAL_RESEARCH_NAVIGATION as initial, normalizeResearchNavigation, researchNavigationReducer as reduce } from '../src/pages/research-zone/data/rz-navigation'

describe('Research Zone layout navigation continuity', () => {
  it('keeps existing entry points', () => {
    expect(initial).toEqual({ desktopSection: 'markets', mobileTab: 'overview' })
  })
  it.each(['markets', 'sentiment', 'technicals'])('carries %s from desktop to mobile', id => {
    const next = reduce(initial, { type: 'desktop', id })
    expect(next.desktopSection).toBe(id)
    expect(next.mobileTab).toBe(id)
  })
  it.each(['markets', 'sentiment', 'technicals'])('carries %s from mobile to desktop', id => {
    const next = reduce(initial, { type: 'mobile', id })
    expect(next.desktopSection).toBe(id)
    expect(next.mobileTab).toBe(id)
  })
  it('retains separate places for sections without an equivalent', () => {
    let state = reduce(initial, { type: 'desktop', id: 'project' })
    state = reduce(state, { type: 'mobile', id: 'news' })
    expect(state).toEqual({ desktopSection: 'project', mobileTab: 'news' })
    // Responsive mount/unmount does not dispatch a selection or reset state.
    expect(normalizeResearchNavigation(state, false)).toBe(state)
  })
  it('removes unavailable stock sections without blank content', () => {
    const state = { desktopSection: 'project', mobileTab: 'social' }
    expect(normalizeResearchNavigation(state, true)).toEqual(initial)
    expect(reduce(state, { type: 'asset', isStock: true })).toEqual(initial)
  })
  it('preserves supported stock sections and news', () => {
    const state = { desktopSection: 'technicals', mobileTab: 'news' }
    expect(normalizeResearchNavigation(state, true)).toBe(state)
  })
  it('ignores unknown sections and crypto-only stock selections', () => {
    expect(reduce(initial, { type: 'desktop', id: 'missing' })).toBe(initial)
    expect(reduce(initial, { type: 'mobile', id: 'social', isStock: true })).toBe(initial)
    expect(reduce(initial, { type: 'desktop', id: 'project', isStock: true })).toBe(initial)
  })
})
