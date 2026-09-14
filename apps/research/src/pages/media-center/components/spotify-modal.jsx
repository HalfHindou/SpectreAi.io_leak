/**
 * SpotifyDock — the floating Spotify player, and its fullscreen form.
 *
 * Mounted in AppShell, so it survives navigation out of the AI Media Center.
 *
 * 🪤 ONE TREE, TWO SIZES. The dock and the fullscreen view are the SAME root
 * element with a modifier class, and every child is KEYED. Rendering fullscreen
 * as a separate branch re-parents the <iframe>, React unmounts and remounts it,
 * and the embed reloads — playback restarts at zero on every expand. Keyed
 * children keep the player row's identity across the toggle, so expanding is a
 * pure CSS change and the audio never stops.
 *
 * 🪤 The embed also picks its internal layout from the frame's WIDTH and does
 * not grow back to fill a taller box after a resize. So the frame keeps ONE
 * geometry in both sizes (the dock's own 585x152, measured) and fullscreen
 * spends its extra room on the art, the AI read and the other shows instead of
 * on a bigger — and part-empty — embed.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import useMediaStore from '@/store/useMediaStore'
import MediaSynthesis from './media-synthesis'
import { spotifyEmbedUrl, SPOTIFY_PODCASTS } from './spotify-podcasts'
import * as mediaApi from '@/services/mediaApi'
import { fmtEpLength, relTime } from './media-format'
import './spotify-modal.css'

const IconClose = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

const IconSpark = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

const IconExpand = ({ size = 15 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />
  </svg>
)

const IconCollapse = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 10h6V4M10 10 3 3M20 14h-6v6M14 14l7 7" />
  </svg>
)

const SpotifyLogo = ({ size = 15 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fill="#1DB954" d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.5 17.3a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.04 8.5-.59 11.66 1.34.36.22.47.69.25 1.03zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.23-1.99-8.15-2.56-11.97-1.4a.94.94 0 1 1-.54-1.8c4.37-1.32 9.79-.68 13.5 1.6.44.27.58.85.3 1.29zm.13-3.4C15.73 8.24 9.1 8.02 5.33 9.17a1.12 1.12 0 1 1-.65-2.15c4.33-1.31 11.65-1.06 16.25 1.67a1.12 1.12 0 1 1-1.15 1.93z" />
  </svg>
)

const SpotifyDock = ({ dayMode = false }) => {
  const { t } = useTranslation()
  const show = useMediaStore(s => s.spotifyShow)
  const fullscreen = useMediaStore(s => s.spotifyFullscreen)
  const latest = useMediaStore(s => s.spotifyLatest)
  const close = useMediaStore(s => s.closeSpotify)
  const openFull = useMediaStore(s => s.openSpotifyFullscreen)
  const closeFull = useMediaStore(s => s.closeSpotifyFullscreen)
  const openSpotify = useMediaStore(s => s.openSpotify)
  const playPodcast = useMediaStore(s => s.playPodcast)
  const [synOpen, setSynOpen] = useState(false)
  const [railTab, setRailTab] = useState('episodes')
  const [showEps, setShowEps] = useState([])
  const [epsState, setEpsState] = useState('idle') // idle | loading | ready | none
  // 🪤 The fetch guard CANNOT be the state it sets. Putting `epsState` in the
  // deps re-runs the effect the moment it flips to 'loading', and that run's
  // cleanup sets cancelled=true on the in-flight request — the response lands
  // in a dead closure and the list stays empty forever. Same shape as the
  // StrictMode double-mount trap in the Command Center panel.
  const epsFetchedFor = useRef(null)

  useEffect(() => {
    if (!show) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // Escape steps DOWN one level rather than killing playback outright.
      if (useMediaStore.getState().spotifyFullscreen) closeFull()
      else close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [show, close, closeFull])

  // Collapse the inline summary when the show changes (fullscreen has its own)
  useEffect(() => {
    setSynOpen(false); setRailTab('episodes'); setShowEps([]); setEpsState('idle')
    epsFetchedFor.current = null
  }, [show?.spotifyId])

  /* The show's back catalogue. A Spotify embed only ever exposes its LATEST
     episode, so without this there is no way to reach anything older — which is
     exactly what "I want to see more from The Rollup" runs into. Resolved by
     show NAME through Podcast Index, and only once the panel is open. */
  useEffect(() => {
    const name = show?.name
    if (!fullscreen || !name || epsFetchedFor.current === name) return
    epsFetchedFor.current = name
    let cancelled = false
    setEpsState('loading')
    mediaApi.getShowByName(name)
      .then(r => {
        if (cancelled) return
        const items = (r?.items || []).filter(e => e.audioUrl)
        setShowEps(items)
        setEpsState(items.length ? 'ready' : 'none')
      })
      .catch(() => { if (!cancelled) { epsFetchedFor.current = null; setEpsState('none') } })
    return () => { cancelled = true }
  }, [fullscreen, show?.name])

  const playEpisode = useCallback((ep) => {
    // Switches to OUR player — captions, visualizer, and playback that follows
    // you around the app. playPodcast() closes this dock so nothing doubles up.
    playPodcast(ep, showEps)
  }, [playPodcast, showEps])

  useEffect(() => {
    if (!fullscreen || !show) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [fullscreen, show])

  if (!show) return null

  const ep = latest?.[show.spotifyId]
  const others = SPOTIFY_PODCASTS.filter(s => s.spotifyId !== show.spotifyId)

  /* Every child is keyed — see the header note. */
  const children = []

  if (fullscreen) {
    children.push(
      <div className="mcx-spdock-bg" key="bg" aria-hidden="true">
        {show.cover && <img src={show.cover} alt="" referrerPolicy="no-referrer" />}
        <span className="mcx-spdock-scrim" />
      </div>,
      <header className="mcx-spdock-top" key="top">
        <button type="button" className="mcx-spdock-back" onClick={closeFull}>
          <IconCollapse />
          <span>{t('mediaCenter.spotify.exitFullscreen')}</span>
        </button>
        <span className="mcx-spdock-brand"><SpotifyLogo />{t('mediaCenter.spotify.onSpotify')}</span>
        <button type="button" className="mcx-spdock-xl" onClick={close} aria-label={t('mediaCenter.theater.close')}>
          <IconClose size={18} />
        </button>
      </header>,
      <div className="mcx-spdock-id" key="id">
        {show.cover && <img className="mcx-spdock-cover" src={show.cover} alt="" referrerPolicy="no-referrer" />}
        <div className="mcx-spdock-idmeta">
          <span className="mcx-spdock-host">{show.host}</span>
          <h2 className="mcx-spdock-name">{show.name}</h2>
          <div className="mcx-spdock-pills">
            {show.category && <span className="mcx-spdock-pill">{show.category}</span>}
            {ep?.durationSec ? <span className="mcx-spdock-pill">{fmtEpLength(ep.durationSec)}</span> : null}
            {ep?.releaseDate ? <span className="mcx-spdock-pill">{relTime(ep.releaseDate, t)}</span> : null}
          </div>
          {ep?.episodeTitle && (
            <p className="mcx-spdock-latest">{t('mediaCenter.spotify.latestEpisode')}: {ep.episodeTitle}</p>
          )}
        </div>
      </div>,
    )
  }

  if (synOpen && !fullscreen) {
    children.push(
      <div className="mcx-spdock-syn" key="syn">
        <MediaSynthesis
          kind="podcast"
          id={show.spotifyId}
          title={show.name}
          source={show.host}
          variant="inline"
          autoLoad
          dayMode={dayMode}
        />
      </div>,
    )
  }

  // THE player row — same element, same key, in both sizes. Do not move it.
  children.push(
    <div className="mcx-spdock-player" key="player">
      <iframe
        title={show.name}
        src={spotifyEmbedUrl(show.spotifyId)}
        className="mcx-spdock-frame"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
      />
      <div className="mcx-spdock-actions">
        {!fullscreen && (
          <button
            type="button"
            className={`mcx-spdock-syntoggle${synOpen ? ' is-open' : ''}`}
            onClick={() => setSynOpen(o => !o)}
            aria-pressed={synOpen}
          >
            <IconSpark />
            <span>{t('mediaCenter.synthesis.cta')}</span>
          </button>
        )}
        {!fullscreen && (
          <div className="mcx-spdock-btnrow">
            <button
              type="button"
              className="mcx-spdock-expand"
              onClick={openFull}
              title={t('mediaCenter.spotify.fullscreen')}
              aria-label={t('mediaCenter.spotify.fullscreen')}
            >
              <IconExpand />
            </button>
            <button type="button" className="mcx-spdock-close" onClick={close} aria-label={t('mediaCenter.theater.close')}>
              <IconClose />
            </button>
          </div>
        )}
      </div>
    </div>,
  )

  if (fullscreen) {
    children.push(
      <aside className="mcx-spdock-rail" key="rail">
        <div className="mcx-spdock-railtabs" role="tablist">
          {[
            { id: 'episodes', label: t('mediaCenter.spotify.episodes'), n: showEps.length },
            { id: 'ai', label: t('mediaCenter.synthesis.label') },
            { id: 'shows', label: t('mediaCenter.spotify.otherShows') },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={railTab === tab.id}
              className={`mcx-spdock-railtab${railTab === tab.id ? ' is-active' : ''}`}
              onClick={() => setRailTab(tab.id)}
            >
              {tab.label}
              {tab.n > 0 && <span className="mcx-spdock-railcount">{tab.n}</span>}
            </button>
          ))}
        </div>

        {railTab === 'episodes' && (
          <div className="mcx-spdock-eps">
            {epsState === 'loading' && (
              <div className="mcx-spdock-epskel">
                {[0, 1, 2, 3].map(i => <span key={i} className="animate-shimmer" style={{ animationDelay: `${i * 0.06}s` }} />)}
              </div>
            )}
            {epsState === 'none' && (
              <p className="mcx-spdock-epnote">{t('mediaCenter.spotify.noEpisodes')}</p>
            )}
            {epsState === 'ready' && (
              <>
                <p className="mcx-spdock-epnote">{t('mediaCenter.spotify.playHere')}</p>
                <div className="mcx-spdock-morelist">
                  {showEps.map(ep => (
                    <button key={ep.id} type="button" className="mcx-spdock-morerow" onClick={() => playEpisode(ep)}>
                      <span className="mcx-spdock-moreart">
                        {ep.thumbnail
                          ? <img src={ep.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                          : <span className="mcx-spdock-moreph">{(ep.channel?.name || '?').charAt(0)}</span>}
                      </span>
                      <span className="mcx-spdock-morebody">
                        <span className="mcx-spdock-morename">{ep.title}</span>
                        <span className="mcx-spdock-moremeta">
                          {ep.publishedAt ? relTime(ep.publishedAt, t) : ''}
                          {ep.duration ? ` · ${fmtEpLength(ep.duration)}` : ''}
                          {ep.hasTranscript ? ` · ${t('mediaCenter.podcasts.cc')}` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {railTab === 'ai' && (
          <section className="mcx-spdock-synfull">
            <MediaSynthesis
              kind="podcast"
              id={show.spotifyId}
              title={show.name}
              source={show.host}
              variant="panel"
              autoLoad
              dayMode={dayMode}
            />
          </section>
        )}

        {railTab === 'shows' && (
          <section className="mcx-spdock-more">
            <div className="mcx-spdock-morelist">
              {others.map(other => {
                const oep = latest?.[other.spotifyId]
                return (
                  <button
                    key={other.id}
                    type="button"
                    className="mcx-spdock-morerow"
                    onClick={() => { openSpotify(other); openFull() }}
                  >
                    <span className="mcx-spdock-moreart">
                      {other.cover
                        ? <img src={other.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        : <span className="mcx-spdock-moreph">{other.name.charAt(0)}</span>}
                    </span>
                    <span className="mcx-spdock-morebody">
                      <span className="mcx-spdock-morename">{other.name}</span>
                      <span className="mcx-spdock-moremeta">
                        {other.host}
                        {oep?.releaseDate ? <> · {relTime(oep.releaseDate, t)}</> : null}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </aside>,
    )
  }

  return createPortal(
    <div
      className={`mcx-spdock${fullscreen ? ' is-full' : ''}${dayMode ? ' day-mode' : ''}`}
      role={fullscreen ? 'dialog' : 'region'}
      aria-modal={fullscreen || undefined}
      aria-label={show.name}
    >
      {children}
    </div>,
    document.body,
  )
}

export default SpotifyDock
