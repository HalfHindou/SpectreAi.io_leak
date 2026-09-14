/**
 * PodcastsTabPanel — the Command Center's listening lane.
 *
 * A compact read of the same curated feed the AI Media Center serves: what you
 * were part-way through, then the newest drops. Play routes to the app-wide
 * player (useMediaStore.playPodcast), so audio keeps running while you work the
 * rest of the dashboard — that is the whole point of putting it here.
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useMediaStore from '@/store/useMediaStore'
import * as mediaApi from '@/services/mediaApi'
import { fmtEpLength, fmtDuration, relTime } from '@/pages/media-center/components/media-format'
import './podcasts-tab-panel.css'

const IconPlay = ({ size = 14 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true"><path d="M8 5.14v14l11-7-11-7z" /></svg>
)
const IconPause = ({ size = 14 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
)
const IconCC = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M9 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3" />
  </svg>
)

/* Shared across mounts so the desktop and mobile Command Center render sites —
   and a StrictMode double-mount — collapse onto one request. */
let inflightPodcasts = null

const PodcastsTabPanel = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  /* The media store already holds this feed once the Media Center has been
     opened — reuse it rather than re-fetching, and only hit the API when the
     panel is genuinely the first consumer this session. */
  const storeItems = useMediaStore(s => s.podcastsItems)
  const setTabData = useMediaStore(s => s.setTabData)
  const setTabLoading = useMediaStore(s => s.setTabLoading)
  const podcastsLoading = useMediaStore(s => s.podcastsLoading)

  const playPodcast = useMediaStore(s => s.playPodcast)
  const togglePlay = useMediaStore(s => s.togglePodcastPlay)
  const current = useMediaStore(s => s.podcastEpisode)
  const playing = useMediaStore(s => s.podcastPlaying)
  const resume = useMediaStore(s => s.podcastResume)

  const [error, setError] = useState(null)
  const [view, setView] = useState('latest')

  useEffect(() => {
    const st = useMediaStore.getState()
    if (st.podcastsItems.length) return
    let cancelled = false
    setTabLoading('podcasts', true)
    // 🪤 Do NOT skip on `podcastsLoading` and do NOT gate the store write on a
    // per-run cancelled flag. StrictMode mounts → cleans up → mounts again: the
    // first run's promise then resolves into a torn-down closure and drops the
    // data, while the second run sees loading=true and returns early. The panel
    // sits empty forever. The result goes to a GLOBAL store, so writing it from
    // a stale run is correct; only the local error state needs the flag.
    // Module-level dedup keeps that double-mount to one request.
    if (!inflightPodcasts) {
      inflightPodcasts = mediaApi.getPodcasts().finally(() => { inflightPodcasts = null })
    }
    inflightPodcasts
      .then(res => setTabData('podcasts', res))
      .catch(err => {
        setTabLoading('podcasts', false)
        if (!cancelled) setError(err.message)
      })
    return () => { cancelled = true }
  }, [setTabData, setTabLoading])

  const playable = useMemo(() => storeItems.filter(e => e?.audioUrl), [storeItems])

  const continueList = useMemo(() => {
    const rows = []
    for (const ep of playable) {
      const r = resume[ep.id]
      if (r?.t > 15) rows.push({ ep, at: r.at || 0, progress: r.d ? Math.min(1, r.t / r.d) : 0, left: r.d ? r.d - r.t : 0 })
    }
    return rows.sort((a, b) => b.at - a.at)
  }, [playable, resume])

  const rows = view === 'continue' ? continueList.map(c => c.ep) : playable.slice(0, 24)

  const handlePlay = useCallback((ep) => {
    if (current?.id === ep.id) { togglePlay(); return }
    // Docked, not immersive — the whole point of the tab is audio you keep on
    // while you work the rest of the dashboard.
    playPodcast(ep, rows, { immersive: false })
  }, [current?.id, togglePlay, playPodcast, rows])

  const progressOf = useCallback((ep) => {
    const r = resume[ep.id]
    return r?.d ? Math.min(1, r.t / r.d) : 0
  }, [resume])

  const loading = podcastsLoading && !playable.length

  return (
    <div className="ccp">
      <div className="ccp-head">
        <div className="ccp-views" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'latest'}
            className={`ccp-view${view === 'latest' ? ' is-active' : ''}`}
            onClick={() => setView('latest')}
          >
            {t('mediaCenter.podcasts.latest', 'Latest')}
          </button>
          {continueList.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={view === 'continue'}
              className={`ccp-view${view === 'continue' ? ' is-active' : ''}`}
              onClick={() => setView('continue')}
            >
              {t('mediaCenter.podcasts.continue')}
              <span className="ccp-view-count">{continueList.length}</span>
            </button>
          )}
        </div>
        <button type="button" className="ccp-all" onClick={() => navigate('/ai-media-center')}>
          {t('mediaCenter.podcasts.openMediaCenter', 'Media Center')}
        </button>
      </div>

      {loading ? (
        <div className="ccp-list">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="ccp-skel animate-shimmer" style={{ animationDelay: `${i * 0.05}s` }} />
          ))}
        </div>
      ) : error ? (
        <p className="ccp-empty">{error}</p>
      ) : rows.length === 0 ? (
        <p className="ccp-empty">{t('mediaCenter.podcasts.empty')}</p>
      ) : (
        <div className="ccp-list">
          {rows.map(ep => {
            const active = current?.id === ep.id
            const p = progressOf(ep)
            return (
              <button
                key={ep.id}
                type="button"
                className={`ccp-row${active ? ' is-active' : ''}`}
                onClick={() => handlePlay(ep)}
              >
                <span className="ccp-art">
                  {ep.thumbnail
                    ? <img src={ep.thumbnail} alt="" loading="lazy" />
                    : <span className="ccp-ph">{(ep.channel?.name || '?').charAt(0)}</span>}
                  <span className="ccp-art-play">{active && playing ? <IconPause /> : <IconPlay />}</span>
                  {p > 0 && <span className="ccp-art-prog"><span style={{ transform: `scaleX(${p})` }} /></span>}
                </span>
                <span className="ccp-body">
                  <span className="ccp-show">{ep.channel?.name}</span>
                  <span className="ccp-title">{ep.title}</span>
                  <span className="ccp-meta">
                    {ep.duration ? <span className="ccp-dur">{fmtEpLength(ep.duration)}</span> : null}
                    {ep.publishedAt ? <span>{relTime(ep.publishedAt, t)}</span> : null}
                    {ep.hasTranscript && <span className="ccp-cc"><IconCC />{t('mediaCenter.podcasts.cc')}</span>}
                  </span>
                </span>
                {view === 'continue' && (
                  <span className="ccp-left">
                    {fmtDuration(continueList.find(c => c.ep.id === ep.id)?.left || 0)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default PodcastsTabPanel
