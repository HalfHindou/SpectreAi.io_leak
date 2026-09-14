import { describe, it, expect, afterEach, vi } from 'vitest'
import { shouldPrefetch } from '@/lib/should-prefetch'

// The helper reads `navigator` at call time, so each case can swap it out.
function withConnection(conn) {
  vi.stubGlobal('navigator', conn === undefined ? {} : { connection: conn })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shouldPrefetch', () => {
  it('prefetches on a normal connection', () => {
    withConnection({ effectiveType: '4g', saveData: false })
    expect(shouldPrefetch()).toBe(true)
  })

  it('honours Save-Data even on a fast connection', () => {
    withConnection({ effectiveType: '4g', saveData: true })
    expect(shouldPrefetch()).toBe(false)
  })

  it('skips speculative downloads on 2g and 3g', () => {
    for (const effectiveType of ['slow-2g', '2g', '3g']) {
      withConnection({ effectiveType, saveData: false })
      expect(shouldPrefetch(), effectiveType).toBe(false)
    }
  })

  // Safari and Firefox ship no NetworkInformation API. Treating "unknown" as
  // slow would silently disable route warming for every one of those users,
  // which is the opposite of what this gate is for.
  it('prefetches when the browser exposes no connection info', () => {
    withConnection(undefined)
    expect(shouldPrefetch()).toBe(true)
  })

  it('reads the prefixed connection objects too', () => {
    vi.stubGlobal('navigator', { webkitConnection: { effectiveType: '2g' } })
    expect(shouldPrefetch()).toBe(false)
    vi.stubGlobal('navigator', { mozConnection: { effectiveType: '4g' } })
    expect(shouldPrefetch()).toBe(true)
  })

  it('does not prefetch when there is no navigator at all (SSR/prerender)', () => {
    vi.stubGlobal('navigator', undefined)
    expect(shouldPrefetch()).toBe(false)
  })
})
