import { useCallback, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import ResearchZoneLite from './components/research-zone-lite'
import RzResumePrompt from './components/rz-resume-prompt'
import { notePath } from './components/rz-default-landing'
import { useAppState } from '@/contexts/AppStateContext'
import useSettingsStore from '@/store/useSettingsStore'
import { resolveSlugToSymbol, getCanonicalSlug, getTokenSlug } from '@/lib/tokenSlugs'
import {
  doesResearchZoneTokenMatchSlug,
  readResearchZoneTokenFromSearch,
} from '@/lib/research-zone-routing'

export default function ResearchZonePage() {
  const { coinSlug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { researchZoneToken, setResearchZoneToken } = useAppState()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const setDayMode = useSettingsStore((s) => s.setDayMode)
  const appDisplayMode = useSettingsStore((s) => s.appDisplayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)

  // Feed the URL-transition rule during RENDER: the parent renders before its
  // children, so this is settled before any child effect can record a session.
  notePath(location.pathname)

  const queryToken = useMemo(
    () => readResearchZoneTokenFromSearch(location.search),
    [location.search]
  )
  const matchedQueryToken = queryToken && doesResearchZoneTokenMatchSlug(queryToken, coinSlug)
    ? queryToken
    : null

  // Legacy ?symbol= redirect — preserve location.state so fromWelcome
  // (and anything else callers attach) survives the slug rewrite.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const legacySymbol = params.get('symbol')
    if (legacySymbol) {
      const slug = getTokenSlug(legacySymbol, marketMode === 'stocks')
      navigate({ pathname: `/research-zone/${slug}`, search: location.search }, { replace: true })
    }
  }, [navigate, marketMode, location.search])

  // Redirect symbol-as-slug to canonical CoinGecko slug (e.g. /research-zone/btc → /research-zone/bitcoin).
  // Preserve location.state through the redirect so the MobileBackButton
  // still sees fromWelcome after the canonical rewrite.
  useEffect(() => {
    if (!coinSlug) return
    const canonical = getCanonicalSlug(coinSlug)
    if (canonical) {
      navigate({ pathname: `/research-zone/${canonical}`, search: location.search }, { replace: true })
    }
  }, [coinSlug, navigate, location.search])

  useEffect(() => {
    if (!matchedQueryToken) return
    setResearchZoneToken(matchedQueryToken)
  }, [matchedQueryToken, setResearchZoneToken])

  const resolvedSymbol = matchedQueryToken?.symbol
    || (coinSlug ? resolveSlugToSymbol(coinSlug) : researchZoneToken?.symbol || 'BTC')

  const contextTokenMatches = researchZoneToken && (
    researchZoneToken.symbol?.toUpperCase() === resolvedSymbol?.toUpperCase() ||
    researchZoneToken.cgId === coinSlug ||
    // Match name-derived slugs (e.g. context has symbol:'PALM', name:'PaLM AI' → slug 'palm-ai')
    (coinSlug && getTokenSlug(researchZoneToken.symbol, false, researchZoneToken.cgId, researchZoneToken.name) === coinSlug)
  )

  // Pass full token data from URL or context if it matches the resolved symbol or slug
  const initialToken = matchedQueryToken || (contextTokenMatches ? researchZoneToken : null)

  // Use context symbol when available (more accurate than slug-derived symbol for name-based slugs)
  const effectiveSymbol = initialToken?.symbol || resolvedSymbol

  // Landing with no slug resolves to the default token, which is what threw
  // away an in-progress session. Offer to resume there — and only there: with a
  // slug in the URL the reader has already said what they want.
  const handleResume = useCallback((token) => {
    if (!token?.slug) return
    setResearchZoneToken({ symbol: token.symbol, name: token.name, logo: token.logo, isStock: token.isStock })
    navigate(`/research-zone/${token.slug}`)
  }, [navigate, setResearchZoneToken])

  return (
    <>
      <ResearchZoneLite
        initialSymbol={effectiveSymbol}
        initialToken={initialToken}
        dayMode={dayMode}
        onDayModeChange={setDayMode}
        cinemaMode={appDisplayMode === 'cinema'}
        marketMode={marketMode}
      />
      <RzResumePrompt
        active={!coinSlug && !matchedQueryToken}
        currentSymbol={effectiveSymbol}
        onResume={handleResume}
      />
    </>
  )
}
