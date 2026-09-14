import { useRef, useEffect, useMemo } from 'react'
import { useSearchParams, useParams } from 'react-router-dom'
import { isTradableContract } from '@/lib/trading-terminal'
import { useTranslation } from 'react-i18next'
import { useAppState } from '@/contexts/AppStateContext'
import { useWatchlists } from '@/contexts/WatchlistsContext'
import useSettingsStore from '@/store/useSettingsStore'
import { isDev } from '@/utils/env'
import TokenSocialDrawer from './components/token-social-drawer'
import './token-embed.css'
// Production iframe origin: trade.spectreai.io (custom domain alias of
// spectre-trading.vercel.app). Migrated 2026-05-19 as part of the Phase A
// DNS swap that aliases research at app.spectreai.io and trading at
// trade.spectreai.io. Both apps now live under .spectreai.io so the iframe
// is still cross-origin but on the same parent domain (better Privy session
// sharing on Chrome/Firefox; Safari ITP still applies to nested iframes).
const TRADING_APP_URL = isDev
  ? (import.meta.env.VITE_TRADING_APP_URL || `http://localhost:${typeof __TRADING_PORT__ !== 'undefined' ? __TRADING_PORT__ : 5181}`)
  // PROD embed targets spectre-trading.vercel.app and authenticates the demo
  // session via the x-demo-token HEADER, not a cookie (SEC-20260521-DEMOTOKEN-R2).
  // The same-site trade.spectreai.io path made the demo cookie first-party but
  // broke every cross-origin backend whose CORS allow-list is tuned for
  // spectre-trading.vercel.app (e.g. srv.spectreai.io dossier). The header
  // transport is third-party-cookie-proof, repo-contained, and keeps those
  // backends working. trade.spectreai.io stays claimed/live (do NOT release it -
  // subdomain-takeover vector) but is no longer the embed src.
  : 'https://spectre-trading.vercel.app'
const ENABLE_LOCAL_TRADING_EMBED = !isDev || import.meta.env.VITE_ENABLE_TRADING_EMBED === 'true'

// Vercel-default deploy URL (kept as fallback in postMessage origin allow-list
// for early Phase A days while DNS propagates / Vercel cert provisions, and
// for Vercel preview branches that don't have the trade.spectreai.io alias).
const TRADING_VERCEL_URL = 'https://spectre-trading.vercel.app'
// Vercel preview URLs for the trading app (e.g. spectre-trading-abc123.vercel.app).
// SECURITY: anyone can register a `spectre-trading-*.vercel.app` project on
// Vercel, so this regex must NEVER be trusted on the production research host -
// a third-party origin matching it could postMessage into the token iframe
// parent. Preview origins are therefore only honored when the research app
// itself is running off-prod (preview / localhost), where we control the pair.
const TRADING_PREVIEW_RE = /^https:\/\/spectre-trading-[a-z0-9-]+\.vercel\.app$/

// sessionStorage cache for the demo session token. The mint returns a signed,
// IP-bound, 15-min token. Caching it (with the mint timestamp) survives /token
// remounts and lets visibilitychange skip re-minting while the token is still
// fresh. We treat anything older than ~12min as stale (3-min safety margin under
// the 15-min server expiry). sessionStorage is per-tab, which matches the
// IP-bound, this-session scope of the token.
const DEMO_TOKEN_CACHE_KEY = 'spectre-demo-token-v1'
const DEMO_TOKEN_MAX_AGE_MS = 12 * 60 * 1000
// Returns the cached token only if it's still younger than `maxAgeMs`.
// Default 12min is the "good enough to reuse" window (mount / visibility return).
// The proactive refresh interval passes a tighter age so it renews before expiry.
const readCachedDemoToken = (maxAgeMs = DEMO_TOKEN_MAX_AGE_MS) => {
  try {
    const raw = sessionStorage.getItem(DEMO_TOKEN_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.token !== 'string' || typeof parsed.mintedAt !== 'number') return null
    if (Date.now() - parsed.mintedAt >= maxAgeMs) return null
    return parsed.token
  } catch { return null }
}
const writeCachedDemoToken = (token) => {
  try {
    sessionStorage.setItem(DEMO_TOKEN_CACHE_KEY, JSON.stringify({ token, mintedAt: Date.now() }))
  } catch { /* sessionStorage unavailable (private mode / quota) — ignore */ }
}

const isAllowedOrigin = (origin) => {
  if (origin === TRADING_APP_URL || origin === TRADING_VERCEL_URL) return true
  const onProdHost = typeof window !== 'undefined' && window.location.hostname === 'app.spectreai.io'
  return !onProdHost && TRADING_PREVIEW_RE.test(origin)
}

export default function TokenPage() {
  const { t } = useTranslation()
  const iframeRef = useRef(null)
  const { token, selectToken } = useAppState()
  const [searchParams, setSearchParams] = useSearchParams()
  const { tokenId: pathTokenId } = useParams()
  const { tradingWatchlist: watchlist, syncTradingWatchlist: reorderWatchlist } = useWatchlists()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const tokenColoring = useSettingsStore((s) => s.tokenColoring)
  // Tracks whether last watchlist change came from iframe ('remote') or local (null)
  const syncSourceRef = useRef(null)
  // Skip mount run of watchlist effect — handleIframeLoad handles the initial send
  const initialSyncSentRef = useRef(false)
  // No iframe-render gate: the iframe mounts IMMEDIATELY for fast first paint.
  // The demo token is delivered to the embed via mint-completion + the
  // spectre:embed-ready handshake (below) - we no longer block render on the mint.
  // Demo token from the trading mint response. Cross-site fallback transport
  // (SEC-20260521-DEMOTOKEN): postMessaged to the iframe, which sends it as
  // x-demo-token. Null on the prod same-site path (first-party cookie carries it).
  const demoTokenRef = useRef(null)
  // Holds the latest handleIframeLoad so the (mount-only) message listener can
  // re-send initial state on the iframe's embed-ready handshake with fresh props.
  const handleIframeLoadRef = useRef(null)
  // Becomes true only after the iframe has navigated to the trading origin
  // (its `load` event / the embed-ready handshake). BEFORE that, the freshly
  // created iframe.contentWindow is an about:blank document that INHERITS the
  // parent (research) origin, so a postMessage pinned to the trading origin is
  // rejected by the browser: "target origin ('https://spectre-trading.vercel.app')
  // does not match the recipient window's origin ('https://app.spectreai.io')".
  // The token/theme/watchlist sync effects below therefore wait for this flag;
  // handleIframeLoad sends the full initial state on load, so nothing is lost
  // by skipping the pre-load posts.
  const iframeReadyRef = useRef(false)

  // Mint a short-lived, read-only demo session on the TRADING origin IN PARALLEL
  // with the iframe load (no longer gating render). The trading market-data
  // endpoints accept this signed, IP-bound, 15-min token via the x-demo-token
  // header (SEC-20260521-DEMOTOKEN-R2). The cross-origin call's browser-set
  // Origin proves it came from the research app. Delivery to the iframe:
  //   - if the iframe is already loaded when the mint resolves -> post it now
  //   - otherwise the spectre:embed-ready handshake delivers it on iframe boot
  // Best-effort: signed-in Privy users don't need it; failure just no-ops.
  useEffect(() => {
    // Deliver a held token to the iframe (once it's at the trading origin).
    const postToIframe = (token) => {
      const iframe = iframeRef.current
      if (iframe?.contentWindow && iframeReadyRef.current) {
        iframe.contentWindow.postMessage(
          { type: 'spectre:demo-token', payload: { token } },
          TRADING_APP_URL
        )
      }
    }
    // Mint a fresh token from the trading origin and cache it.
    const mint = () => {
      fetch(`${TRADING_APP_URL}/api/auth-gate?action=demo-session`, {
        method: 'GET',
        credentials: 'include',
        mode: 'cors',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && typeof data.token === 'string') {
            demoTokenRef.current = data.token
            writeCachedDemoToken(data.token)
            // If the mint resolves before load, handleIframeLoad / embed-ready re-deliver it.
            postToIframe(data.token)
          }
        })
        .catch(() => { /* signed-in users still render; ignore */ })
    }
    // Reuse a still-fresh token instead of re-minting. `maxAgeMs` controls how
    // fresh "fresh enough" is: mount / visibility-return reuse anything <12min;
    // the proactive refresh interval reuses only <9min so it renews before the
    // 15-min server expiry. Survives /token remounts (the useRef alone was lost
    // on every remount) and short hidden/visible cycles.
    const ensureToken = (maxAgeMs) => {
      const cached = readCachedDemoToken(maxAgeMs)
      if (cached) {
        demoTokenRef.current = cached
        postToIframe(cached)
        return
      }
      mint()
    }
    ensureToken()
    // The token expires after 15 minutes. Refresh on a 10-minute cadence so the
    // embed always holds a live token; skip hidden tabs (visibilitychange covers
    // stale-on-return). The 9-min reuse window forces a renew here once the token
    // is past its prime, but a token minted moments ago by mount won't re-mint.
    const refresh = setInterval(() => { if (!document.hidden) ensureToken(9 * 60 * 1000) }, 10 * 60 * 1000)
    const onVisible = () => { if (!document.hidden) ensureToken() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Build iframe src once — token is sent via postMessage in handleIframeLoad,
  // so we don't bake it into the URL (avoids stale token from previous session).
  // Did this load carry a token in the URL (/trade/<address> or legacy query)?
  // Decides the embed's boot view: token page vs Discover (Gleb 2026-07-18:
  // bare Trading Lite opens Discover, not a token). Computed ONCE - the embed
  // boots once; later switches flow via postMessage.
  const initialHasTokenRef = useRef(null)
  if (initialHasTokenRef.current === null) {
    initialHasTokenRef.current = Boolean(
      (pathTokenId || '').trim()
      || searchParams.get('address')
      || searchParams.get('symbol')
      || searchParams.get('cgId')
    )
  }
  // Discover mode: bare /trade, no token actively chosen yet. While active the
  // parent sends no select-token, keeps the URL bare and lets the embed sit on
  // its Discover view. Exits when the user picks a token (in the embed via
  // spectre:token-changed, or research-side via a real AppState change).
  const discoverModeRef = useRef(!initialHasTokenRef.current)

  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams({ embedded: 'true' })
    // Trading Lite is DARK-ONLY: never boot the embed into light theme even if
    // the user's global dayMode preference is on. The trading terminal has no
    // light-theme parity, and the header day/night switch is locked on this
    // page (see Header tradingModeActive branch). So we intentionally do NOT
    // pass theme=light here.
    // Hash decides the boot view: #token when the URL carries a token,
    // hash-less otherwise - embedded mode lands on Discover (trading App.jsx
    // "otherwise land on Discover" branch).
    return `${TRADING_APP_URL}?${params.toString()}${initialHasTokenRef.current ? '#token' : ''}`
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Send initial state when iframe loads
  const handleIframeLoad = () => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    // The iframe is now at the trading origin — pinned-origin posts are safe.
    iframeReadyRef.current = true

    // Hand the cross-site demo token to the iframe FIRST, so its read-only data
    // calls (triggered by select-token below) carry x-demo-token from the start.
    // targetOrigin pinned to the exact trading origin (SEC-20260521-DEMOTOKEN).
    // No-op on the prod same-site path where the first-party cookie is used.
    if (demoTokenRef.current) {
      iframe.contentWindow.postMessage(
        { type: 'spectre:demo-token', payload: { token: demoTokenRef.current } },
        TRADING_APP_URL
      )
    }

    // Discover mode: don't push the persisted AppState token into the embed -
    // it would flip the Discover boot view straight to a token page.
    if (token && !discoverModeRef.current) {
      iframe.contentWindow.postMessage(
        { type: 'spectre:select-token', payload: token },
        TRADING_APP_URL
      )
    }

    // Trading Lite is dark-only — always tell the embed to render dark,
    // regardless of the user's global dayMode. tokenColoring still flows through.
    iframe.contentWindow.postMessage(
      { type: 'spectre:set-theme', payload: { dayMode: false, tokenColoring } },
      TRADING_APP_URL
    )

    // Send current watchlist to iframe (including empty — tells iframe to clear)
    iframe.contentWindow.postMessage(
      { type: 'spectre:watchlist-sync', payload: { tokens: watchlist || [] } },
      TRADING_APP_URL
    )
  }
  // Keep a live ref so the embed-ready handshake handler re-sends fresh state.
  handleIframeLoadRef.current = handleIframeLoad

  /* Shareable deep-link. The token identity lives in AppState (postMessaged to
     the embed), so the URL was a bare /token - not shareable and confusing.
     HYDRATE (once, on cold load / a shared link): if the URL carries a token
     and it isn't already selected, seed AppState from it so the embed loads it.
     A shared link wins over a persisted last-token, but only on this first run. */
  // Address of the last token switch REPORTED BY the embed (watchlist cards,
  // in-embed search). Lets the sync-to-iframe effect skip echoing that exact
  // selection back, and the message handler dedupe repeats.
  const embedTokenAddrRef = useRef(null)
  // Live view of the selected token for the (once-bound) message listener.
  const liveTokenRef = useRef(null)
  useEffect(() => { liveTokenRef.current = token }, [token])
  // Token identity at mount - in discover mode, only a CHANGE away from this
  // (a real user pick research-side) exits discover; persisted-state churn
  // with the same address does not.
  const mountTokenAddrRef = useRef(null)
  if (mountTokenAddrRef.current === null) {
    mountTokenAddrRef.current = String(token?.address || '').toLowerCase()
  }

  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    // Short form /token/<address> wins (the canonical shareable link). A path
    // segment shaped like a real contract hydrates as the address; anything
    // else is treated as a symbol. Query params (?address=&symbol=&cgId=)
    // keep working for old shared links.
    const seg = (pathTokenId || '').trim()
    const segIsAddr = seg && isTradableContract(seg)
    const urlAddr = (segIsAddr ? seg : '') || searchParams.get('address') || ''
    const urlSym = (seg && !segIsAddr ? seg : '') || searchParams.get('symbol') || ''
    const urlCg = searchParams.get('cgId') || ''
    if (!urlAddr && !urlSym && !urlCg) return
    const already = token && (
      (urlAddr && token.address && urlAddr.toLowerCase() === String(token.address).toLowerCase())
      || (!urlAddr && urlCg && (token.cgId || token.cg_id) && urlCg === (token.cgId || token.cg_id))
      || (!urlAddr && !urlCg && urlSym && token.symbol && urlSym.toUpperCase() === String(token.symbol).toUpperCase())
    )
    if (already) return
    const nid = Number(searchParams.get('networkId'))
    selectToken({
      address: urlAddr || undefined,
      symbol: urlSym || undefined,
      cgId: urlCg || null,
      networkId: Number.isFinite(nid) && nid > 0 ? nid : undefined,
      name: urlSym || undefined,
    })
  }, [searchParams, token, selectToken])

  /* REFLECT the selected token into the URL (replace, no history spam) so a
     copied /token link carries the token. The iframe src is memoized + bare, so
     this never reloads the embed.
     Short form: /token/<address> - the CA alone is the identity (both apps
     infer the network from the address format on their deep links). networkId
     is appended ONLY when it isn't inferable (EVM 0x defaults to 1, base58 is
     Solana 1399811149). symbol/cgId are cosmetic - dropped from the URL.
     Tokens without an address keep the legacy query form. */
  useEffect(() => {
    if (!token) return
    // Discover mode: URL stays a bare /trade - reflecting the persisted token
    // would lie about what the embed is showing (its Discover view).
    if (discoverModeRef.current) return
    const address = token.address || ''
    const symbol = token.symbol || ''
    const cgId = token.cgId || token.cg_id || ''
    if (!address && !symbol && !cgId) return
    if (typeof window === 'undefined') return
    if (address) {
      const nid = Number(token.networkId)
      const isEvm = address.startsWith('0x')
      // Append networkId ONLY for non-mainnet EVM chains (Base 8453, Robinhood
      // 4663, ...). 0x + nid 1 is the inferable default; base58 NEVER carries
      // one - the format itself identifies the chain family, and a nid of 1 on
      // a base58 address is a store-default artifact, not real data.
      const appendNid = isEvm && Number.isFinite(nid) && nid > 1
      const target = `/trade/${address}${appendNid ? `?networkId=${nid}` : ''}`
      const cur = window.location.pathname + window.location.search
      // history.replaceState, NOT navigate(): a router navigation between
      // /trade/<a> and /trade/<b> REMOUNTS this page - the embed iframe
      // cold-boots and flashes white on every token switch. The URL here is a
      // cosmetic mirror (hydration reads it only on cold load), so bypass the
      // router entirely. history.state is preserved to keep React Router's
      // internal entry ({usr,key,idx}) intact.
      if (cur !== target) window.history.replaceState(window.history.state, '', target)
      return
    }
    const next = new URLSearchParams()
    if (symbol) next.set('symbol', symbol)
    if (cgId) next.set('cgId', cgId)
    const cur = window.location.search.replace(/^\?/, '')
    if (next.toString() !== cur) setSearchParams(next, { replace: true })
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync token changes to iframe
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow || !token) return
    // Discover mode: the persisted mount token must not flip the embed off its
    // Discover view. A DIFFERENT address means the user actively picked a
    // token research-side - exit discover and sync it.
    if (discoverModeRef.current) {
      const addr = String(token.address || '').toLowerCase()
      if (!addr || addr === mountTokenAddrRef.current) return
      discoverModeRef.current = false
    }
    // This change ORIGINATED in the embed (spectre:token-changed) - posting it
    // back would be a pointless echo (and a re-render inside the embed).
    // One-shot: consume the flag so a LATER parent-side re-selection of the
    // same token still reaches the embed.
    if (token.address && embedTokenAddrRef.current
      && token.address.toLowerCase() === embedTokenAddrRef.current) {
      embedTokenAddrRef.current = null
      return
    }
    // Skip until the iframe is at the trading origin (handleIframeLoad sends the
    // current token on load). Posting to a still-about:blank iframe throws the
    // cross-origin postMessage error.
    if (!iframeReadyRef.current) return

    iframe.contentWindow.postMessage(
      { type: 'spectre:select-token', payload: token },
      TRADING_APP_URL
    )
  }, [token])

  // Sync tokenColoring changes to iframe. dayMode is intentionally pinned to
  // false (Trading Lite is dark-only) — we still depend on `dayMode` so this
  // re-fires if the user toggles it elsewhere, re-asserting dark in the embed.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    if (!iframeReadyRef.current) return

    iframe.contentWindow.postMessage(
      { type: 'spectre:set-theme', payload: { dayMode: false, tokenColoring } },
      TRADING_APP_URL
    )
  }, [dayMode, tokenColoring])

  // Sync watchlist changes to iframe (skip mount run + skip when change came from iframe)
  useEffect(() => {
    if (!initialSyncSentRef.current) {
      // Skip mount run — handleIframeLoad handles initial send
      initialSyncSentRef.current = true
      return
    }
    if (syncSourceRef.current === 'remote') {
      syncSourceRef.current = null
      return
    }
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    if (!iframeReadyRef.current) return

    iframe.contentWindow.postMessage(
      { type: 'spectre:watchlist-sync', payload: { tokens: watchlist || [] } },
      TRADING_APP_URL
    )
  }, [watchlist])

  // Listen for watchlist updates from iframe (Trading app)
  useEffect(() => {
    const handleMessage = (event) => {
      // Security: only accept messages from our own origin, the trading app, or trading preview deploys
      if (event.origin !== window.location.origin && !isAllowedOrigin(event.origin)) return
      const { type, payload } = event.data || {}

      // Iframe finished mounting its message listener - (re)send initial state +
      // the demo token, covering the case where our onLoad post raced its setup.
      if (type === 'spectre:embed-ready') {
        handleIframeLoadRef.current?.()
        return
      }

      // Embed switched tokens (watchlist cards / in-embed search). Mirror it
      // into AppState so the /trade/<address> URL follows (REFLECT effect).
      if (type === 'spectre:token-changed' && payload?.address) {
        const cur = liveTokenRef.current
        const same = cur?.address
          && String(cur.address).toLowerCase() === String(payload.address).toLowerCase()
        // Same address as the persisted token, picked from Discover: no state
        // change fires the reflect effect, so end discover mode and mirror the
        // URL here directly.
        if (same && discoverModeRef.current) {
          discoverModeRef.current = false
          window.history.replaceState(window.history.state, '', `/trade/${payload.address}`)
          return
        }
        if (!same) {
          // Picking a token (e.g. from the embed's Discover list) ends
          // discover mode - the URL now mirrors the active token.
          discoverModeRef.current = false
          embedTokenAddrRef.current = String(payload.address).toLowerCase()
          selectToken({
            address: payload.address,
            networkId: payload.networkId || undefined,
            symbol: payload.symbol || undefined,
            name: payload.name || payload.symbol || undefined,
            logo: payload.logo || undefined,
            cgId: payload.cgId || null,
          })
        }
        return
      }

      if (type === 'spectre:watchlist-updated' && Array.isArray(payload?.tokens)) {
        // Normalize tokens — keep only fields Research app expects
        const normalized = payload.tokens.map((t) => ({
          symbol: t.symbol,
          name: t.name,
          address: t.address,
          networkId: t.networkId,
          pinned: t.pinned || false,
          logo: t.logo,
          isStock: t.isStock,
        }))

        // Mark as remote to prevent sending back to iframe
        syncSourceRef.current = 'remote'
        reorderWatchlist(normalized)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [reorderWatchlist, selectToken])

  return (
    <div className="trading-embed-container">
      {ENABLE_LOCAL_TRADING_EMBED ? (
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title={t('tokenPage.iframeTitle', 'Spectre Trading Terminal')}
          className="trading-embed-iframe"
          onLoad={handleIframeLoad}
          allow="clipboard-write; clipboard-read; publickey-credentials-get; payment"
        />
      ) : (
        <div className="trading-embed-placeholder">
          <h1>{t('tokenPage.embedPausedTitle', 'Trading terminal paused locally')}</h1>
          <p>{t('tokenPage.embedPausedBody', 'Set VITE_ENABLE_TRADING_EMBED=true and run the trading app if you want this iframe during local frontend audits.')}</p>
        </div>
      )}
      {/* Research-side social scan over the embed — finds tweets for ANY token
          (incl. untracked on-chain micro-caps not in the X Dash KOL set). */}
      <TokenSocialDrawer token={token} />
    </div>
  )
}
