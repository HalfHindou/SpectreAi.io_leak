/**
 * Search Engine v2 — entry point.
 *
 * Thin wrapper. Reads URL state (?q=, ?focus=, ?mode=) and hands the shell
 * a clean prop set. All UI lives in components/. All streaming state lives
 * in hooks/use-search-stream.js. All layout-by-classification routing lives
 * in lib/classification-config.js.
 *
 * Gated by `?v=2` for now — App.jsx routes /search-engine to v1 by default
 * and to this entry only when the version flag is on. Cleanup PR after the
 * default flip will delete pages/search-engine/ (the v1 monolith).
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SearchEngineShell from './components/search-engine-shell'

export default function SearchEngineV2Page() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''
  const initialFocus = searchParams.get('focus') || 'all'
  const initialMode = searchParams.get('mode') === 'thesis' ? 'deep' : 'quick'

  const [query, setQuery] = useState(initialQuery)
  const [focus, setFocus] = useState(initialFocus)
  const [mode, setMode] = useState(initialMode)

  // Keep URL in sync — replaceState so back-button still works to home.
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (query) next.set('q', query); else next.delete('q')
    if (focus !== 'all') next.set('focus', focus); else next.delete('focus')
    if (mode === 'deep') next.set('mode', 'thesis'); else next.delete('mode')
    // Always preserve the v2 flag so a refresh stays on v2 until the default flips.
    if (!next.has('v')) next.set('v', '2')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, focus, mode])

  return (
    <SearchEngineShell
      query={query}
      focus={focus}
      mode={mode}
      onQueryChange={setQuery}
      onFocusChange={setFocus}
      onModeChange={setMode}
    />
  )
}
