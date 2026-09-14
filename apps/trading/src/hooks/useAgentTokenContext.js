/**
 * useAgentTokenContext - the Spectre Agent's context assembler. Composes
 * everything the token page ALREADY holds into a compact digest for the
 * chat backend. Cache-composition only (2026-06 Codex cost-war rule):
 *
 *   - live market details: useSharedTokenDetails() (TokenDetailsContext -
 *     already polled/streamed for the page; throws outside the provider,
 *     so this hook may only be mounted inside the token view)
 *   - chart bars: getCachedBars() - reads the chart's module cache /
 *     in-flight promise, NEVER triggers a fetch
 *   - security: fetchTokenTaxCached() - 24h module+LS cache (EVM only)
 *   - dossier lore: useDossier() - 30s module cache with subscriber fanout
 *   - tweets: fetchOfficialFeed() - 5-min shared cache, only when the
 *     token has a known X handle
 *
 * Mount-gating IS the enable gate: mount this hook only in the open chat
 * panel (api-patterns.md section L, pattern 1). Zero new pollers.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useSharedTokenDetails } from '../contexts/TokenDetailsContext'
import useSettingsStore from '../store/useSettingsStore'
import { usePrivySafe } from '../lib/use-privy-safe'
import { deriveAccountName, humanizeName } from '../lib/greeting'
import { getCachedBars } from './useCodexData'
import useDossier from './useDossier'
import { fetchOfficialFeed } from './useXProfile'
import { fetchTokenTaxCached } from '../lib/tokenTax'
import { buildDigest } from '../lib/agentDigest'

const BARS_RESOLUTION = '60'

function twitterHandleFrom(tokenData, token) {
  const raw = tokenData?.socials?.twitter || token?.socials?.twitter
  if (!raw || typeof raw !== 'string') return null
  const m = raw.match(/(?:twitter\.com|x\.com)\/(@?[A-Za-z0-9_]{1,15})/) || raw.match(/^@?([A-Za-z0-9_]{1,15})$/)
  return m ? m[1].replace(/^@/, '') : null
}

export function useAgentTokenContext(token, { surface = 'desktop' } = {}) {
  const { tokenData, loading } = useSharedTokenDetails()
  const dossier = useDossier(token)
  const profileName = useSettingsStore((s) => s.profile?.name)
  // The store name is often EMPTY - most users never set one; the hero
  // derives it from the signed-in Privy account (Google name, Telegram
  // first name, handle...). Same derivation here so the agent knows it.
  const privy = usePrivySafe()
  const accountName = privy?.authenticated ? deriveAccountName(privy?.user) : ''
  // humanizeName: "Gleb02f" is a person called Gleb - the agent must never
  // read a raw username aloud or in text.
  const userName = humanizeName(profileName) || accountName

  const [bars, setBars] = useState(null)
  const [security, setSecurity] = useState(null)
  const [tweets, setTweets] = useState(null)
  const detailLandedAt = useRef(null)

  const address = token?.address
  const networkId = token?.networkId
  const isPlaceholder = !address || token?.symbol === '...'

  useEffect(() => {
    if (tokenData) detailLandedAt.current = Date.now()
  }, [tokenData])

  // Bars from the chart's module cache (async read, no fetch).
  useEffect(() => {
    if (isPlaceholder) { setBars(null); return }
    let cancelled = false
    getCachedBars(address, networkId, BARS_RESOLUTION)
      .then((b) => { if (!cancelled) setBars(b || null) })
      .catch(() => { if (!cancelled) setBars(null) })
    return () => { cancelled = true }
  }, [address, networkId, isPlaceholder])

  // Security (EVM only - Solana has no QuickIntel coverage).
  useEffect(() => {
    if (isPlaceholder || networkId === 1399811149) { setSecurity(null); return }
    let cancelled = false
    fetchTokenTaxCached(address, networkId)
      .then((s) => { if (!cancelled) setSecurity(s || null) })
      .catch(() => { if (!cancelled) setSecurity(null) })
    return () => { cancelled = true }
  }, [address, networkId, isPlaceholder])

  // Tweets sample - only when the token has a known X handle (5-min shared
  // cache in useXProfile keeps repeat opens free).
  useEffect(() => {
    if (isPlaceholder) { setTweets(null); return }
    const handle = twitterHandleFrom(tokenData, token)
    if (!handle) { setTweets(null); return }
    let cancelled = false
    fetchOfficialFeed(handle)
      .then((feed) => {
        if (cancelled) return
        const list = Array.isArray(feed) ? feed : feed?.tweets
        if (Array.isArray(list) && list.length) {
          setTweets(list.slice(0, 3).map((t) => ({
            author: t.author?.username || t.username || handle,
            text: t.text || t.full_text || '',
            ts: t.created_at || t.ts,
          })))
        } else setTweets(null)
      })
      .catch(() => { if (!cancelled) setTweets(null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isPlaceholder, tokenData?.socials?.twitter])

  const ready = !isPlaceholder && !!(tokenData || !loading)

  // Fresh digest on every call - pure compose over current values, so the
  // send path always ships live numbers (stream price included).
  const getDigest = useCallback(() => {
    if (isPlaceholder) return null
    return buildDigest({
      token,
      tokenData,
      bars,
      barsResolution: BARS_RESOLUTION,
      security,
      dossier,
      tweets,
      surface,
      detailAgeSec: detailLandedAt.current ? Math.round((Date.now() - detailLandedAt.current) / 1000) : null,
      // Persona context - the profile/account name and the user's local
      // hour, which only the client knows.
      user: { name: userName || undefined, localHour: new Date().getHours() },
    })
  }, [token, tokenData, bars, security, dossier, tweets, surface, isPlaceholder, userName])

  return { ready, getDigest }
}
