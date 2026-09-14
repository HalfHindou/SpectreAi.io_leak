/**
 * SearchEngineShell — orchestrator + grid.
 *
 * Owns:
 *   - the SSE hook (one instance per page mount)
 *   - the 3-col grid (main + sticky right rail at 380px)
 *   - keyboard shortcuts (/ to focus input, ⌘+Enter for Deep, Escape to home)
 *   - the classification-aware render tree (delegates to classification-config)
 *
 * Does NOT own:
 *   - layout-per-classification logic (lives in lib/classification-config.js)
 *   - any block's UI (each block is a self-contained component under
 *     components/, lazy-loaded so the bundle splits by classification)
 *
 * Re-render scope: re-renders on every SSE event because it owns the hook.
 * That's fine because the shell itself is mostly static markup; the heavy
 * children are React.memo'd with slot-specific compares so token streams
 * don't bubble through.
 */
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useSearchStream } from '../hooks/use-search-stream'
import { CLASSIFICATION_CONFIG, STRING_BLOCKS } from '../lib/classification-config'
import SearchHero from './search-hero'
import './search-engine-shell.css'

// Map string block keys to their lazy-loaded components. The keys are kept
// terse in classification-config so the config reads like documentation.
const LazyAnswerStream = STRING_BLOCKS.answer()
const LazyNewsSection = STRING_BLOCKS.news()
const LazyCitationsBar = STRING_BLOCKS.citations()
const LazyRelatedQuestions = STRING_BLOCKS.related()

function LazyBlock({ name, stream }) {
  switch (name) {
    case 'answer':    return <LazyAnswerStream stream={stream} />
    case 'news':      return <LazyNewsSection stream={stream} />
    case 'citations': return <LazyCitationsBar stream={stream} />
    case 'related':   return <LazyRelatedQuestions stream={stream} />
    default:          return null
  }
}

export default function SearchEngineShell({
  query,
  focus,
  mode,
  onQueryChange,
  onFocusChange,
  onModeChange,
}) {
  const stream = useSearchStream()
  const inputRef = useRef(null)
  const resultsTopRef = useRef(null)
  const [inputValue, setInputValue] = useState(query || '')

  // Sync external query prop -> internal input (e.g. user navigates via URL)
  useEffect(() => { setInputValue(query || '') }, [query])

  // Fire the search when the resolved query changes.
  useEffect(() => {
    if (!query) return
    stream.run(query, { mode, focus })
    // Scroll to results top so the user sees the freshly streaming content
    // even if they re-search while scrolled mid-page.
    setTimeout(() => resultsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, focus])

  // Submit handler
  const handleSubmit = useCallback((nextMode) => {
    const q = inputValue.trim()
    if (!q) return
    if (nextMode && nextMode !== mode) onModeChange(nextMode)
    onQueryChange(q)
  }, [inputValue, mode, onModeChange, onQueryChange])

  // Keyboard shortcuts — / focuses, ⌘+Enter (or Ctrl+Enter) submits Deep,
  // Escape clears back to home (empty query).
  useEffect(() => {
    const handler = (e) => {
      const inField = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      if (e.key === '/' && !inField && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && inputValue.trim()) {
        e.preventDefault()
        handleSubmit('deep')
        return
      }
      if (e.key === 'Escape' && inField && document.activeElement === inputRef.current) {
        inputRef.current?.blur()
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [inputValue, handleSubmit])

  // Look up which layout to render based on the classification meta.
  // While we're still pre-meta (loading), use ASSET_ANALYSIS as a reasonable
  // default so skeletons mount in the right shape immediately.
  const classification = stream.meta?.classification || (query ? 'ASSET_ANALYSIS' : 'GENERAL')
  const cfg = CLASSIFICATION_CONFIG[classification] || CLASSIFICATION_CONFIG.GENERAL
  const RightRail = cfg?.rail
  const hasRail = !!RightRail

  // When status is idle (no query yet), render a minimal home state — just
  // the hero with the input ready. The first search transitions into the
  // results grid below.
  const showResults = !!query

  return (
    <div className="se2-shell" data-has-rail={hasRail ? 'true' : 'false'}>
      <SearchHero
        query={query}
        meta={stream.meta}
        status={stream.status}
        done={stream.done}
        mode={mode}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSubmit={handleSubmit}
        onModeChange={onModeChange}
        inputRef={inputRef}
      />

      {showResults && (
        <div className="se2-grid" ref={resultsTopRef}>
          <main className="se2-main">
            <Suspense fallback={null}>
              {cfg.main.map((block, i) => {
                if (typeof block === 'string') {
                  return <LazyBlock key={`${block}-${i}`} name={block} stream={stream} />
                }
                const BlockComponent = block
                return <BlockComponent key={i} stream={stream} />
              })}
            </Suspense>
          </main>

          {hasRail && (
            <aside className="se2-rail">
              <Suspense fallback={null}>
                <RightRail stream={stream} />
              </Suspense>
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
