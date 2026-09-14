import { describe, expect, it, vi } from 'vitest'
import { observeSelectedTab, revealSelectedTab } from '../src/pages/research-zone/components/observe-selected-tab'

// Geometry/lifecycle tests, not a simulated Safari rendering environment.
function fixture({ left = 80, right = 180, rtl = false, observer = true } = {}) {
  const frames = new Map()
  const listeners = new Map()
  let nextFrame = 0
  let resize
  const observerInstance = { observe: vi.fn(), disconnect: vi.fn() }
  const view = {
    getComputedStyle: () => ({ direction: rtl ? 'rtl' : 'ltr' }),
    requestAnimationFrame: vi.fn(callback => { frames.set(++nextFrame, callback); return nextFrame }),
    cancelAnimationFrame: vi.fn(id => frames.delete(id)),
    addEventListener: vi.fn((name, callback) => listeners.set(name, callback)),
    removeEventListener: vi.fn((name, callback) => { if (listeners.get(name) === callback) listeners.delete(name) }),
    ...(observer ? { ResizeObserver: class {
      constructor(callback) { resize = callback; return observerInstance }
    } } : {}),
  }
  const bounds = { left: 0, right: 320 }
  const item = { left, right }
  const selected = { getBoundingClientRect: () => ({ left: item.left - strip.scrollLeft, right: item.right - strip.scrollLeft }), focus: vi.fn() }
  const strip = {
    ownerDocument: { defaultView: view },
    querySelector: vi.fn(() => selected),
    getBoundingClientRect: () => bounds,
    scrollLeft: 0,
    scrollTop: 75,
    scrollIntoView: vi.fn(),
  }
  return {
    strip, selected, bounds, item, view, observerInstance, frames, listeners,
    resize: () => resize?.(),
    flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()) },
  }
}

describe('Research mobile selected-tab visibility', () => {
  it('does not move a visible tab, page scroll, or keyboard focus', () => {
    const f = fixture()
    revealSelectedTab(f.strip)
    expect(f.strip.scrollLeft).toBe(0)
    expect(f.strip.scrollTop).toBe(75)
    expect(f.strip.scrollIntoView).not.toHaveBeenCalled()
    expect(f.selected.focus).not.toHaveBeenCalled()
  })
  it.each([
    [{ left: 290, right: 370 }, 58],
    [{ left: -25, right: 55 }, -33],
    [{ left: -25, right: 55, rtl: true }, -33],
  ])('reveals a clipped tab by moving only its horizontal strip: %o', (options, expected) => {
    const f = fixture(options)
    revealSelectedTab(f.strip)
    expect(f.strip.scrollLeft).toBe(expected)
    expect(f.strip.scrollTop).toBe(75)
  })
  it.each([false, true])('aligns an oversized label consistently (RTL=%s)', rtl => {
    const f = fixture({ left: 70, right: 510, rtl })
    revealSelectedTab(f.strip)
    const first = f.strip.scrollLeft
    expect(first).toBe(rtl ? 198 : 62)
    revealSelectedTab(f.strip)
    expect(f.strip.scrollLeft).toBe(first)
  })
  it('ignores a hidden strip or absent selection', () => {
    const f = fixture({ left: 400, right: 480 })
    f.bounds.right = 0
    revealSelectedTab(f.strip)
    expect(f.strip.scrollLeft).toBe(0)
    f.strip.querySelector.mockReturnValue(null)
    expect(() => revealSelectedTab(f.strip)).not.toThrow()
    expect(() => revealSelectedTab(null)).not.toThrow()
  })
  it('reveals the selection when the strip narrows, coalescing resize notifications', () => {
    const f = fixture({ left: 210, right: 290 })
    const stop = observeSelectedTab(f.strip)
    expect(f.observerInstance.observe.mock.calls.map(([node]) => node)).toEqual([f.strip, f.selected])
    f.bounds.right = 240
    f.resize(); f.resize(); f.listeners.get('resize')()
    expect(f.frames.size).toBe(1)
    f.flush()
    expect(f.strip.scrollLeft).toBe(58)
    expect(f.strip.scrollTop).toBe(75)
    stop()
  })
  it('also observes label growth without intercepting manual scroll events', () => {
    const f = fixture()
    const stop = observeSelectedTab(f.strip)
    f.item.right = 360
    f.resize(); f.flush()
    expect(f.strip.scrollLeft).toBe(48)
    expect(f.listeners.has('scroll')).toBe(false)
    stop()
  })
  it('disconnects observers, removes listeners, and cancels pending work on tab change/unmount', () => {
    const f = fixture()
    const stop = observeSelectedTab(f.strip)
    f.resize()
    stop()
    expect(f.observerInstance.disconnect).toHaveBeenCalledOnce()
    expect(f.view.cancelAnimationFrame).toHaveBeenCalledOnce()
    expect(f.frames.size).toBe(0)
    expect(f.listeners.size).toBe(0)
  })
  it('handles window resizing when ResizeObserver is unavailable', () => {
    const f = fixture({ observer: false })
    const stop = observeSelectedTab(f.strip)
    f.bounds.right = 120
    f.listeners.get('resize')(); f.flush()
    expect(f.strip.scrollLeft).toBe(68)
    stop()
    expect(f.listeners.size).toBe(0)
  })
})
