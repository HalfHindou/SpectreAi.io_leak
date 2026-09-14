import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Exercise observer scheduling and layout updates without pretending to emulate
// browser layout. Actual device rendering remains a separate acceptance check.
const harness = vi.hoisted(() => ({ state: null, cleanup: null }))
vi.mock('react', () => ({
  useState: value => {
    harness.state = value
    return [value, update => { harness.state = update(harness.state) }]
  },
  useLayoutEffect: effect => { harness.cleanup = effect() },
}))
import { useResponsiveChartFrame } from '../src/hooks/useResponsiveChartFrame'

let frame, controls, body, toolbarHeight, queue, observer, redraw, listeners, rafId
function mount(enabled = true) {
  useResponsiveChartFrame(enabled, { current: frame }, { current: controls }, redraw)
}
function flush() {
  const callbacks = [...queue.values()]
  queue.clear()
  callbacks.forEach(callback => callback())
}
beforeEach(() => {
  harness.cleanup = null
  toolbarHeight = 112
  body = { clientWidth: 390, clientHeight: 340 }
  frame = { clientWidth: 390, querySelector: () => body }
  controls = { getBoundingClientRect: () => ({ height: toolbarHeight }) }
  queue = new Map(); rafId = 0; observer = null
  redraw = vi.fn(); listeners = new Map()
  vi.stubGlobal('window', {
    devicePixelRatio: 2,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  })
  vi.stubGlobal('requestAnimationFrame', callback => { queue.set(++rafId, callback); return rafId })
  vi.stubGlobal('cancelAnimationFrame', id => queue.delete(id))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observer = this }
  })
})
afterEach(() => { harness.cleanup?.(); vi.unstubAllGlobals() })

describe('Research Zone chart container sizing', () => {
  it('does not change other uses of the shared chart', () => {
    mount(false)
    expect(observer).toBeNull()
    expect(redraw).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
  it('measures the toolbar and observes the frame, controls and plot', () => {
    mount()
    expect(harness.state).toEqual({ compact: true, toolbarHeight: 112 })
    expect(observer.observe.mock.calls.map(([element]) => element)).toEqual([frame, controls, body])
    expect(redraw).toHaveBeenCalledTimes(1)
  })
  it('responds to panel width changes without a window resize', () => {
    mount()
    frame.clientWidth = 1200
    observer.callback(); observer.callback()
    expect(queue.size).toBe(1)
    flush()
    expect(harness.state.compact).toBe(false)
    frame.clientWidth = 600
    observer.callback(); flush()
    expect(harness.state.compact).toBe(true)
  })
  it('updates reserved toolbar space when labels wrap', () => {
    mount()
    toolbarHeight = 168.3
    observer.callback(); flush()
    expect(harness.state.toolbarHeight).toBe(169)
  })
  it('redraws when only the plot height changes and ignores unchanged notifications', () => {
    mount()
    observer.callback(); flush()
    expect(redraw).toHaveBeenCalledTimes(1)
    body.clientHeight = 500
    observer.callback(); flush()
    expect(redraw).toHaveBeenCalledTimes(2)
  })
  it('waits for hidden panels to have width and tracks pixel density changes', () => {
    frame.clientWidth = 0
    mount()
    expect(redraw).not.toHaveBeenCalled()
    frame.clientWidth = 390
    observer.callback(); flush()
    window.devicePixelRatio = 3
    listeners.get('resize')(); flush()
    expect(redraw).toHaveBeenCalledTimes(2)
  })
  it('cancels queued measurements and disconnects on unmount', () => {
    mount()
    observer.callback()
    harness.cleanup(); harness.cleanup = null
    expect(queue.size).toBe(0)
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
  })
})
