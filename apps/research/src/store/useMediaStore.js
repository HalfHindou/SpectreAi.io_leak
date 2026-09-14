import { create } from 'zustand'
import { persist, devtools } from 'zustand/middleware'

/**
 * Media Center Zustand store
 * Manages: saved items, recently watched, playlists, queue, playback state,
 *          per-tab API data, and pagination
 */

const MAX_HISTORY = 30

/* ── One-time migration from old localStorage key ── */
function migrateOldSaved() {
  try {
    const old = localStorage.getItem('spectre-media-saved')
    if (old) {
      const items = JSON.parse(old)
      localStorage.removeItem('spectre-media-saved')
      return Array.isArray(items) ? items : []
    }
  } catch { /* ignore */ }
  return null
}

const useMediaStore = create(
  devtools(
    persist(
      (set, get) => ({
        /* ── Persisted State ───────────────────── */
        savedItems: [],
        recentlyWatched: [],
        playlists: [],
        queue: [],
        queueIndex: 0,
        autoPlay: true,

        /* ── Podcast player (persisted half) ───── */
        /* Resume positions keyed by episode id — "continue where you left off"
           across sessions. Capped so the persisted blob can't grow forever. */
        podcastResume: {},
        podcastRate: 1,
        podcastVolume: 1,
        podcastCaptionsOn: true,
        podcastQueue: [],
        podcastQueueIndex: 0,

        /* ── Transient State (not persisted) ───── */
        activeVideo: null,
        isPlaying: false,
        theaterOpen: false,
        miniPlayerOpen: false,
        queueDrawerOpen: false,
        spotifyShow: null,
        spotifyFullscreen: false,
        spotifyLatest: {},

        /* The episode the global <audio> element is bound to. Deliberately NOT
           persisted: a reload should not auto-start sound. Playback POSITION is
           persisted (podcastResume), so resuming is one tap. */
        podcastEpisode: null,
        podcastPlaying: false,
        podcastImmersive: false,
        /* Current time lives in the player component, not here — a store write
           4x/second would re-render every subscriber in the app for nothing. */

        /* ── Per-Tab API State (not persisted) ─── */
        /* Discover is a structured editorial payload, not a flat list */
        discoverData: null,
        discoverLoading: false,
        discoverError: null,
        discoverLastRefreshed: null,

        forYouItems: [],
        forYouLoading: false,
        forYouError: null,
        forYouLastRefreshed: null,

        podcastsItems: [],
        podcastsLoading: false,
        podcastsError: null,
        podcastsLastRefreshed: null,

        videosItems: [],
        videosLoading: false,
        videosError: null,
        videosLastRefreshed: null,

        shortsItems: [],
        shortsLoading: false,
        shortsError: null,
        shortsLastRefreshed: null,

        liveItems: [],
        liveLoading: false,
        liveError: null,
        liveLastRefreshed: null,

        channelsItems: [],
        channelsLoading: false,
        channelsError: null,
        channelsLastRefreshed: null,

        /* ── Pagination State (not persisted) ──── */
        pagination: {
          videos: { nextPage: null, hasMore: true },
          shorts: { nextPage: null, hasMore: true },
        },

        /* ── Playback ──────────────────────────── */

        playVideo: (video) => {
          const { recentlyWatched, queue } = get()
          const filtered = recentlyWatched.filter(v => v.id !== video.id)
          const history = [{ ...video, watchedAt: Date.now() }, ...filtered].slice(0, MAX_HISTORY)
          const newQueue = queue.length === 0 ? [video] : queue
          const idx = queue.length === 0 ? 0 : get().queueIndex
          set({
            activeVideo: video,
            isPlaying: true,
            theaterOpen: true,
            miniPlayerOpen: false,
            recentlyWatched: history,
            queue: newQueue,
            queueIndex: idx,
            // A podcast keeps playing app-wide, so starting a video has to
            // pause it or the two talk over each other.
            podcastPlaying: false,
            podcastImmersive: false,
          })
        },

        stopVideo: () => set({
          activeVideo: null,
          isPlaying: false,
          theaterOpen: false,
          miniPlayerOpen: false,
        }),

        openTheater: () => set({ theaterOpen: true, miniPlayerOpen: false }),

        closeTheater: () => {
          const { isPlaying } = get()
          set({
            theaterOpen: false,
            miniPlayerOpen: isPlaying,
          })
        },

        closeMiniPlayer: () => set({
          miniPlayerOpen: false,
          activeVideo: null,
          isPlaying: false,
        }),

        /* ── Recently Watched ──────────────────── */

        addToRecentlyWatched: (video) => set(s => {
          const filtered = s.recentlyWatched.filter(v => v.id !== video.id)
          return { recentlyWatched: [{ ...video, watchedAt: Date.now() }, ...filtered].slice(0, MAX_HISTORY) }
        }),

        clearRecentlyWatched: () => set({ recentlyWatched: [] }),

        /* ── Saved Items ───────────────────────── */

        toggleSave: (item) => set(s => {
          const exists = s.savedItems.find(v => v.id === item.id)
          if (exists) return { savedItems: s.savedItems.filter(v => v.id !== item.id) }
          return { savedItems: [...s.savedItems, { ...item, savedAt: Date.now() }] }
        }),

        clearSaved: () => set({ savedItems: [] }),

        /* ── Queue ─────────────────────────────── */

        addToQueue: (video) => set(s => {
          if (s.queue.some(v => v.id === video.id)) return s
          const newQueue = [...s.queue, video]
          if (!s.activeVideo) {
            const history = s.recentlyWatched.filter(v => v.id !== video.id)
            return {
              queue: newQueue,
              queueIndex: newQueue.length - 1,
              activeVideo: video,
              isPlaying: true,
              theaterOpen: true,
              recentlyWatched: [{ ...video, watchedAt: Date.now() }, ...history].slice(0, MAX_HISTORY),
            }
          }
          return { queue: newQueue }
        }),

        removeFromQueue: (index) => set(s => {
          const newQueue = s.queue.filter((_, i) => i !== index)
          let newIndex = s.queueIndex
          if (index < s.queueIndex) newIndex = Math.max(0, newIndex - 1)
          if (index === s.queueIndex && newIndex >= newQueue.length) newIndex = Math.max(0, newQueue.length - 1)
          return { queue: newQueue, queueIndex: newIndex }
        }),

        clearQueue: () => set({ queue: [], queueIndex: 0 }),

        reorderQueue: (fromIndex, toIndex) => set(s => {
          const newQueue = [...s.queue]
          const [moved] = newQueue.splice(fromIndex, 1)
          newQueue.splice(toIndex, 0, moved)
          let newIndex = s.queueIndex
          if (s.queueIndex === fromIndex) newIndex = toIndex
          else if (fromIndex < s.queueIndex && toIndex >= s.queueIndex) newIndex--
          else if (fromIndex > s.queueIndex && toIndex <= s.queueIndex) newIndex++
          return { queue: newQueue, queueIndex: newIndex }
        }),

        playNext: () => {
          const { queue, queueIndex, autoPlay } = get()
          const nextIndex = queueIndex + 1
          if (nextIndex < queue.length && autoPlay) {
            const video = queue[nextIndex]
            const history = get().recentlyWatched.filter(v => v.id !== video.id)
            set({
              queueIndex: nextIndex,
              activeVideo: video,
              isPlaying: true,
              recentlyWatched: [{ ...video, watchedAt: Date.now() }, ...history].slice(0, MAX_HISTORY),
            })
          } else {
            set({ isPlaying: false })
          }
        },

        playPrevious: () => {
          const { queue, queueIndex } = get()
          const prevIndex = queueIndex - 1
          if (prevIndex >= 0) {
            const video = queue[prevIndex]
            set({ queueIndex: prevIndex, activeVideo: video, isPlaying: true })
          }
        },

        playFromQueue: (index) => {
          const { queue } = get()
          if (index >= 0 && index < queue.length) {
            const video = queue[index]
            const history = get().recentlyWatched.filter(v => v.id !== video.id)
            set({
              queueIndex: index,
              activeVideo: video,
              isPlaying: true,
              theaterOpen: true,
              recentlyWatched: [{ ...video, watchedAt: Date.now() }, ...history].slice(0, MAX_HISTORY),
            })
          }
        },

        setAutoPlay: (val) => set({ autoPlay: val }),

        toggleQueueDrawer: () => set(s => ({ queueDrawerOpen: !s.queueDrawerOpen })),

        /* ── Spotify floater ───────────────────── */
        openSpotify: (show) => set({
          spotifyShow: show,
          spotifyFullscreen: false,
          // Two audio sources must never run together.
          podcastPlaying: false,
          podcastImmersive: false,
        }),
        closeSpotify: () => set({ spotifyShow: null, spotifyFullscreen: false }),
        openSpotifyFullscreen: () => set(s => (s.spotifyShow ? { spotifyFullscreen: true } : s)),
        closeSpotifyFullscreen: () => set({ spotifyFullscreen: false }),
        setSpotifyLatest: (map) => set({ spotifyLatest: map || {} }),

        /* ── Podcast player ────────────────────── */

        /* Play an episode. `list` (optional) becomes the up-next queue, so
           clicking the 4th card in a rail queues the rest of that rail. */
        /* `immersive:false` starts playback in the DOCKED bar instead of taking
           over the screen. The Media Center is a listening surface, so a play
           there opens the full player; the Command Center is a dashboard the
           user is working in, and hijacking it to full-screen is the opposite
           of "put a podcast on and carry on". */
        playPodcast: (episode, list, opts) => {
          if (!episode?.audioUrl) return
          const queue = Array.isArray(list) && list.length
            ? list.filter(e => e?.audioUrl)
            : [episode]
          const idx = Math.max(0, queue.findIndex(e => e.id === episode.id))
          set({
            podcastEpisode: episode,
            podcastPlaying: true,
            podcastImmersive: opts?.immersive !== false,
            podcastQueue: queue,
            podcastQueueIndex: idx,
            // Audio and video must never play over each other.
            theaterOpen: false,
            miniPlayerOpen: false,
            isPlaying: false,
            spotifyShow: null,
          })
        },

        togglePodcastPlay: () => set(s => (s.podcastEpisode ? { podcastPlaying: !s.podcastPlaying } : s)),
        setPodcastPlaying: (v) => set({ podcastPlaying: !!v }),

        openPodcastImmersive: () => set(s => (s.podcastEpisode ? { podcastImmersive: true } : s)),
        closePodcastImmersive: () => set({ podcastImmersive: false }),

        /* Full stop — clears the episode so the <audio> element unmounts. */
        stopPodcast: () => set({ podcastEpisode: null, podcastPlaying: false, podcastImmersive: false }),

        /* Position memory. Called on pause / episode change / unload and on a
           slow timer while playing — never per timeupdate tick. */
        savePodcastPosition: (id, seconds, duration) => set(s => {
          if (!id || !Number.isFinite(seconds)) return s
          const next = { ...s.podcastResume }
          // Finished (or as good as) — drop the marker so the card reads clean.
          if (duration && seconds >= duration - 25) delete next[id]
          else if (seconds < 15) delete next[id]
          else next[id] = { t: Math.round(seconds), d: Math.round(duration || 0), at: Date.now() }
          const keys = Object.keys(next)
          if (keys.length > 80) {
            keys.sort((a, b) => (next[a].at || 0) - (next[b].at || 0))
            for (const k of keys.slice(0, keys.length - 80)) delete next[k]
          }
          return { podcastResume: next }
        }),

        setPodcastRate: (rate) => set({ podcastRate: rate }),
        setPodcastVolume: (v) => set({ podcastVolume: v }),
        togglePodcastCaptions: () => set(s => ({ podcastCaptionsOn: !s.podcastCaptionsOn })),

        podcastNext: () => {
          const { podcastQueue, podcastQueueIndex } = get()
          const next = podcastQueue[podcastQueueIndex + 1]
          if (!next) { set({ podcastPlaying: false }); return }
          set({ podcastQueueIndex: podcastQueueIndex + 1, podcastEpisode: next, podcastPlaying: true })
        },

        podcastPrev: () => {
          const { podcastQueue, podcastQueueIndex } = get()
          const prev = podcastQueue[podcastQueueIndex - 1]
          if (!prev) return
          set({ podcastQueueIndex: podcastQueueIndex - 1, podcastEpisode: prev, podcastPlaying: true })
        },

        /* Queue an episode without interrupting what is playing. */
        enqueuePodcast: (episode) => set(s => {
          if (!episode?.audioUrl || s.podcastQueue.some(e => e.id === episode.id)) return s
          if (!s.podcastEpisode) {
            return {
              podcastQueue: [episode],
              podcastQueueIndex: 0,
              podcastEpisode: episode,
              podcastPlaying: true,
            }
          }
          return { podcastQueue: [...s.podcastQueue, episode] }
        }),

        removeFromPodcastQueue: (id) => set(s => {
          const idx = s.podcastQueue.findIndex(e => e.id === id)
          if (idx === -1 || idx === s.podcastQueueIndex) return s
          return {
            podcastQueue: s.podcastQueue.filter(e => e.id !== id),
            podcastQueueIndex: idx < s.podcastQueueIndex ? s.podcastQueueIndex - 1 : s.podcastQueueIndex,
          }
        }),

        /* ── Playlists ─────────────────────────── */

        createPlaylist: (name) => set(s => ({
          playlists: [...s.playlists, {
            id: `pl-${Date.now()}`,
            name: name || 'New Playlist',
            videos: [],
            createdAt: Date.now(),
          }],
        })),

        deletePlaylist: (id) => set(s => ({
          playlists: s.playlists.filter(p => p.id !== id),
        })),

        renamePlaylist: (id, name) => set(s => ({
          playlists: s.playlists.map(p => p.id === id ? { ...p, name } : p),
        })),

        addToPlaylist: (playlistId, video) => set(s => ({
          playlists: s.playlists.map(p => {
            if (p.id !== playlistId) return p
            if (p.videos.some(v => v.id === video.id)) return p
            return { ...p, videos: [...p.videos, video] }
          }),
        })),

        removeFromPlaylist: (playlistId, videoId) => set(s => ({
          playlists: s.playlists.map(p => {
            if (p.id !== playlistId) return p
            return { ...p, videos: p.videos.filter(v => v.id !== videoId) }
          }),
        })),

        playPlaylist: (playlistId) => {
          const { playlists } = get()
          const playlist = playlists.find(p => p.id === playlistId)
          if (!playlist || playlist.videos.length === 0) return
          const video = playlist.videos[0]
          const history = get().recentlyWatched.filter(v => v.id !== video.id)
          set({
            queue: [...playlist.videos],
            queueIndex: 0,
            activeVideo: video,
            isPlaying: true,
            theaterOpen: true,
            recentlyWatched: [{ ...video, watchedAt: Date.now() }, ...history].slice(0, MAX_HISTORY),
          })
        },

        /* ── Tab Data Actions ──────────────────── */

        setTabData: (tab, { items, meta }) => set(s => ({
          [`${tab}Items`]: items,
          [`${tab}Loading`]: false,
          [`${tab}Error`]: null,
          [`${tab}LastRefreshed`]: meta?.lastRefreshed || new Date().toISOString(),
          ...(meta?.nextPage !== undefined ? {
            pagination: {
              ...s.pagination,
              [tab]: { nextPage: meta.nextPage, hasMore: !!meta.nextPage },
            },
          } : {}),
        })),

        appendTabPage: (tab, { items, meta }) => set(s => {
          const existing = s[`${tab}Items`] || []
          const existingIds = new Set(existing.map(v => v.id))
          const newItems = items.filter(v => !existingIds.has(v.id))
          const hasMore = newItems.length > 0 && !!meta?.nextPage
          return {
            [`${tab}Items`]: [...existing, ...newItems],
            [`${tab}Loading`]: false,
            pagination: {
              ...s.pagination,
              [tab]: { nextPage: meta?.nextPage || null, hasMore },
            },
          }
        }),

        setTabLoading: (tab, loading) => set({ [`${tab}Loading`]: loading }),

        setTabError: (tab, error) => set({ [`${tab}Error`]: error, [`${tab}Loading`]: false }),

        /* Discover stores the whole { featured, sections } envelope */
        setDiscoverData: ({ featured, sections, meta }) => set({
          discoverData: { featured: featured || null, sections: Array.isArray(sections) ? sections : [] },
          discoverLoading: false,
          discoverError: null,
          discoverLastRefreshed: meta?.lastRefreshed || new Date().toISOString(),
        }),

      }),
      {
        name: 'spectre-media',
        version: 3,
        partialize: (state) => ({
          savedItems: state.savedItems,
          recentlyWatched: state.recentlyWatched,
          playlists: state.playlists,
          queue: state.queue,
          queueIndex: state.queueIndex,
          autoPlay: state.autoPlay,
          // Podcast listening state. The EPISODE is deliberately absent — a
          // reload must never auto-start audio — but the position, queue and
          // playback preferences survive so resuming is one tap.
          podcastResume: state.podcastResume,
          podcastRate: state.podcastRate,
          podcastVolume: state.podcastVolume,
          podcastCaptionsOn: state.podcastCaptionsOn,
          podcastQueue: state.podcastQueue,
          podcastQueueIndex: state.podcastQueueIndex,
        }),
        onRehydrateStorage: () => (state) => {
          if (state && state.savedItems.length === 0) {
            const migrated = migrateOldSaved()
            if (migrated && migrated.length > 0) {
              useMediaStore.setState({ savedItems: migrated })
            }
          }
        },
      }
    ),
    { name: 'MediaStore' }
  )
)

export default useMediaStore
