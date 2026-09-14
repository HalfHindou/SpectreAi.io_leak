/**
 * Minimal Zustand settings store for the trading app.
 * Manages profile data and shared settings with server sync.
 * Persist to 'spectre-settings' localStorage key (same as research app).
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { pushProfile, getAuthToken } from '../services/profileSync'
import { readNameCookie, writeNameCookie } from '../lib/profileCookie'
import { clampDepth, isToneId, DEFAULT_TONE } from '../lib/bgTone'
import { sanitizeAccent, DEFAULT_ACCENT } from '../lib/accent'
import { sanitizeChartStyle, CHART_STYLE_DEFAULTS } from '../lib/chartStyle'
import { sanitizeDecorSkin, DEFAULT_DECOR_SKIN } from '../lib/decorSkins'
import { sanitizeTokenLayout, LAYOUT_PRESETS } from '../lib/tokenLayout'

// Batched localStorage for the persist middleware. setItem is deferred to an
// idle callback and coalesced, so a settings write never lands on the frame
// that handled the click. getItem/removeItem stay synchronous - boot
// hydration and explicit clears must not be delayed.
//
// A pending write is flushed on pagehide AND visibilitychange->hidden: on
// mobile Safari pagehide is not guaranteed, and losing the last write would
// silently drop a user preference.
const batchedLocalStorage = (() => {
  let pending = null   // { key, value }
  let handle = 0
  const idle = (cb) => (typeof window !== 'undefined' && window.requestIdleCallback)
    ? window.requestIdleCallback(cb, { timeout: 400 })
    : setTimeout(cb, 120)
  const cancel = (h) => (typeof window !== 'undefined' && window.cancelIdleCallback)
    ? window.cancelIdleCallback(h)
    : clearTimeout(h)

  const flush = () => {
    if (handle) { cancel(handle); handle = 0 }
    if (!pending) return
    const { key, value } = pending
    pending = null
    try { localStorage.setItem(key, value) } catch { /* quota / private mode */ }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush() })
  }

  return {
    getItem: (key) => { try { return localStorage.getItem(key) } catch { return null } },
    setItem: (key, value) => {
      pending = { key, value }          // last write wins - the value is the whole blob
      if (!handle) handle = idle(flush)
    },
    removeItem: (key) => {
      if (pending && pending.key === key) { pending = null }
      try { localStorage.removeItem(key) } catch { /* noop */ }
    },
  }
})()


// Settings that sync to the server
const SYNC_KEYS = ['dayMode', 'profile']

const useSettingsStore = create(
  persist(
    (set, get) => ({
      // Profile
      profile: { name: '', imageUrl: '', _userId: '' },

      // Shared settings
      dayMode: false,
      showMoodWall: true,
      tokenColoring: true,

      // Obsidian & Lime redesign settings
      reducedMotion: false,          // Mirror of OS prefers-reduced-motion, with manual override
      density: 'comfortable',         // 'compact' | 'comfortable' | 'spacious'
      recentTokens: [],               // [{ address, networkId, symbol, name, ts }] — max 10, used by CommandPalette
      bootComplete: false,            // Transient — flips true after first paint + initial data; gates BootLoader
      explorerView: 'list',           // 'list' | 'heatmap' — TokenScreener view mode (D5)

      // Swap details visibility - the Rate / Price / Price impact rows under
      // the swap inputs. OFF by default (most traders don't want the math);
      // toggled via the info button in the Buy/Sell bar. Device-local.
      showSwapDetails: false,

      // Swap trading preferences - max slippage (bps, Jupiter fills tighter
      // via dynamicSlippage), the quick-buy amount presets (pay-currency
      // units) and how the buy chips render: '%' of balance (default) or
      // the fixed preset amounts. Device-local.
      swapPrefs: {
        slippageBps: 100,
        quickBuySol: [0.01, 0.05, 0.1, 0.5],
        quickBuyPct: [25, 50, 75, 100],
        quickMode: 'percent',
      },

      // Iteration 7 — Transactions section density.
      // Lives device-local (NOT in SYNC_KEYS) — power-users want denser,
      // casual users want roomier. 'comfortable' = 50px row height,
      // 'compact' = 38px (DataTabs.css:5102 and :6493 - the old comment here
      // said 56px/40px, which never matched the CSS). Surfaced via the
      // overflow popover inside DataTabs' Iteration-7 chrome.
      // DEFAULT 'compact' (2026-07-23): this is a trading terminal, and the
      // tape is the surface traders read most. Measured against GMGN on the
      // same token - their rows are 40px, ours were 50px, so we showed ~30%
      // less tape per screen and read as a slower, heavier app. 'comfortable'
      // stays one click away in the density popover, and a user who picks it
      // wins: this value is persisted, so it only applies to new users.
      transactionsDensity: 'compact',

      // Background tone — which curated black ladder paints the platform
      // (lib/bgTone.js) plus a fine depth offset (-50..50, 0 = as designed).
      // Device-local (NOT in SYNC_KEYS): tone is a physical-environment
      // preference — screens and rooms differ per device.
      bgTone: DEFAULT_TONE,
      bgDepth: 0,

      // Accent color — user override for the platform's --accent* channel
      // (lib/accent.js). null = stock lime. Skins (lib/skins.js) are just
      // bgTone + accentColor bundles; the equipped skin is derived, never
      // stored. Device-local like bgTone.
      accentColor: DEFAULT_ACCENT,

      // Chart style — the chart's OWN appearance channel (lib/chartStyle.js),
      // deliberately independent from skins/tones/accents: equipping a skin
      // must never restyle the chart. Customized via the chart-toolbar
      // ChartStyleControl. All-null = the stock chart look. Device-local.
      chartStyle: { ...CHART_STYLE_DEFAULTS },

      // Decorative skin — the CS:GO-style cosmetic channel (lib/decorSkins.js):
      // original art overlaid on the platform chrome. Independent from
      // Themes (tone+accent). null = no decorations. Device-local; tiers
      // are the future hook for volume unlocks + the skin marketplace.
      decorSkin: DEFAULT_DECOR_SKIN,

      // "Apply tone to chart" mark (Appearance studio, Background Tone
      // section). ON by default: picking a skin / tone re-tones the chart
      // background too. An EXPLICIT chart bg (ChartStyleControl) always
      // outranks the theme. Device-local.
      chartFollowsTheme: true,

      // DataTabs view preferences — the table below the chart reads exactly
      // the way the user left it after a refresh (Gleb 2026-07-03): active
      // tab, Age/Date, Amount/%, Price/MCap column modes + the Type filter.
      // (Density lives separately as transactionsDensity.) Device-local.
      dataTabsPrefs: {
        tab: 'transactions',   // 'transactions' | 'holders' | 'analytics' | x-charts id
        dateMode: false,       // false = Age, true = Date
        amountMode: true,      // true = Amount, false = %
        priceMode: false,      // true = Price, false = MCap - MCap by default (Gleb 2026-09-11), matching the chart
        typeFilter: null,      // null = All | 'buy' | 'sell' | 'add' | 'remove'
      },

      // Spectre Agent FAB position - viewport percentages + snapped side,
      // clamped on restore so it never lands off-screen. Device-local
      // (NOT in SYNC_KEYS): a physical-screen preference.
      agentFab: { xPct: 96, yPct: 62, side: 'right' },

      // Mobile token-page FAB position - kept SEPARATE from agentFab so the
      // desktop-dragged percentage never bleeds onto the phone (shared store,
      // very different viewport). Default: inset from the right edge (off the
      // price axis) at mid-chart height, clear of the side rail + trade bar.
      agentFabMobile: { xPct: 86, yPct: 84, side: 'right' },

      // Spectre Agent chat-panel position (free-drag by its header, viewport
      // percentages). null = auto-place near the FAB. Device-local, persisted.
      agentPanel: null,

      // Token-page section layout (Zone Stacks - lib/tokenLayout.js).
      // null = default arrangement. Sanitized on every write AND on read in
      // App.jsx, so corrupt/old blobs always degrade to the default.
      // Device-local (NOT in SYNC_KEYS): a physical-screen preference.
      tokenLayout: null,

      // Jarvis mode - the agent auto-opens on token pages with the opening
      // brief. ON by default (the product IS the greeting); the brief card
      // and settings expose the off switch. Device-local.
      agentBrief: { autoOpen: true },

      // Agent voice - the brief speaks (PR2). enabled null = never asked
      // (first brief shows the one-time opt-in); true/false = user's answer.
      // voice = the launch persona (Chirp3-HD Charon class). wakeWord =
      // "Hey Spectre" hands-free activation (arms only after voice opt-in
      // granted the mic; default on). Device-local.
      agentVoice: { enabled: null, voice: 'charon', wakeWord: true },

      // Sync state (not persisted)
      _syncEnabled: false,
      _syncPaused: false,

      // Actions
      setProfile: (next) =>
        set((s) => {
          const merged = { ...s.profile, ...next }
          // Mirror name to the parent-domain cookie so the research app
          // (different origin) can pick it up without sign-in.
          if (typeof next?.name === 'string' && next.name !== s.profile.name) {
            writeNameCookie(merged.name)
          }
          return { profile: merged }
        }),

      setDayMode: (val) => set({ dayMode: val }),
      toggleDayMode: () => set((s) => ({ dayMode: !s.dayMode })),
      toggleShowMoodWall: () => set((s) => ({ showMoodWall: !s.showMoodWall })),
      toggleTokenColoring: () => set((s) => ({ tokenColoring: !s.tokenColoring })),
      setTokenColoring: (val) => set({ tokenColoring: !!val }),

      // Obsidian & Lime actions
      setReducedMotion: (val) => set({ reducedMotion: !!val }),
      toggleReducedMotion: () => set((s) => ({ reducedMotion: !s.reducedMotion })),
      setDensity: (val) => set({ density: val }),
      setBootComplete: (val) => set({ bootComplete: !!val }),
      setExplorerView: (val) => set({ explorerView: val === 'heatmap' ? 'heatmap' : 'list' }),
      setTransactionsDensity: (val) => set({ transactionsDensity: val === 'compact' ? 'compact' : 'comfortable' }),
      toggleSwapDetails: () => set((s) => ({ showSwapDetails: !s.showSwapDetails })),
      setSwapPrefs: (patch) =>
        set((s) => {
          const merged = { ...s.swapPrefs, ...patch }
          // Slippage: integer bps, 0.01%..5% (server clamps identically).
          const bps = Math.min(Math.max(Math.round(Number(merged.slippageBps) || 100), 1), 500)
          // Quick-buy amounts: up to 4 positive finite numbers.
          let amounts = Array.isArray(merged.quickBuySol)
            ? merged.quickBuySol.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 4)
            : s.swapPrefs.quickBuySol
          if (!amounts.length) amounts = [0.01, 0.05, 0.1, 0.5]
          // Percent presets: 1..100, up to 4 values.
          let pcts = Array.isArray(merged.quickBuyPct)
            ? merged.quickBuyPct.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n <= 100).slice(0, 4)
            : s.swapPrefs.quickBuyPct
          if (!pcts || !pcts.length) pcts = [25, 50, 75, 100]
          const quickMode = merged.quickMode === 'amounts' ? 'amounts' : 'percent'
          return { swapPrefs: { slippageBps: bps, quickBuySol: amounts, quickBuyPct: pcts, quickMode } }
        }),
      setBgTone: (id) => set({ bgTone: isToneId(id) ? id : DEFAULT_TONE }),
      setBgDepth: (val) => set({ bgDepth: clampDepth(val) }),
      setAccentColor: (hex) => set({ accentColor: sanitizeAccent(hex) }),
      setChartStyle: (patch) =>
        set((s) => ({ chartStyle: { ...CHART_STYLE_DEFAULTS, ...s.chartStyle, ...sanitizeChartStyle(patch) } })),
      resetChartStyle: () => set({ chartStyle: { ...CHART_STYLE_DEFAULTS } }),
      setChartFollowsTheme: (val) => set({ chartFollowsTheme: !!val }),
      setDecorSkin: (id) => set({ decorSkin: sanitizeDecorSkin(id) }),
      setDataTabsPrefs: (patch) =>
        set((s) => ({ dataTabsPrefs: { ...s.dataTabsPrefs, ...patch } })),
      pushRecentToken: (token) => set((s) => {
        if (!token?.address) return s
        const filtered = (s.recentTokens || []).filter((t) => t.address !== token.address)
        // Persist logo + last-seen price/change so the Recent section in the
        // CommandPalette renders the real asset, not a letter fallback.
        // i8: also persist marketCap + volume24h + sparkline7d so recent rows
        // are visually rich the next time the palette opens, even before the
        // detail-info enrichment runs. Callers without these fields simply
        // omit them (additive, backwards-compatible).
        const next = [
          {
            address: token.address,
            networkId: token.networkId,
            symbol: token.symbol,
            name: token.name,
            logo: token.logo || '',
            price: typeof token.price === 'number' ? token.price : 0,
            change: typeof token.change === 'number' ? token.change : 0,
            marketCap: typeof token.marketCap === 'number' ? token.marketCap : 0,
            volume24h: typeof token.volume24h === 'number' ? token.volume24h : 0,
            sparkline7d: Array.isArray(token.sparkline7d) ? token.sparkline7d : undefined,
            ts: Date.now(),
          },
          ...filtered,
        ].slice(0, 10)
        return { recentTokens: next }
      }),
      clearRecentTokens: () => set({ recentTokens: [] }),

      /**
       * Called on login - if a different user logged in, reset profile.
       */
      syncProfileToUser: (userId) => {
        const current = get().profile._userId
        if (current && current !== userId) {
          // Different user - reset local profile so we don't leak data
          set({ profile: { name: '', imageUrl: '', _userId: userId } })
        } else if (!current) {
          set((s) => ({ profile: { ...s.profile, _userId: userId } }))
        }
      },

      /**
       * Merge server profile/settings into local state (server wins).
       */
      mergeServerSettings: (serverData) => {
        if (!serverData) return
        set({ _syncPaused: true })

        const updates = {}

        if (serverData.profile) {
          const local = get().profile
          updates.profile = {
            ...local,
            name: serverData.profile.name || local.name,
            imageUrl: serverData.profile.imageUrl || local.imageUrl,
            _userId: serverData.userId || local._userId,
          }
        }

        if (serverData.settings) {
          if (serverData.settings.dayMode !== undefined) {
            updates.dayMode = serverData.settings.dayMode
          }
        }

        set(updates)

        // Unpause after a tick so this merge doesn't trigger a push-back
        setTimeout(() => set({ _syncPaused: false }), 50)
      },

      setAgentFab: (patch) =>
        set((s) => {
          const next = { ...s.agentFab, ...patch }
          // Free placement anywhere on-screen (header, center, edges) - the
          // FAB's own px clamp keeps it fully visible; these are just sane
          // percent bounds so a persisted value never restores off-screen.
          next.xPct = Math.min(Math.max(Number(next.xPct) || 96, 0), 100)
          next.yPct = Math.min(Math.max(Number(next.yPct) || 62, 0), 100)
          next.side = next.side === 'left' ? 'left' : 'right'
          return { agentFab: next }
        }),

      setAgentFabMobile: (patch) =>
        set((s) => {
          const next = { ...s.agentFabMobile, ...patch }
          next.xPct = Math.min(Math.max(Number(next.xPct) || 86, 0), 100)
          next.yPct = Math.min(Math.max(Number(next.yPct) || 44, 0), 100)
          next.side = next.side === 'left' ? 'left' : 'right'
          return { agentFabMobile: next }
        }),

      setAgentBrief: (patch) =>
        set((s) => ({ agentBrief: { ...s.agentBrief, ...patch, autoOpen: patch?.autoOpen !== undefined ? !!patch.autoOpen : s.agentBrief?.autoOpen !== false } })),

      setAgentVoice: (patch) =>
        set((s) => {
          const merged = { ...s.agentVoice, ...patch }
          return {
            agentVoice: {
              enabled: merged.enabled === null ? null : !!merged.enabled,
              voice: typeof merged.voice === 'string' && merged.voice ? merged.voice.slice(0, 24) : 'charon',
              wakeWord: merged.wakeWord !== false,
            },
          }
        }),

      // Panel position + size (free-drag / resize). Pass null to reset to
      // auto-placement near the FAB. Only the provided fields are updated.
      setAgentPanel: (patch) =>
        set((s) => {
          if (patch == null) return { agentPanel: null }
          const next = { ...(s.agentPanel || {}), ...patch }
          if (next.xPct != null) next.xPct = Math.min(Math.max(Number(next.xPct) || 0, 0), 100)
          if (next.yPct != null) next.yPct = Math.min(Math.max(Number(next.yPct) || 0, 0), 100)
          if (next.w != null) next.w = Math.min(Math.max(Number(next.w) || 380, 300), 900)
          if (next.h != null) next.h = Math.min(Math.max(Number(next.h) || 640, 360), 1400)
          return { agentPanel: next }
        }),

      // Token-page layout. Accepts a layout object, an updater fn, or null
      // (reset to default). Always stored sanitized - the sanitizer never
      // throws and hard-falls-back to the default arrangement.
      setTokenLayout: (next) =>
        set((s) => {
          if (next == null) return { tokenLayout: null }
          const resolved = typeof next === 'function' ? next(s.tokenLayout) : next
          return { tokenLayout: resolved == null ? null : sanitizeTokenLayout(resolved) }
        }),
      applyLayoutPreset: (id) =>
        set(() => ({ tokenLayout: id === 'default' || !LAYOUT_PRESETS[id] ? null : sanitizeTokenLayout(LAYOUT_PRESETS[id]) })),
      resetTokenLayout: () => set({ tokenLayout: null }),

      enableSync: () => set({ _syncEnabled: true }),
      disableSync: () => set({ _syncEnabled: false }),
    }),
    {
      name: 'spectre-settings',
      // Writes are BATCHED OFF THE INTERACTION FRAME. Zustand's default
      // storage calls setItem synchronously on every `set`, and partialize
      // below serializes the whole settings object - so a DataTabs tab click
      // (which writes `dataTabsPrefs.tab`) was doing a full JSON.stringify +
      // localStorage write on the click frame, before React could paint the
      // new tab. Same for density, chart prefs, layout, tone. Reads stay
      // synchronous, so hydration on boot is unchanged.
      //
      // Trailing-edge coalesced: rapid changes (dragging a slider, flipping
      // tabs) collapse into one write. Flushed on pagehide/visibilitychange
      // so nothing is lost when the tab closes mid-debounce.
      storage: createJSONStorage(() => batchedLocalStorage),
      version: 2,
      // v1 -> v2 (2026-09-11): the transactions table's Price/MCap column
      // defaults to MCap now. Every existing device carried priceMode:true
      // from the old default, so the persisted value is flipped ONCE here;
      // choices made after this migration persist as before.
      migrate: (persistedState, version) => {
        if (!persistedState) return persistedState
        if (version < 2 && persistedState.dataTabsPrefs) {
          return {
            ...persistedState,
            dataTabsPrefs: { ...persistedState.dataTabsPrefs, priceMode: false },
          }
        }
        return persistedState
      },
      partialize: (state) => ({
        profile: state.profile,
        dayMode: state.dayMode,
        showMoodWall: state.showMoodWall,
        tokenColoring: state.tokenColoring,
        reducedMotion: state.reducedMotion,
        density: state.density,
        recentTokens: state.recentTokens,
        explorerView: state.explorerView,
        transactionsDensity: state.transactionsDensity,
        showSwapDetails: state.showSwapDetails,
        swapPrefs: state.swapPrefs,
        bgTone: state.bgTone,
        bgDepth: state.bgDepth,
        accentColor: state.accentColor,
        chartStyle: state.chartStyle,
        chartFollowsTheme: state.chartFollowsTheme,
        decorSkin: state.decorSkin,
        dataTabsPrefs: state.dataTabsPrefs,
        agentFab: state.agentFab,
        agentFabMobile: state.agentFabMobile,
        agentPanel: state.agentPanel,
        tokenLayout: state.tokenLayout,
        agentBrief: state.agentBrief,
        agentVoice: state.agentVoice,
        // bootComplete intentionally NOT persisted (transient per-session)
      }),
    }
  )
)

// On boot: if the persisted profile has no name but a parent-domain cookie
// does (e.g. user set their name on app.spectreai.io), adopt the cookie name
// so the trading hero greets them by name immediately.
if (typeof window !== 'undefined') {
  const cookieName = readNameCookie()
  if (cookieName) {
    const { profile, setProfile } = useSettingsStore.getState()
    if (!profile?.name) setProfile({ name: cookieName })
  }
}

// Debounced auto-push to server when synced keys change
let _pushTimer = null
let _lastSnapshot = null

// Snapshot covers BOTH name AND imageUrl so a pfp change triggers a push.
// Earlier this dropped imageUrl claiming "too large for debounce" - that
// made profile pictures set on trading invisible from research. The push
// is debounced (1500ms), the data URL is sent once, the server caps it -
// not actually a problem in practice. Research syncs imageUrl the same way.
function _syncSnapshot(state) {
  return JSON.stringify({
    dayMode: state.dayMode,
    profile: { name: state.profile.name, imageUrl: state.profile.imageUrl },
  })
}

/**
 * Adopt the CURRENT state as the sync baseline without pushing it.
 *
 * Call this right after merging server data on login. Without it every boot
 * PUT the profile straight back to the server it had just been read from:
 * `mergeServerSettings` writes the server's values into the store while
 * `_syncEnabled` is still false (so the watcher early-returns and never
 * records a baseline), then `enableSync()` flips the flag, the watcher runs
 * with `_lastSnapshot === null`, and 1500ms later the freshly-fetched profile
 * is written back unchanged. Verified on prod: a `PUT /api/user/profile` on
 * every single page load. A genuine local edit afterwards still pushes.
 */
export function primeSyncBaseline() {
  _lastSnapshot = _syncSnapshot(useSettingsStore.getState())
}

useSettingsStore.subscribe((state) => {
  if (!state._syncEnabled || state._syncPaused) return

  const snapshot = _syncSnapshot(state)
  if (snapshot === _lastSnapshot) return
  _lastSnapshot = snapshot

  clearTimeout(_pushTimer)
  _pushTimer = setTimeout(() => {
    const s = useSettingsStore.getState()
    const profile = { name: s.profile.name, imageUrl: s.profile.imageUrl }
    const settings = { dayMode: s.dayMode }
    pushProfile(profile, settings).catch(() => {})
  }, 1500)
})

export default useSettingsStore
