import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const viewportScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('var baseH = 0'))

// Exercise the actual boot script, with viewport events supplied by the test.
// These establish algorithm behavior; real Safari keyboard/zoom QA is separate.
function boot({ width = 390, height = 700, coarse = true } = {}) {
  const values = new Map()
  const classes = new Set()
  const events = new Map()
  const timers = []
  const style = {
    setProperty: (name, value) => values.set(name, value),
    removeProperty: name => values.delete(name),
    get height() { return values.get('height') || '' },
    get minHeight() { return values.get('min-height') || '' },
  }
  const doc = {
    activeElement: null,
    documentElement: { clientWidth: width, style, classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name),
    } },
    querySelector: () => ({ style }),
  }
  const viewport = { height, width, scale: 1,
    addEventListener: (name, fn) => events.set('visual:' + name, fn) }
  const win = {
    innerWidth: width, innerHeight: height, visualViewport: viewport,
    matchMedia: query => ({ matches: query.includes('coarse') ? coarse : win.innerWidth <= 768 }),
    addEventListener: (name, fn) => events.set(name, fn),
  }
  runInNewContext(viewportScript, { window: win, document: doc,
    setTimeout: fn => fn(), setInterval: fn => { timers.push(fn); return timers.length }, clearInterval() {} })
  return {
    values, classes,
    resize({ width: nextWidth, height: nextHeight, scale = 1, focused = false, orientation = false }) {
      if (nextWidth !== undefined) win.innerWidth = doc.documentElement.clientWidth = viewport.width = nextWidth
      if (nextHeight !== undefined) win.innerHeight = viewport.height = nextHeight
      viewport.scale = scale
      doc.activeElement = focused ? { tagName: 'INPUT' } : null
      events.get(orientation ? 'orientationchange' : 'visual:resize')()
    },
    watchdog() { timers.at(-1)() },
  }
}

describe('mobile viewport continuity', () => {
  it('sizes the mobile scroller to the visible viewport', () => {
    const app = boot()
    expect(app.values.get('height')).toBe('700px')
    expect(app.values.get('min-height')).toBe('0px')
  })
  it('holds the scroller while the keyboard opens and restores it on dismissal', () => {
    const app = boot()
    app.resize({ height: 400, focused: true })
    expect(app.classes.has('kb-open')).toBe(true)
    expect(app.values.get('height')).toBe('700px')
    app.watchdog()
    expect(app.values.get('height')).toBe('700px')
    app.resize({ height: 500 }) // focusout precedes keyboard animation completion
    expect(app.classes.has('kb-open')).toBe(true)
    app.resize({ height: 700 })
    expect(app.classes.has('kb-open')).toBe(false)
  })
  it('does not resize the app during user pinch zoom, including the watchdog', () => {
    const app = boot()
    app.resize({ height: 350, scale: 2 })
    app.watchdog()
    expect(app.values.get('height')).toBe('700px')
    expect(app.values.get('--app-vh')).toBe('700px')
  })
  it('does not mistake zoom on an input for an open keyboard', () => {
    const app = boot()
    app.resize({ height: 350, scale: 2, focused: true })
    expect(app.classes.has('kb-open')).toBe(false)
  })
  it('adapts to a different compact width with an input focused', () => {
    const app = boot({ width: 600, height: 900 })
    app.resize({ width: 390, height: 700, focused: true })
    expect(app.classes.has('kb-open')).toBe(false)
    expect(app.values.get('height')).toBe('700px')
  })
  it('releases mobile inline height on unfolding past the breakpoint', () => {
    const app = boot()
    app.resize({ width: 820, height: 500, focused: true })
    expect(app.classes.has('kb-open')).toBe(false)
    expect(app.values.has('height')).toBe(false)
    expect(app.values.has('min-height')).toBe(false)
  })
  it('keeps ordinary desktop window resizing independent of keyboard state', () => {
    const app = boot({ width: 1280, height: 900, coarse: false })
    app.resize({ height: 500, focused: true })
    expect(app.classes.has('kb-open')).toBe(false)
    expect(app.values.get('--app-vh')).toBe('500px')
  })
  it('relearns height after orientation changes', () => {
    const app = boot()
    app.resize({ width: 700, height: 390, focused: true, orientation: true })
    expect(app.classes.has('kb-open')).toBe(false)
    expect(app.values.get('height')).toBe('390px')
  })
})
