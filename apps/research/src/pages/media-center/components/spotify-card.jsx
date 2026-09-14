/**
 * SpotifyCard — a curated Spotify podcast show. Click opens the embed player.
 * variants: 'grid' (cover-forward) · 'rail' · 'row' (compact, hero side column)
 * Uses the real Spotify cover art (gradient is the loading/fallback backdrop).
 */
import { useTranslation } from 'react-i18next'
import useMediaStore from '@/store/useMediaStore'
import { fmtMinutes, fmtEpLength, relTime } from './media-format'

const SpotifyLogo = ({ size = 14 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fill="#1DB954" d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.5 17.3a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.04 8.5-.59 11.66 1.34.36.22.47.69.25 1.03zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.23-1.99-8.15-2.56-11.97-1.4a.94.94 0 1 1-.54-1.8c4.37-1.32 9.79-.68 13.5 1.6.44.27.58.85.3 1.29zm.13-3.4C15.73 8.24 9.1 8.02 5.33 9.17a1.12 1.12 0 1 1-.65-2.15c4.33-1.31 11.65-1.06 16.25 1.67a1.12 1.12 0 1 1-1.15 1.93z" />
  </svg>
)

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><polygon points="6,4 20,12 6,20" fill="currentColor" /></svg>
)

const SpotifyCard = ({ show, variant = 'grid', index = 0 }) => {
  const { t } = useTranslation()
  const openSpotify = useMediaStore(s => s.openSpotify)
  const ep = useMediaStore(s => s.spotifyLatest)[show?.spotifyId]
  if (!show) return null
  const open = () => openSpotify(show)
  const isRow = variant === 'row'
  const mins = ep ? fmtMinutes(ep.durationSec) : 0
  const when = ep?.releaseDate ? relTime(ep.releaseDate, t) : ''

  return (
    <article
      className={`mcx-sp mcx-sp--${variant}`}
      role="button"
      tabIndex={0}
      data-cat={show.category}
      style={{ '--c1': show.c1, '--c2': show.c2, '--i': index }}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
    >
      <span className="mcx-sp-art">
        {show.cover
          ? <img src={show.cover} alt="" className="mcx-sp-cover" loading="lazy" referrerPolicy="no-referrer" />
          : <span className="mcx-sp-art-name">{show.name}</span>}
        <span className="mcx-sp-badge"><SpotifyLogo /></span>
        <span className="mcx-sp-play"><PlayGlyph /></span>
      </span>
      <span className="mcx-sp-body">
        <span className="mcx-sp-name">{show.name}</span>
        <span className="mcx-sp-sub">
          <span className="mcx-sp-host">{show.host}</span>
          {show.category && <span className="mcx-sp-cat" data-cat={show.category}><span className="mcx-sp-cat-dot" />{show.category}</span>}
        </span>
        {!isRow && mins > 0 && (
          <span className="mcx-sp-ep">
            <span className="mcx-sp-ep-dur">{t('mediaCenter.podcasts.duration', { m: mins })}</span>
            {when && <><span className="mcx-dotsep" aria-hidden="true">·</span><span>{when}</span></>}
          </span>
        )}
      </span>
      {isRow && (
        <span className="mcx-sp-rowmeta">
          {mins > 0 ? (
            <>
              <span className="mcx-sp-rowdur">{fmtEpLength(ep.durationSec)}</span>
              {when && <span className="mcx-sp-rowwhen">{when}</span>}
            </>
          ) : (
            <span className="mcx-sp-rowplay" aria-hidden="true"><PlayGlyph /></span>
          )}
        </span>
      )}
    </article>
  )
}

export default SpotifyCard
