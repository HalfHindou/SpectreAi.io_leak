import { describe, expect, it } from 'vitest'
import { getWelcomeDiscoveryTabs, nextWelcomeTabIndex } from '../src/pages/home/components/welcome-discovery-tabs'

describe('Welcome discovery navigation', () => {
  it('keeps all seven crypto panels reachable on mobile, including Social', () => {
    expect(getWelcomeDiscoveryTabs(false).map(tab => tab.id)).toEqual(['topcoins', 'onchain', 'predictions', 'social', 'aiagents', 'aimodels', 'warroom'])
  })
  it('keeps crypto-only panels out of Stocks mode', () => {
    expect(getWelcomeDiscoveryTabs(true).map(tab => tab.id)).toEqual(['topcoins', 'predictions'])
  })
  it('uses translated labels without changing panel identities', () => {
    const tabs = getWelcomeDiscoveryTabs(false, (key, fallback) => key === 'topSection.social' ? 'المجتمع' : fallback)
    expect(tabs.find(tab => tab.id === 'social').label).toBe('المجتمع')
  })
  it('retains preview restrictions while leaving normal tabs available', () => {
    expect(getWelcomeDiscoveryTabs(false, undefined, true).filter(tab => tab.locked).map(tab => tab.id)).toEqual(['social', 'aiagents', 'aimodels', 'warroom'])
    expect(getWelcomeDiscoveryTabs(false).every(tab => !tab.locked)).toBe(true)
  })
  it('skips restricted panels with arrow keys and End', () => {
    const tabs = getWelcomeDiscoveryTabs(false, undefined, true)
    expect(nextWelcomeTabIndex(tabs, 2, 'ArrowRight')).toBe(2)
    expect(nextWelcomeTabIndex(tabs, 0, 'End')).toBe(2)
    expect(nextWelcomeTabIndex(tabs, 2, 'Home')).toBe(0)
    expect(nextWelcomeTabIndex([{id:'a'}, {id:'b', locked:true}, {id:'c'}], 0, 'ArrowRight')).toBe(2)
  })
  it('follows reading direction and leaves unrelated keys alone', () => {
    const tabs = getWelcomeDiscoveryTabs(false)
    expect(nextWelcomeTabIndex(tabs, 2, 'ArrowLeft', true)).toBe(3)
    expect(nextWelcomeTabIndex(tabs, 2, 'ArrowRight', true)).toBe(1)
    expect(nextWelcomeTabIndex(tabs, 0, 'ArrowLeft')).toBe(0)
    expect(nextWelcomeTabIndex(tabs, 2, 'Tab')).toBe(null)
  })
})
