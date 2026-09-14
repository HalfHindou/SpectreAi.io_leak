/**
 * ZIGChain — Social Intelligence panel (Spectre X Dash).
 *
 * Tells ZIG's real social-attention arc with live data: it peaked near the top
 * of Spectre's social board (best_rank_position_window) and entered the
 * Momentum Top-25, then cooled. Below-the-fold, so the fetch is
 * IntersectionObserver-gated. Renders nothing until real data arrives — never a
 * shell of zeros.
 */
import React, { useEffect, useRef, useState } from 'react'
import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
import { useZigSocialIntel } from '../hooks/useZigSocialIntel'
import { fmtRelTime, fmtCompact } from '../hooks/useZigAnnouncements'
import './ZigSocialIntel.css'

const TIER_LABEL = {
  elite: 'Elite signal',
  strong: 'Strong signal',
  building: 'Building',
  quiet: 'Quiet',
}

function fmtShortDate(iso) {
  const ts = Date.parse(iso || '')
  if (!Number.isFinite(ts)) return ''
  return new Intl.DateTimeFormat(i18n.language || 'en', { month: 'short', day: 'numeric' }).format(ts)
}

function useInView(rootMargin = '360px 0px') {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (inView) return undefined
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') { setInView(true); return undefined }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect() }
    }, { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [inView, rootMargin])
  return { ref, inView }
}

function RankMove({ dir, delta }) {
  if (dir === 'new') return <span className="zsi-move zsi-move--new">NEW</span>
  if (!dir || dir === 'flat' || delta == null || delta === 0) return null
  const up = dir === 'up'
  return (
    <span className={`zsi-move ${up ? 'zsi-move--up' : 'zsi-move--down'}`}>
      <span aria-hidden>{up ? '▲' : '▼'}</span> {Math.abs(delta)}
    </span>
  )
}

function Metric({ label, value, hint }) {
  return (
    <div className="zsi-metric" title={hint || undefined}>
      <span className="zsi-metric-v">{value}</span>
      <span className="zsi-metric-l">{label}</span>
    </div>
  )
}

export default function ZigSocialIntel() {
  const { t } = useTranslation()
  const { ref, inView } = useInView()
  const { data, loading } = useZigSocialIntel({ enabled: inView })
  const show = !!(data && data.hasData)

  const m = data?.metrics || {}
  const velTxt = m.velocity != null ? `${m.velocity.toFixed(2)}×` : '—'
  const mentionsTxt = m.mentions24h != null ? (fmtCompact(m.mentions24h) || String(m.mentions24h)) : '—'
  const authorsTxt = m.authors24h != null ? (fmtCompact(m.authors24h) || String(m.authors24h)) : '—'
  const engTxt = m.engagement != null ? (fmtCompact(Math.round(m.engagement)) || String(Math.round(m.engagement))) : '—'

  return (
    <section ref={ref} className="zsi">
      <header className="zsi-head">
        <div className="zsi-title">
          <span className="zsi-live-dot" aria-hidden />
          <span className="zsi-title-t">{t('zigchainChrome.social.title', 'Social Intelligence')}</span>
          <span className="zsi-title-src">{t('zigchainChrome.social.src', 'Spectre X Dash')}</span>
        </div>
        {show && data.generatedAt && (
          <span className="zsi-updated">{t('zigchainChrome.social.updated', 'Updated {{when}}', { when: fmtRelTime(data.generatedAt) || 'now' })}</span>
        )}
      </header>

      {loading && !show && (
        <div className="zsi-skel" aria-hidden>
          <div className="zsi-skel-hero" />
          <div className="zsi-skel-row" />
        </div>
      )}

      {!loading && !show && (
        <p className="zsi-empty">{t('zigchainChrome.social.empty', 'Social signal is quiet right now.')}</p>
      )}

      {show && (
        <div className="zsi-body">
          <div className="zsi-hero">
            {data.peakRank != null && (
              <div className="zsi-peak">
                <span className="zsi-peak-k">{t('zigchainChrome.social.peak', 'Peak social rank')}</span>
                <span className="zsi-peak-v">#{data.peakRank}</span>
                <span className="zsi-peak-sub">{t('zigchainChrome.social.peakSub', 'across Spectre’s social board')}</span>
              </div>
            )}
            {data.score != null && (
              <div className={`zsi-score zsi-score--${data.tier || 'quiet'}`}>
                <span className="zsi-score-v">{data.score}</span>
                <span className="zsi-score-tier">{TIER_LABEL[data.tier] || '—'}</span>
                <span className="zsi-score-k">{t('zigchainChrome.social.signalScore', 'Signal score')}</span>
              </div>
            )}
            {data.rank != null && (
              <div className="zsi-now">
                <div className="zsi-now-row">
                  <span className="zsi-now-v">#{data.rank}</span>
                  <RankMove dir={data.rankDir} delta={data.rankDelta} />
                </div>
                <span className="zsi-now-k">
                  {data.boardSize
                    ? t('zigchainChrome.social.nowRankBoard', 'Now · top {{n}} board', { n: data.boardSize })
                    : t('zigchainChrome.social.nowRank', 'Current rank')}
                </span>
              </div>
            )}
          </div>

          <div className="zsi-metrics">
            <Metric label={t('zigchainChrome.social.mentions', 'Mentions 24h')} value={mentionsTxt} />
            <Metric label={t('zigchainChrome.social.voices', 'Unique voices')} value={authorsTxt} />
            <Metric label={t('zigchainChrome.social.velocity', 'Attention velocity')} value={velTxt} hint="24h mention pace vs baseline" />
            <Metric label={t('zigchainChrome.social.engagement', 'Engagement')} value={engTxt} hint="Weighted likes / reposts / views" />
          </div>

          {data.momentumEntry?.entry_rank != null && (
            <div className="zsi-foot">
              <span className="zsi-foot-dot" aria-hidden />
              {t('zigchainChrome.social.momentum', 'Entered Spectre Momentum Top-25 at #{{rank}}', { rank: data.momentumEntry.entry_rank })}
              {data.momentumEntry.entered_at ? ` · ${fmtShortDate(data.momentumEntry.entered_at)}` : ''}
            </div>
          )}

          {Array.isArray(data.topAuthors) && data.topAuthors.length > 0 && (
            <div className="zsi-carriers">
              <span className="zsi-carriers-l">{t('zigchainChrome.social.carriers', 'Top voices')}</span>
              <div className="zsi-carriers-row">
                {data.topAuthors.slice(0, 5).map((a, i) => {
                  const author = a.author || a
                  const handle = String(author.handle || author.screen_name || '').replace(/^@/, '')
                  if (!handle) return null
                  return (
                    <a
                      key={handle + i}
                      href={`https://x.com/${handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="zsi-carrier"
                      title={`@${handle}`}
                    >
                      <img
                        src={author.profile_image_url || author.avatar || `https://unavatar.io/twitter/${handle}`}
                        alt=""
                        className="zsi-carrier-ava"
                        loading="lazy"
                        onError={(e) => { e.currentTarget.src = `https://unavatar.io/twitter/${handle}` }}
                      />
                    </a>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
