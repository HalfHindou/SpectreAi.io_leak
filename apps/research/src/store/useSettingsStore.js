import { create } from 'zustand'
import { persist, devtools } from 'zustand/middleware'
import { pushProfile } from '@/services/profileSync'
import { readNameCookie, writeNameCookie } from '@/lib/profileCookie'
import { isScrollTint, DEFAULT_SCROLL_TINT } from '@/constants/scrollTints'

// Kill CSS transitions for the frame the day/night theme flips, so the hundreds
// of `transition: all` elements don't visibly animate dark→light (the ugly
// "dark for a second then white" flash). The `.theme-switching` class on <html>
// sets `transition: none !important` globally; removed after two frames once the
// new-theme paint has landed.
let _themeSwitchRaf = 0
function suppressThemeTransition() {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.classList.add('theme-switching')
  if (_themeSwitchRaf) cancelAnimationFrame(_themeSwitchRaf)
  _themeSwitchRaf = requestAnimationFrame(() => {
    _themeSwitchRaf = requestAnimationFrame(() => {
      el.classList.remove('theme-switching')
      _themeSwitchRaf = 0
    })
  })
}

const DEFAULT_PROFILE = {
  name: '',
  imageUrl: '',
  _userId: '',   // tracks which Privy user owns this profile data
}

const DEFAULT_GAMIFICATION = {
  daysClaimed: 0,
  points: 0,
  spectreTokens: 0,
  streak: 0,
  challengeDaysCompleted: 0,
  claimedDays: [],
}

// GM Dashboard section toggles. Exported so the dashboard can merge these
// under a persisted object that may predate newly added keys.
export const DEFAULT_GM_WIDGETS = {
  crypto: true,
  stocks: true,
  news: true,
  watchlist: true,
  fearGreed: true,
  pulse: true,
  quote: true,
}

// AI Charts Lab kept its starred charts in a raw localStorage key before the
// list moved into the store (to ride the server sync like every other synced
// setting). Seeding the default from that key carries an existing user's stars
// across the upgrade; once the store persists its own copy, the persisted
// value wins over this seed on every later boot.
const seedLegacyAiChartsFavorites = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('spectre-ai-charts-favorites') : null
    const arr = raw ? JSON.parse(raw) : null
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string').slice(0, 200) : []
  } catch { return [] }
}

// Same one-time seed for the AI Charts board layout keys (added tokens, card
// order, renderer style) - they lived as raw localStorage before moving into
// the store to ride the server sync alongside the favorites.
const seedLegacyJson = (key, fallback) => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
    const parsed = raw ? JSON.parse(raw) : null
    return parsed ?? fallback
  } catch { return fallback }
}

// One-time-union bookkeeping for the AI Charts content lists (see
// mergeServerSettings). The flag lives outside the store so a store reset
// can't re-trigger the union and resurrect deleted entries.
const AI_CHARTS_MERGED_FLAG = 'spectre-aicharts-sync-merged-v1'
const aiChartsMergedOnce = () => {
  try { return localStorage.getItem(AI_CHARTS_MERGED_FLAG) === '1' } catch { return true }
}
const markAiChartsMerged = () => {
  try { localStorage.setItem(AI_CHARTS_MERGED_FLAG, '1') } catch { /* storage unavailable */ }
}

// Union the per-mode added-token lists by symbol: server's entries first,
// then this device's additions the server doesn't know about.
const unionAiChartsAdded = (server, local) => {
  const out = {}
  for (const mode of new Set([...Object.keys(server || {}), ...Object.keys(local || {})])) {
    const sv = Array.isArray(server?.[mode]) ? server[mode] : []
    const lv = Array.isArray(local?.[mode]) ? local[mode] : []
    const seen = new Set(sv.map((c) => c?.symbol))
    out[mode] = [...sv, ...lv.filter((c) => c?.symbol && !seen.has(c.symbol))].slice(0, 80)
  }
  return out
}

// The day/night SWITCH's intent, resolved against any active PRO theme.
// Kept as a pure function so `requestDayMode` and `toggleDayMode` cannot drift.
function applyDayModeRequest(s, wantDay) {
  if (s.proThemeLook === 'off') return { dayMode: wantDay }
  // A theme is on, and AppShell force-syncs dayMode to the look — so the look
  // has to move or the switch does nothing. Paper is the light look, Glass the
  // dark one.
  return { proThemeLook: wantDay ? 'paper' : 'glass', dayMode: wantDay }
}

const useSettingsStore = create(
  devtools(
    persist(
      (set) => ({
        // Display
        dayMode: false,
        appDisplayMode: 'terminal',
        marketMode: 'crypto',
        navSidebarCollapsed: false,
        // X Dash leaderboard sections: open by default, collapsible so users can
        // drop straight to the table (persisted). Attention map heatmap, the
        // "What's moving now" cockpit, and the "Social Market Read" thesis panel.
        xdAttentionMapOpen: true,
        xdWhatsMovingOpen: true,
        xdMarketReadOpen: true,
        // Token page Social Scan drawer: closed by default (chart is the primary
        // surface) but the user's last choice persists, so once opened it stays
        // open across token navigations. Primary way to read social for an
        // untracked on-chain token that isn't in the X Dash KOL universe.
        tokenSocialOpen: false,

        // Chart
        // 2026-06-03: default chartType flipped from 'candles' to 'tradingview'.
        // The TradingView toggle now mounts a free iframe (TradingView widget
        // for tokens with Binance pair, DexScreener for any token with an
        // on-chain address). Both are professional charts out of the box with
        // working zoom/pan/timeframes - the custom canvas chart's pan/zoom
        // is admittedly clunky and 1W rendering has gaps. Users who prefer
        // the minimal canvas can still toggle to Candles or Line manually;
        // existing users with a persisted 'candles' setting keep it.
        chartViewMode: 'trading',
        chartTimeframe: '1H',
        chartType: 'tradingview',
        // PHONES GET OUR OWN CHART FIRST.
        // TradingView's library is a 4.4MB download before a phone can draw a
        // single candle; the canvas chart is already on the page. Kept as a
        // SEPARATE preference rather than flipping `chartType`, because the
        // 2026-06-03 note above is still true on desktop — that flip was
        // deliberate, and a phone's constraint is not a laptop's. Toggling the
        // chart type on a phone writes here, so a user who wants TradingView on
        // mobile keeps it without changing anything on desktop.
        chartTypeMobile: 'candles',

        // i18n / currency
        currency: 'USD',
        language: 'en',

        // Profile
        profile: { ...DEFAULT_PROFILE },

        // Header prefs
        tempUnit: 'celsius',
        timeFormat: '12h',

        // Mood walls (sentiment ambient glow on landing page).
        // Default ON to match the trading app and so new beta users get
        // the cinematic ambient glow out of the box.
        showMoodWall: true,
        // Mood wall glow brightness multiplier (0.3 dim -> 2 vivid, 1 = default).
        moodWallBrightness: 1,

        // Token coloring (brand color glow on hover)
        tokenColoring: true,

        // Education & Onboarding (info tooltips)
        infoMode: false,

        // Guided-tour "seen" flags. Button-only tours (no auto-popup): the
        // launch pill pulses once until the user has opened the tour, then the
        // flag stops the pulse. Persisted so the nudge doesn't repeat forever.
        pgTourSeen: false,
        xdTourSeen: false,
        xiTourSeen: false,
        // Global app tour: auto-launches ONCE for a first-time visitor, then
        // this flag stops it from ever auto-popping again (still relaunchable
        // any time from the header "?" button).
        appTourSeen: false,

        // Gamification
        gamification: { ...DEFAULT_GAMIFICATION },

        // Command Center pinned tab (null = default 'brief')
        pinnedCCTab: null,

        // AI Charts Lab starred charts (array of symbols). Server-synced so a
        // star made on one device shows up on the other.
        aiChartsFavorites: seedLegacyAiChartsFavorites(),
        // AI Charts board layout, all server-synced: tokens the user added
        // ({ crypto: [...], stocks: [...] }), the order they dragged the board
        // into (same shape), and the Spectre-renderer chart style.
        aiChartsAdded: (() => {
          const v = seedLegacyJson('spectre-ai-charts-added', {})
          return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
        })(),
        aiChartsOrder: (() => {
          const v = seedLegacyJson('spectre-ai-charts-order', {})
          return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
        })(),
        aiChartsType: (() => {
          const v = seedLegacyJson('spectre-ai-charts-type', 'area')
          return ['area', 'line', 'candle'].includes(v) ? v : 'area'
        })(),

        // Landing (welcome) page section collapse map — { [sectionId]: true }
        // means COLLAPSED. Absent/false = open, so a fresh install lands on the
        // full page and only the sections a user actually closes are stored.
        // Desktop only (the mobile shell has its own layout). Section ids live
        // in WELCOME_SECTIONS in welcome-page.jsx.
        welcomeSectionsCollapsed: {},

        // GM Dashboard sections (see DEFAULT_GM_WIDGETS)
        gmWidgets: { ...DEFAULT_GM_WIDGETS },
        // GM backdrop source. 'theme' follows whatever the app theme is set to
        // (so picking a theme dresses the GM screen too), 'rotate' cycles the
        // theme catalog's photo scenes, 'scene' pins one. 'theme' falls back to
        // rotating when no theme is on, which is what GM always did.
        gmBg: { mode: 'theme', scene: null },

        // Holds the rotation on the photo that's up. Only reachable when a
        // rotation is actually running (>= 2 layers), but persisted so someone
        // who finds the drift distracting doesn't re-pause it every visit.
        gmBgPaused: false,

        // GM Dashboard ambient sound. ON by default so a first-time visitor
        // discovers the track; once they touch the toggle their choice is
        // persisted here (and synced to the account via SYNC_KEYS).
        gmSound: true,

        // Spectre LITE landing look: 'glass' | 'paper'
        liteLook: 'glass',

        // PRO theme studio (localhost test): 'off' | 'glass' | 'paper' look
        // applied to the full PRO app, plus the picked LITE backdrop/canvas.
        proThemeLook: 'off',
        proThemeBg: null,
        proThemePaper: 'pearl',
        // Glass depth: how much backdrop reads through the frost.
        proThemeDepth: 'standard',

        // PRO theme DATA-PLANE opacity: how much backdrop reads through the
        // dense data surfaces (heatmap/treemap grids, x-dash tables, top
        // coins). 'clear' | 'glass' (default) | 'solid'. Separate from
        // proThemeDepth on purpose: the founder wants a dramatic scene AND
        // readable data, which are opposite asks for one slider.
        proDataPlane: 'glass',
        // Soft-focus: blur + dim the backdrop for dense reading.
        proThemeFocus: false,
        // The user's own dayMode before a theme forced it - restored on 'off'.
        proThemePrevDay: false,

        // Spectre LITE Today-page panel visibility (all on by default)
        liteTodayPanels: {},

        // Spectre LITE Today-page panel ORDER (null = default layout order;
        // unknown/new keys are appended by the page's resolver)
        liteTodayOrder: null,

        // Spectre LITE glass background: 'mix' rotates the classics, a scene id
        // locks one look, 'custom' uses the user's uploaded photo (image data
        // lives in its own localStorage key - too big for the settings blob).
        liteBg: { mode: 'mix', scene: null },

        // Spectre LITE paper-look canvas wash id ('pearl' default)
        litePaperBg: 'pearl',

        // Spectre LITE ambience: which source the panel has selected and how
        // loud. Deliberately NO "was playing" flag — a page that starts making
        // noise on load is the thing everyone hates, so playback always begins
        // with a click (which is also what satisfies iOS autoplay).
        liteMusicSource: 'kulfi',
        liteMusicVolume: 0.45,

        // LITE chart mode for the TradingView widgets: 'candles' | 'baseline'.
        // One preference across every chart panel — a reader who wants candles
        // wants them on BTC and ETH and SOL, not per widget.
        liteChartStyle: 'candles',

        // Scrollbar tint id, shared by LITE and PRO. Painted purely by CSS vars
        // (index.css `html[data-sb-tint=…]`); see constants/scrollTints.js.
        // 'default' = warm white, per design-system.md K (colour is opt-in).
        scrollTint: DEFAULT_SCROLL_TINT,

        // Notification preferences (what shows in bell icon + toasts)
        notificationPrefs: {
          breakingNews: true,
          signals: true,
          whales: true,
          convergence: true,
          toastsEnabled: true,
        },

        // Sync state (not persisted)
        _syncEnabled: false,
        _syncPaused: false,

        // ─── Actions ───

        // Raw setter. AppShell's theme sync uses this, so it must never touch
        // the look or the two would drive each other in a loop.
        setDayMode: (val) => { suppressThemeTransition(); set({ dayMode: val }) },

        // What the day/night SWITCH calls. While a PRO theme is on, AppShell
        // continuously syncs dayMode to the look (paper = light, glass = dark)
        // because pages read `s.dayMode` directly — so writing dayMode here was
        // reverted on the very next effect run and the switch read as dead
        // (founder, 08-03: "i cant toggle day night mode due to themes").
        //
        // The look is the only thing that sync respects, so flip THAT: the user
        // lands in the mode they asked for and every rendered combination stays
        // one the theme CSS was actually designed for. Backdrop and paper
        // choices are stored separately, so glass -> paper -> glass round-trips
        // back to their own wallpaper.
        requestDayMode: (val) => {
          suppressThemeTransition()
          set((s) => applyDayModeRequest(s, !!val))
        },
        toggleDayMode: () => {
          suppressThemeTransition()
          set((s) => applyDayModeRequest(s, !s.dayMode))
        },

        setAppDisplayMode: (mode) => set({ appDisplayMode: mode }),

        setMarketMode: (mode) => set({ marketMode: mode }),

        setNavSidebarCollapsed: (val) => set({ navSidebarCollapsed: val }),
        toggleNavSidebarCollapsed: () =>
          set((s) => ({ navSidebarCollapsed: !s.navSidebarCollapsed })),

        setXdAttentionMapOpen: (val) => set({ xdAttentionMapOpen: val }),
        toggleXdAttentionMap: () =>
          set((s) => ({ xdAttentionMapOpen: !s.xdAttentionMapOpen })),
        toggleXdWhatsMoving: () =>
          set((s) => ({ xdWhatsMovingOpen: !s.xdWhatsMovingOpen })),
        toggleXdMarketRead: () =>
          set((s) => ({ xdMarketReadOpen: !s.xdMarketReadOpen })),

        setTokenSocialOpen: (val) => set({ tokenSocialOpen: val }),
        toggleTokenSocial: () =>
          set((s) => ({ tokenSocialOpen: !s.tokenSocialOpen })),

        setShowMoodWall: (val) => set({ showMoodWall: val }),
        toggleShowMoodWall: () => set((s) => ({ showMoodWall: !s.showMoodWall })),
        setMoodWallBrightness: (val) => set({ moodWallBrightness: Math.max(0.3, Math.min(2, Number(val) || 1)) }),

        setTokenColoring: (val) => set({ tokenColoring: val }),
        toggleTokenColoring: () => set((s) => ({ tokenColoring: !s.tokenColoring })),

        setInfoMode: (val) => set({ infoMode: val }),
        toggleInfoMode: () => set((s) => ({ infoMode: !s.infoMode })),

        setPgTourSeen: (val) => set({ pgTourSeen: val }),
        setXdTourSeen: (val) => set({ xdTourSeen: val }),
        setXiTourSeen: (val) => set({ xiTourSeen: val }),
        setAppTourSeen: (val) => set({ appTourSeen: val }),

        setNotificationPrefs: (prefs) => set((s) => ({
          notificationPrefs: { ...s.notificationPrefs, ...prefs },
        })),

        setChartViewMode: (mode) => set({ chartViewMode: mode }),
        setChartTimeframe: (tf) => set({ chartTimeframe: tf }),
        setChartType: (type) => set({ chartType: type }),
        setChartTypeMobile: (type) => set({ chartTypeMobile: type }),

        setCurrency: (code) => set({ currency: code }),
        setLanguage: (lang) => set({ language: lang }),

        setProfile: (next) =>
          set((s) => {
            const newName = typeof next?.name === 'string' ? next.name : (s.profile?.name ?? DEFAULT_PROFILE.name)
            if (typeof next?.name === 'string' && next.name !== s.profile?.name) {
              // Mirror name to the parent-domain cookie so trade.spectreai.io
              // can greet by the same name without sign-in.
              writeNameCookie(newName)
            }
            return {
              profile: {
                name: newName,
                imageUrl: typeof next?.imageUrl === 'string' ? next.imageUrl : (s.profile?.imageUrl ?? DEFAULT_PROFILE.imageUrl),
                _userId: next?._userId || s.profile?._userId || '',
              },
            }
          }),

        // Reset profile when a different Privy user logs in
        syncProfileToUser: (userId) =>
          set((s) => {
            if (!userId) return {}
            if (s.profile?._userId === userId) return {} // same user - no change
            // Different user - clear local overrides so Privy data shows through
            return { profile: { ...DEFAULT_PROFILE, _userId: userId } }
          }),

        setTempUnit: (unit) => set({ tempUnit: unit }),
        toggleTempUnit: () =>
          set((s) => ({ tempUnit: s.tempUnit === 'celsius' ? 'fahrenheit' : 'celsius' })),

        setTimeFormat: (fmt) => set({ timeFormat: fmt }),
        toggleTimeFormat: () =>
          set((s) => ({ timeFormat: s.timeFormat === '12h' ? '24h' : '12h' })),

        setGamification: (val) =>
          set((s) => ({
            gamification: typeof val === 'function' ? val(s.gamification) : val,
          })),

        setPinnedCCTab: (tabId) => set({ pinnedCCTab: tabId }),

        setAiChartsFavorites: (favs) =>
          set({ aiChartsFavorites: Array.isArray(favs) ? favs.slice(0, 200) : [] }),

        setAiChartsAdded: (added) =>
          set({ aiChartsAdded: added && typeof added === 'object' && !Array.isArray(added) ? added : {} }),

        setAiChartsOrder: (order) =>
          set({ aiChartsOrder: order && typeof order === 'object' && !Array.isArray(order) ? order : {} }),

        setAiChartsType: (type) =>
          set({ aiChartsType: ['area', 'line', 'candle'].includes(type) ? type : 'area' }),

        setWelcomeSectionCollapsed: (id, collapsed) =>
          set((s) => ({
            welcomeSectionsCollapsed: { ...s.welcomeSectionsCollapsed, [id]: !!collapsed },
          })),
        toggleWelcomeSection: (id) =>
          set((s) => ({
            welcomeSectionsCollapsed: {
              ...s.welcomeSectionsCollapsed,
              [id]: !s.welcomeSectionsCollapsed?.[id],
            },
          })),

        setGmWidget: (key, val) =>
          set((s) => ({ gmWidgets: { ...DEFAULT_GM_WIDGETS, ...s.gmWidgets, [key]: val } })),

        setGmSound: (val) => set({ gmSound: !!val }),
        setGmBg: (bg) => set({ gmBg: bg && bg.mode ? { mode: bg.mode, scene: bg.scene || null } : { mode: 'theme', scene: null } }),
        setGmBgPaused: (val) => set({ gmBgPaused: !!val }),

        setLiteLook: (look) => set({ liteLook: look === 'paper' ? 'paper' : 'glass' }),

        setProThemeLook: (look) =>
          set((s) => {
            const next = ['glass', 'paper'].includes(look) ? look : 'off'
            const out = { proThemeLook: next }
            // Themes force dayMode app-wide (pages read s.dayMode directly), so
            // stash the user's own preference on the way in and restore it on
            // the way out - otherwise "back to Spectre" strands the app in the
            // forced mode (founder-reported bug).
            if (s.proThemeLook === 'off' && next !== 'off') out.proThemePrevDay = !!s.dayMode
            if (s.proThemeLook !== 'off' && next === 'off') out.dayMode = !!s.proThemePrevDay
            return out
          }),
        setProThemeBg: (bg) => set({ proThemeBg: bg || null }),
        setProThemePaper: (id) => set({ proThemePaper: id || 'pearl' }),
        setProDataPlane: (p) =>
          set({ proDataPlane: ['clear', 'glass', 'solid'].includes(p) ? p : 'glass' }),

        setProThemeDepth: (d) =>
          set({ proThemeDepth: ['clear', 'deep'].includes(d) ? d : 'standard' }),
        setProThemeFocus: (v) => set({ proThemeFocus: !!v }),

        setLiteTodayPanel: (key, val) =>
          set((s) => ({ liteTodayPanels: { ...s.liteTodayPanels, [key]: val } })),

        setLiteTodayOrder: (order) =>
          set({ liteTodayOrder: Array.isArray(order) ? order : null }),

        setLiteBg: (bg) => set({ liteBg: { mode: bg?.mode || 'mix', scene: bg?.scene || null } }),

        setLitePaperBg: (id) => set({ litePaperBg: typeof id === 'string' && id ? id : 'pearl' }),

        setLiteChartStyle: (k) => set({ liteChartStyle: k === 'baseline' ? 'baseline' : 'candles' }),
        setLiteMusicSource: (id) => set({ liteMusicSource: typeof id === 'string' && id ? id : 'kulfi' }),
        setLiteMusicVolume: (v) =>
          set({ liteMusicVolume: Math.min(1, Math.max(0, Number(v) || 0)) }),

        setScrollTint: (id) => set({ scrollTint: isScrollTint(id) ? id : DEFAULT_SCROLL_TINT }),

        // Enable server sync (call after Privy login)
        enableSync: () => set({ _syncEnabled: true }),
        disableSync: () => set({ _syncEnabled: false }),

        // Fetch profile from server and merge into local state
        syncFromServer: async () => {
          try {
            const { fetchProfile } = await import('@/services/profileSync')
            const serverData = await fetchProfile()
            if (serverData?.updatedAt) {
              useSettingsStore.getState().mergeServerSettings(serverData)
            }
            return true
          } catch {
            return false
          }
        },

        // Merge settings from server (on login). Pauses sync to avoid echo.
        // Currency + language are intentionally excluded: their source of truth
        // is the local session (the picker writes Zustand + localStorage), and
        // a stale server fetch racing the user's click would snap their pick
        // back to the server's value — the classic "I pressed EUR/RU and it
        // bounced to USD/EN" bug. Cross-device sync of those two is sacrificed
        // for input-stickiness; everything else (theme, chart prefs, etc.) still
        // restores from server.
        mergeServerSettings: (serverData) =>
          set((s) => {
            const merged = { _syncPaused: true }
            const { profile, settings } = serverData || {}
            if (profile?.name) merged.profile = { ...s.profile, ...profile }
            if (settings && typeof settings === 'object') {
              for (const key of Object.keys(settings)) {
                if (key === 'currency' || key === 'language') continue
                // marketMode is input-sticky for the same reason as currency/
                // language: the merge lands seconds AFTER first paint (Privy
                // hydrates lazily), so a stale server value visibly snapped
                // the landing page from crypto to stocks mid-view — and when
                // the user's flip back failed to reach the server (expired
                // token, killed debounce), every boot repeated it. The mode
                // is a navigation choice for THIS session; it stays local.
                if (key === 'marketMode') continue
                if (settings[key] === undefined) continue
                // Shape guards: a malformed server value must not replace a
                // list/map the consumers destructure (.includes / spread).
                if (key === 'aiChartsFavorites' && !Array.isArray(settings[key])) continue
                if ((key === 'aiChartsAdded' || key === 'aiChartsOrder') &&
                  (typeof settings[key] !== 'object' || settings[key] === null || Array.isArray(settings[key]))) continue
                // First-ever merge of the AI Charts content lists on this
                // device: UNION with the server copy instead of server-wins.
                // Two devices that both starred/added charts before sync
                // existed would otherwise have the later one's list clobbered
                // by whichever pushed first. After this one convergence the
                // flag flips and normal server-wins (deletions stick) applies.
                if (key === 'aiChartsFavorites' && !aiChartsMergedOnce()) {
                  merged[key] = [...new Set([...settings[key], ...s.aiChartsFavorites])].slice(0, 200)
                  continue
                }
                if (key === 'aiChartsAdded' && !aiChartsMergedOnce()) {
                  merged[key] = unionAiChartsAdded(settings[key], s.aiChartsAdded)
                  continue
                }
                merged[key] = settings[key]
              }
            }
            // The merge writes dayMode outside the setters, so it must invoke
            // the same transition kill they do — otherwise a server dayMode
            // that differs from local animates the full dark↔light flip
            // through every `transition: all` element (the documented flash).
            if ((merged.dayMode !== undefined && merged.dayMode !== s.dayMode) ||
                (merged.proThemeLook !== undefined && merged.proThemeLook !== s.proThemeLook) ||
                (merged.proThemeBg !== undefined && merged.proThemeBg !== s.proThemeBg)) {
              suppressThemeTransition()
            }
            // The one-time union above ran (or wasn't needed) - from now on
            // the AI Charts lists follow plain server-wins like every setting.
            markAiChartsMerged()
            // Unpause after a tick so the merge itself doesn't trigger a push
            setTimeout(() => useSettingsStore.setState({ _syncPaused: false }), 50)
            return merged
          }),
      }),
      {
        name: 'spectre-settings',
        // v2 (2026-05-28): flip showMoodWall default from false -> true so
        // beta users land on the ambient sentiment glow. Migration force-
        // enables it once on existing installs; users who don't like it can
        // re-toggle off and the new value persists normally.
        // v3 (2026-07-31): landing-page section collapse moved out of two raw
        // localStorage keys into the persisted `welcomeSectionsCollapsed` map.
        // The migration carries the user's existing choice across once so an
        // upgrade never reopens a section they had closed.
        version: 3,
        migrate: (persisted, prevVersion) => {
          if (!persisted || typeof persisted !== 'object') return persisted
          let next = persisted
          if (prevVersion < 2) {
            next = { ...next, showMoodWall: true }
          }
          if (prevVersion < 3) {
            const seeded = { ...(next.welcomeSectionsCollapsed || {}) }
            try {
              if (localStorage.getItem('spectre-welcome-bar-open') === 'false') {
                seeded.marketBar = true
              }
              const bottomRow = localStorage.getItem('spectre-bottom-row-open')
                ?? localStorage.getItem('spectre-command-center-open')
                ?? localStorage.getItem('spectre-watchlist-open')
              if (bottomRow === 'false') seeded.commandCenter = true
            } catch { /* storage unavailable */ }
            next = { ...next, welcomeSectionsCollapsed: seeded }
          }
          return next
        },
        partialize: (state) => ({
          dayMode: state.dayMode,
          appDisplayMode: state.appDisplayMode,
          marketMode: state.marketMode,
          navSidebarCollapsed: state.navSidebarCollapsed,
          xdAttentionMapOpen: state.xdAttentionMapOpen,
          xdWhatsMovingOpen: state.xdWhatsMovingOpen,
          xdMarketReadOpen: state.xdMarketReadOpen,
          tokenSocialOpen: state.tokenSocialOpen,
          showMoodWall: state.showMoodWall,
          moodWallBrightness: state.moodWallBrightness,
          notificationPrefs: state.notificationPrefs,
          tokenColoring: state.tokenColoring,
          infoMode: state.infoMode,
          pgTourSeen: state.pgTourSeen,
          xdTourSeen: state.xdTourSeen,
          xiTourSeen: state.xiTourSeen,
          appTourSeen: state.appTourSeen,
          chartViewMode: state.chartViewMode,
          chartTimeframe: state.chartTimeframe,
          chartType: state.chartType,
          chartTypeMobile: state.chartTypeMobile,
          currency: state.currency,
          language: state.language,
          profile: state.profile,
          tempUnit: state.tempUnit,
          timeFormat: state.timeFormat,
          gamification: state.gamification,
          pinnedCCTab: state.pinnedCCTab,
          aiChartsFavorites: state.aiChartsFavorites,
          aiChartsAdded: state.aiChartsAdded,
          aiChartsOrder: state.aiChartsOrder,
          aiChartsType: state.aiChartsType,
          welcomeSectionsCollapsed: state.welcomeSectionsCollapsed,
          gmWidgets: state.gmWidgets,
          gmSound: state.gmSound,
          gmBg: state.gmBg,
          gmBgPaused: state.gmBgPaused,
          liteLook: state.liteLook,
          proThemeLook: state.proThemeLook,
          proThemeBg: state.proThemeBg,
          proThemePaper: state.proThemePaper,
          proThemeDepth: state.proThemeDepth,
          proDataPlane: state.proDataPlane,
          proThemeFocus: state.proThemeFocus,
          proThemePrevDay: state.proThemePrevDay,
          liteTodayPanels: state.liteTodayPanels,
          liteTodayOrder: state.liteTodayOrder,
          liteBg: state.liteBg,
          litePaperBg: state.litePaperBg,
          liteChartStyle: state.liteChartStyle,
          liteMusicSource: state.liteMusicSource,
          liteMusicVolume: state.liteMusicVolume,
          scrollTint: state.scrollTint,
        }),
      }
    ),
    { name: 'SettingsStore' }
  )
)

// On boot: if local profile has no name but the parent-domain cookie does
// (e.g. user set their name on trade.spectreai.io), adopt it so the GM
// dashboard / cinema bar greet them by name immediately.
if (typeof window !== 'undefined') {
  const cookieName = readNameCookie()
  if (cookieName) {
    const { profile, setProfile } = useSettingsStore.getState()
    if (!profile?.name) setProfile({ name: cookieName })
  }
}

// Sync keys to push to server (subset of partialize keys).
// Every key here MUST also be in ALLOWED_SETTINGS on BOTH servers
// (packages/server/routes/users.js + apps/research/api/_lib/handlers/user.js)
// or the server silently drops it and the setting never syncs.
const SYNC_KEYS = [
  'dayMode', 'appDisplayMode', 'marketMode', 'navSidebarCollapsed',
  'chartViewMode', 'chartTimeframe', 'chartType', 'chartTypeMobile',
  'currency', 'language', 'tempUnit', 'timeFormat',
  'showMoodWall', 'moodWallBrightness', 'tokenColoring', 'infoMode',
  'pinnedCCTab', 'gmWidgets', 'gmSound', 'gmBg', 'gmBgPaused', 'welcomeSectionsCollapsed',
  'aiChartsFavorites', 'aiChartsAdded', 'aiChartsOrder', 'aiChartsType',
  // Appearance: PRO theme studio + Lite look. The custom-wallpaper blobs
  // (spectre-pro-bg-url-v1 / spectre-lite-custom-bg) intentionally stay
  // local - base64 wallpapers are too heavy for the profile record.
  'proThemeLook', 'proThemeBg', 'proThemePaper', 'proThemeDepth',
  'proDataPlane', 'proThemeFocus', 'proThemePrevDay',
  'liteLook', 'liteTodayPanels', 'liteTodayOrder', 'liteBg', 'litePaperBg',
  'liteChartStyle', 'liteMusicSource', 'liteMusicVolume',
  'scrollTint',
]

// Debounced push to server on settings change
let _syncTimer = null
useSettingsStore.subscribe((state, prevState) => {
  if (!state._syncEnabled || state._syncPaused) return

  // Only sync if a SYNC_KEY actually changed
  const changed = SYNC_KEYS.some((k) => state[k] !== prevState[k])
  const profileChanged = state.profile?.name !== prevState.profile?.name ||
    state.profile?.imageUrl !== prevState.profile?.imageUrl
  if (!changed && !profileChanged) return

  clearTimeout(_syncTimer)
  _syncTimer = setTimeout(() => {
    _syncTimer = null
    const s = useSettingsStore.getState()
    const settings = {}
    for (const k of SYNC_KEYS) settings[k] = s[k]
    pushProfile(s.profile, settings).catch(() => {})
  }, 1500)
})

// Flush a pending settings change when the page is hidden or closed — mirrors
// the watchlists flush (WatchlistsContext). Without this, locking the phone or
// app-switching inside the 1500ms debounce kills the timer, the server keeps
// the old value, and the next boot's merge re-applies it: the "my setting
// keeps coming back" loop. visibilitychange(hidden) is the event iOS actually
// fires on lock/app-switch; pagehide covers navigation away. The _syncTimer
// null check makes the pair idempotent — only a genuinely pending push flushes.
if (typeof window !== 'undefined') {
  const flushPendingSettingsPush = () => {
    if (!_syncTimer) return
    const s = useSettingsStore.getState()
    if (!s._syncEnabled || s._syncPaused) return
    clearTimeout(_syncTimer)
    _syncTimer = null
    const settings = {}
    for (const k of SYNC_KEYS) settings[k] = s[k]
    pushProfile(s.profile, settings, { keepalive: true }).catch(() => {})
  }
  window.addEventListener('pagehide', flushPendingSettingsPush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSettingsPush()
  })
}

export default useSettingsStore
