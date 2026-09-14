/**
 * YouTokenSearch — fast token lookup via Whisper Search.
 * POSTs natural-language query to /api/search/whisper, renders the
 * interpreted result block + first few token matches with prices.
 */
import { useCallback, useState } from 'react'
import './YouTokenSearch.css'

export default function YouTokenSearch() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const submit = useCallback(async (e) => {
    if (e?.preventDefault) e.preventDefault()
    const q = query.trim()
    if (!q || loading) return
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/search/whisper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
        signal: AbortSignal.timeout(15000),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `${res.status}`)
      setResult(json)
    } catch (err) {
      setError(err?.message || 'search failed')
    } finally {
      setLoading(false)
    }
  }, [query, loading])

  return (
    <div className="you-ts">
      <form className="you-ts-form" onSubmit={submit}>
        <input
          type="text"
          className="you-ts-input"
          placeholder="Search tokens with intent…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="you-ts-btn" disabled={loading || !query.trim()}>
          {loading ? '…' : 'Go'}
        </button>
      </form>
      {error && <div className="you-ts-error">{error}</div>}
      {result?.interpretation && (
        <p className="you-ts-interp">{result.interpretation}</p>
      )}
      {Array.isArray(result?.results) && result.results.length > 0 && (
        <ul className="you-ts-list">
          {result.results.slice(0, 6).map((r, i) => (
            <li key={i} className="you-ts-row">
              <span className="you-ts-sym mono">{(r.symbol || r.ticker || '').toUpperCase()}</span>
              <span className="you-ts-name">{r.name || ''}</span>
              {r.price != null && (
                <span className="you-ts-px mono">${Number(r.price).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
