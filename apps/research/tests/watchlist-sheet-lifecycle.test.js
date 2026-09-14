import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { activateWatchlistSheet } from '../src/pages/watchlists/components/sheet-lifecycle'

// Exercise the sheet's event lifecycle; this does not simulate browser layout.
const events = target => Object.assign(target, {
  listeners: new Map(),
  addEventListener(name, callback) { this.listeners.set(name, callback) },
  removeEventListener(name) { this.listeners.delete(name) },
  emit(name, event = {}) { this.listeners.get(name)?.(event) },
})
let doc, win, viewport, sheet, overlay, opener, first, last, hidden, appScroll, close, release
const focusable = (visible = true) => ({
  tabIndex: 0, disabled: false, isConnected: true,
  closest: () => null,
  getClientRects: () => visible ? [{}] : [],
  focus: vi.fn(function () { doc.activeElement = this }),
})
beforeEach(() => {
  viewport = events({ width: 390, height: 780, offsetTop: 0, offsetLeft: 0 })
  win = events({ visualViewport: viewport, innerHeight: 800 })
  appScroll = { style: { overflow: 'auto' } }
  doc = events({ defaultView: win, body: { style: { overflow: 'clip' } }, documentElement: { clientWidth: 390 }, querySelector: () => appScroll })
  opener = focusable(); first = focusable(); last = focusable(); hidden = focusable(false)
  doc.activeElement = opener
  sheet = focusable()
  Object.assign(sheet, { ownerDocument: doc, querySelectorAll: () => [hidden, first, last], contains: node => [sheet, hidden, first, last].includes(node) })
  overlay = { style: { setProperty(name, value) { this[name] = value } } }
  close = vi.fn()
  release = activateWatchlistSheet(sheet, overlay, close)
})
afterEach(() => release())
const press = (key, shiftKey = false) => {
  const event = { key, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() }
  doc.emit('keydown', event)
  return event
}
describe('Watchlists action sheet lifecycle', () => {
  it('focuses the first visible action and locks both scroll roots', () => {
    expect(doc.activeElement).toBe(first)
    expect(hidden.focus).not.toHaveBeenCalled()
    expect(doc.body.style.overflow).toBe('hidden')
    expect(appScroll.style.overflow).toBe('hidden')
  })
  it('wraps forward and reverse keyboard navigation', () => {
    last.focus(); expect(press('Tab').preventDefault).toHaveBeenCalled(); expect(doc.activeElement).toBe(first)
    expect(press('Tab', true).preventDefault).toHaveBeenCalled(); expect(doc.activeElement).toBe(last)
  })
  it('allows native tab navigation between interior controls', () => {
    first.focus(); expect(press('Tab').preventDefault).not.toHaveBeenCalled()
  })
  it('keeps focus inside even if another element receives focus', () => {
    opener.focus(); doc.emit('focusin', { target: opener }); expect(doc.activeElement).toBe(first)
  })
  it('falls back to the dialog when all actions are disabled or hidden', () => {
    first.disabled = true; last.disabled = true
    expect(press('Tab').preventDefault).toHaveBeenCalled(); expect(doc.activeElement).toBe(sheet)
  })
  it('dismisses once on Escape without propagating to the underlying page', () => {
    const event = press('Escape')
    expect(close).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalled(); expect(event.stopPropagation).toHaveBeenCalled()
  })
  it('follows the visible keyboard area and viewport offset', () => {
    viewport.height = 390; viewport.offsetTop = 45; viewport.emit('resize')
    expect(overlay.style['--sheet-viewport-height']).toBe('390px')
    expect(overlay.style['--sheet-viewport-top']).toBe('45px')
  })
  it('keeps the same focused action and scroll lock when the screen unfolds', () => {
    last.focus(); viewport.width = 1024; viewport.height = 768; win.emit('resize')
    expect(overlay.style['--sheet-viewport-width']).toBe('1024px')
    expect(doc.activeElement).toBe(last); expect(appScroll.style.overflow).toBe('hidden')
    expect(close).not.toHaveBeenCalled()
  })
  it('restores the original scroll values and opener on release', () => {
    release()
    expect(doc.body.style.overflow).toBe('clip'); expect(appScroll.style.overflow).toBe('auto')
    expect(doc.activeElement).toBe(opener)
    expect(doc.listeners.size + win.listeners.size + viewport.listeners.size).toBe(0)
    opener.focus.mockClear(); release(); expect(opener.focus).not.toHaveBeenCalled()
  })
  it('does not steal focus from a newly opened dialog or a removed opener', () => {
    doc.activeElement = focusable(); release(); expect(opener.focus).not.toHaveBeenCalled()
  })
  it('skips focus restoration if navigation removed the opener', () => {
    opener.isConnected = false; release(); expect(opener.focus).not.toHaveBeenCalled()
  })
  it('supports browsers without VisualViewport', () => {
    release(); win.visualViewport = undefined
    release = activateWatchlistSheet(sheet, overlay, close)
    expect(overlay.style['--sheet-viewport-height']).toBe('800px')
    expect(overlay.style['--sheet-viewport-width']).toBe('390px')
  })
})
