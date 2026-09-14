import { describe, it, expect } from 'vitest'
import { getAnchoredMenuStyle, getMenuSheetStyle } from '../src/lib/anchored-menu'

const rect = { left: 100, top: 100, bottom: 140, width: 120 }
const screen = { width: 1024, height: 768, layoutHeight: 768 }

describe('menus stay within the usable viewport', () => {
  it('anchors below the trigger when there is room', () => {
    const style = getAnchoredMenuStyle(rect, screen)
    expect(style.top).toBe('144px')
    expect(style.bottom).toBe('auto')
    expect(style.width).toBe('180px')
  })
  it('keeps a right-edge dropdown inside a resized window', () => {
    const style = getAnchoredMenuStyle({ ...rect, left: 980 }, screen)
    expect(parseFloat(style.left) + parseFloat(style.width)).toBe(1016)
  })
  it('opens above a low trigger without overflowing the top', () => {
    const style = getAnchoredMenuStyle({ ...rect, top: 700, bottom: 740 }, screen)
    expect(style.top).toBe('auto')
    expect(style.bottom).toBe('72px')
    expect(style.maxHeight).toBe('260px')
  })
  it('limits height in short landscape windows', () => {
    const style = getAnchoredMenuStyle(rect, { width: 820, height: 220 })
    expect(style.maxHeight).toBe('88px')
    expect(style.bottom).toBe('124px')
  })
  it('constrains width even when the trigger is wider than the viewport', () => {
    const style = getAnchoredMenuStyle({ ...rect, width: 600 }, { width: 320, height: 600 })
    expect(style.width).toBe('304px')
    expect(style.left).toBe('8px')
  })
  it('respects panned visual viewport bounds during zoom', () => {
    const style = getAnchoredMenuStyle(rect, { width: 400, height: 320, left: 220, top: 160, layoutHeight: 768 })
    expect(parseFloat(style.left)).toBeGreaterThanOrEqual(228)
    expect(parseFloat(style.left) + parseFloat(style.width)).toBeLessThanOrEqual(612)
    expect(parseFloat(style.top)).toBeGreaterThanOrEqual(168)
  })
  it('places mobile sheets above the keyboard and caps their height', () => {
    const style = getMenuSheetStyle({ width: 390, height: 380, layoutHeight: 700 })
    expect(style.bottom).toBe('320px')
    expect(style.maxHeight).toBe('285px')
  })
  it('restores sheet position when the keyboard closes', () => {
    const style = getMenuSheetStyle({ width: 390, height: 700, layoutHeight: 700 }, 0.6)
    expect(style.bottom).toBe('0px')
    expect(style.maxHeight).toBe('420px')
  })
})
