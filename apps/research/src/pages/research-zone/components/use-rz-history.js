import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getHistory, pushHistory, clearHistory, updateHistoryMeta, saveSession, saveChartSetup, getChartSetup } from '@/services/rzLocalStorage'
import useSettingsStore from '@/store/useSettingsStore'
import { isReaderNamed } from './rz-default-landing'

/**
 * Tracks the current RZ token in localStorage history,
 * exposes the recent list and a quick-switcher modal toggle.
 */
export default function useRzHistory({ symbol, name, logo, isStock }) {
  const [history, setHistory] = useState(() => getHistory())
  const [switcherOpen, setSwitcherOpen] = useState(false)

  // Read name/logo via refs so identity enrichment (logo backfill, name
  // replacement) doesn't re-push the same token to history multiple times
  // and pollute the recent list with duplicates.
  const metaRef = useRef({ name, logo, isStock })
  metaRef.current = { name, logo, isStock }

  // Push current token to history on symbol change only
  useEffect(() => {
    if (!symbol) return
    const { name: n, logo: l, isStock: s } = metaRef.current
    pushHistory({ symbol, name: n, logo: l, isStock: s })
    setHistory(getHistory())
  }, [symbol])

  // …and record HOW it was being looked at, so returning to /research-zone can
  // offer to resume instead of resetting to the default token. This hook is the
  // one place both the desktop and mobile trees already hand over the same
  // four identity fields, which is why the capture lives here rather than in
  // two layouts that would drift.
  //
  // 🪤 It must only ever record a token the READER named. Landing on bare
  // /research-zone resolves to the default token and then REWRITES the URL to
  // it (research-zone-lite's canonical-slug effect), so an unguarded capture
  // saved "BTC" and destroyed the very session the resume prompt was about to
  // offer — merely opening the desk erased where you left off.
  //
  // Only a token the READER named is worth remembering — see rz-default-landing
  // for the four signals that lied before the URL-transition rule.
  const { coinSlug } = useParams()

  const chartType = useSettingsStore((st) => st.chartType)
  const chartTimeframe = useSettingsStore((st) => st.chartTimeframe)
  useEffect(() => {
    if (!symbol || !isReaderNamed()) return
    const { name: n, logo: l, isStock: s } = metaRef.current
    saveSession({ symbol, name: n, logo: l, isStock: s, chartType, chartTimeframe })
  }, [symbol, chartType, chartTimeframe, coinSlug])

  // ── Per-token chart setup ───────────────────────────────────────────────
  // The timeframe and chart type are single GLOBAL settings, so the one you
  // picked for a project was gone the moment you opened anything else. Remember
  // them per token and hand them back on return (founder ask, 08-24).
  const chartTypeMobile = useSettingsStore((st) => st.chartTypeMobile)
  const setChartTimeframe = useSettingsStore((st) => st.setChartTimeframe)
  const setChartType = useSettingsStore((st) => st.setChartType)
  const setChartTypeMobile = useSettingsStore((st) => st.setChartTypeMobile)

  // Apply on arrival. Runs on the symbol alone so it cannot loop: the setters
  // below write the same values it just read.
  useEffect(() => {
    if (!symbol) return
    const saved = getChartSetup(symbol)
    if (!saved) return
    if (saved.chartTimeframe) setChartTimeframe(saved.chartTimeframe)
    if (saved.chartType) setChartType(saved.chartType)
    if (saved.chartTypeMobile) setChartTypeMobile(saved.chartTypeMobile)
  }, [symbol, setChartTimeframe, setChartType, setChartTypeMobile])

  // 🪤 Remember ONLY a change made while staying on the same token. On a token
  // switch the global settings still hold the PREVIOUS token's values for one
  // commit — saving there would write the old timeframe onto the new project
  // and overwrite exactly what the effect above is restoring. Skipping the
  // switch commit is what keeps the two from fighting.
  const setupRef = useRef({ symbol: null, chartTimeframe, chartType, chartTypeMobile })
  useEffect(() => {
    const prev = setupRef.current
    setupRef.current = { symbol, chartTimeframe, chartType, chartTypeMobile }
    if (!symbol || prev.symbol !== symbol) return
    if (prev.chartTimeframe === chartTimeframe && prev.chartType === chartType
      && prev.chartTypeMobile === chartTypeMobile) return
    saveChartSetup(symbol, { chartTimeframe, chartType, chartTypeMobile })
  }, [symbol, chartTimeframe, chartType, chartTypeMobile])

  // …and because the push above deliberately ignores later identity updates,
  // the row it wrote carries whatever was known at that instant — which on a
  // fresh open is the bare symbol and NO logo. Backfill the stored row in place
  // once the real name/logo resolve, so the quick switcher stops drawing letter
  // chips for tokens it has perfectly good logos for (founder 08-17). Position
  // and timestamp are untouched, and a no-op write returns false so this cannot
  // loop.
  useEffect(() => {
    if (!symbol) return
    if (!logo && (!name || name === symbol)) return
    if (updateHistoryMeta({ symbol, name, logo, isStock })) setHistory(getHistory())
  }, [symbol, name, logo, isStock])

  // Keyboard shortcut: Alt+H opens the switcher
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'h' || e.key === 'H')) {
        if (isInput) return
        e.preventDefault()
        setSwitcherOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const openSwitcher = useCallback(() => setSwitcherOpen(true), [])
  const closeSwitcher = useCallback(() => setSwitcherOpen(false), [])

  const refresh = useCallback(() => setHistory(getHistory()), [])

  const clear = useCallback(() => {
    clearHistory()
    setHistory([])
  }, [])

  return {
    history,
    switcherOpen,
    openSwitcher,
    closeSwitcher,
    refresh,
    clear,
  }
}
