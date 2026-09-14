import { useCallback, useEffect, useReducer } from 'react'
import { INITIAL_RESEARCH_NAVIGATION, normalizeResearchNavigation, researchNavigationReducer } from '../data/rz-navigation'

export function useResearchZoneNavigation(isStock) {
  const [state, dispatch] = useReducer(researchNavigationReducer, INITIAL_RESEARCH_NAVIGATION)
  useEffect(() => { dispatch({ type: 'asset', isStock }) }, [isStock])
  const selectDesktop = useCallback(id => dispatch({ type: 'desktop', id, isStock }), [isStock])
  const selectMobile = useCallback(id => dispatch({ type: 'mobile', id, isStock }), [isStock])
  // No frame with an unavailable tab when a token switches asset class.
  return { ...normalizeResearchNavigation(state, isStock), selectDesktop, selectMobile }
}
