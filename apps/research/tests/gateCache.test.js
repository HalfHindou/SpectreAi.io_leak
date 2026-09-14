import { describe, it, expect } from 'vitest'
import { sealGatedResponse, privatizeCacheControl } from '../api/_lib/gate-cache.js'

// Every gate in this app runs INSIDE the serverless function while the handlers
// below it set `public, s-maxage=…` so the CDN can skip a cold boot. Composed,
// those two facts let a warm edge entry answer a caller who never reached the
// gate — measured on production 2026-08-25, where /api/private/stats and
// /api/private/preipo served anonymous callers the real payloads for hours.
//
// These cases are the exact headers that produced it. If one of them ever
// returns a `public` or an `s-maxage` again, the bypass is back.

const makeRes = () => {
  const headers = {}
  const find = (k) => Object.keys(headers).find((x) => x.toLowerCase() === String(k).toLowerCase())
  return {
    headersSent: false,
    setHeader: (k, v) => { headers[k] = v },
    getHeader: (k) => headers[find(k)],
    writeHead: () => {},
    end: () => {},
    read: (k) => headers[find(k)],
  }
}

describe('privatizeCacheControl', () => {
  it('keeps the handler\'s freshness window but makes it the caller\'s own', () => {
    expect(privatizeCacheControl('public, s-maxage=120, stale-while-revalidate=240')).toBe('private, max-age=120')
    expect(privatizeCacheControl('public, s-maxage=1800, stale-while-revalidate=3600')).toBe('private, max-age=1800')
  })

  it('prefers an explicit max-age over s-maxage when a handler sets both', () => {
    expect(privatizeCacheControl('public, max-age=300, s-maxage=900')).toBe('private, max-age=300')
  })

  it('leaves a handler that already refuses caching alone', () => {
    expect(privatizeCacheControl('no-store')).toBe('no-store')
    expect(privatizeCacheControl('private, no-store')).toBe('private, no-store')
  })

  it('refuses rather than guesses when there is no window to keep', () => {
    expect(privatizeCacheControl('public')).toBe('private, no-store')
    expect(privatizeCacheControl('')).toBe('private, no-store')
    expect(privatizeCacheControl(undefined)).toBe('private, no-store')
  })

  it('carries revalidation directives through', () => {
    expect(privatizeCacheControl('public, max-age=0, must-revalidate')).toBe('private, max-age=0, must-revalidate')
  })
})

describe('sealGatedResponse', () => {
  it('downgrades the Private Markets headers that leaked', () => {
    const res = sealGatedResponse(makeRes())
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=240')
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=120, stale-while-revalidate=240')
    expect(res.read('cache-control')).toBe('private, max-age=120')
    expect(res.read('cdn-cache-control')).toBe('no-store')
  })

  it('refuses the edge outright, since it is the half that serves other people', () => {
    const res = sealGatedResponse(makeRes())
    res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=600')
    expect(res.read('vercel-cdn-cache-control')).toBe('no-store')
  })

  it('leaves every other header untouched', () => {
    const res = sealGatedResponse(makeRes())
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('X-Spectre-Tier', 'geckoterminal')
    expect(res.read('content-type')).toBe('application/json')
    expect(res.read('x-spectre-tier')).toBe('geckoterminal')
  })

  it('seals a handler that sets no cache header at all', () => {
    const res = sealGatedResponse(makeRes())
    res.end()
    expect(res.read('cache-control')).toBe('private, no-store')
    expect(res.read('cdn-cache-control')).toBe('no-store')
  })

  it('covers the writeHead(status, headers) form', () => {
    const res = sealGatedResponse(makeRes())
    const headers = { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200' }
    res.writeHead(200, headers)
    expect(headers['Cache-Control']).toBe('private, max-age=600')
  })

  it('is idempotent — a double seal must not privatize twice', () => {
    const res = sealGatedResponse(sealGatedResponse(makeRes()))
    res.setHeader('Cache-Control', 'public, s-maxage=60')
    expect(res.read('cache-control')).toBe('private, max-age=60')
  })
})
