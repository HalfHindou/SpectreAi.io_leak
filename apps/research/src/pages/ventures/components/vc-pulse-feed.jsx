/**
 * VcPulseFeed — the live right rail. Leads with the selected fund's X posts
 * (their actual narrative, per fund) and a rolling crypto news feed beneath, so
 * the page reads as a living stream rather than a static list.
 */
import React from 'react'
import { handleForVc } from './vc-handles'
import useVcTweets from './useVcTweets'
import useVcNews from './useVcNews'
import './vc-pulse-feed.css'

function fmtNum(n) {
  const v = typeof n === 'string' ? parseInt(n.replace(/[^\d]/g, ''), 10) : n
  if (!Number.isFinite(v)) return null
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(v)
}

function fmtAge(ts) {
  if (!ts) return ''
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 0 || !Number.isFinite(s)) return ''
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function VcPulseFeed({ entity }) {
  const handle = entity ? handleForVc(entity.id) : null
  const { tweets, loading: tLoading } = useVcTweets(handle)
  const { news, loading: nLoading } = useVcNews()

  return (
    <aside className="vpf">
      <div className="vpf-header">
        <div className="vpf-title">
          Live Pulse
          <span className="vpf-livedot" aria-hidden />
        </div>
        <div className="vpf-sub">{entity ? `${entity.name} · posts + market news` : 'posts + market news'}</div>
      </div>

      <div className="vpf-scroll">
        {/* fund posts */}
        <section className="vpf-sec">
          <div className="vpf-sec-head">
            <span className="vpf-sec-title">Latest posts</span>
            {handle && <a className="vpf-handle" href={`https://x.com/${handle}`} target="_blank" rel="noopener noreferrer">@{handle}</a>}
          </div>
          {handle && tweets.length > 0 ? (
            <div className="vpf-list">
              {tweets.slice(0, 6).map((t, i) => (
                <a key={t.id || i} className="vpf-tweet" href={t.url} target="_blank" rel="noopener noreferrer">
                  <p className="vpf-tweet-text">{t.text}</p>
                  <div className="vpf-tweet-meta">
                    {t.date && <span>{t.date}</span>}
                    {fmtNum(t.likes) && <span>♥ {fmtNum(t.likes)}</span>}
                    {fmtNum(t.views) && <span>{fmtNum(t.views)} views</span>}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="vpf-empty">
              {tLoading ? 'Loading live posts…' : entity ? `No X feed tracked for ${entity.name} yet.` : 'Select a fund to see its posts.'}
            </div>
          )}
        </section>

        {/* market news */}
        <section className="vpf-sec">
          <div className="vpf-sec-head">
            <span className="vpf-sec-title">Market news</span>
            <span className="vpf-sec-tag">live</span>
          </div>
          {news.length > 0 ? (
            <div className="vpf-list">
              {news.slice(0, 10).map((n, i) => {
                const Card = n.url ? 'a' : 'div'
                return (
                  <Card key={i} className="vpf-news" {...(n.url ? { href: n.url, target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    {n.image && <img className="vpf-news-img" src={n.image} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none' }} />}
                    <div className="vpf-news-body">
                      <p className="vpf-news-title">{n.title}</p>
                      <div className="vpf-news-meta">
                        {n.source && <span className="vpf-news-src">{n.source}</span>}
                        {fmtAge(n.ts) && <span>· {fmtAge(n.ts)}</span>}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          ) : (
            <div className="vpf-empty">{nLoading ? 'Loading market news…' : 'No news right now.'}</div>
          )}
        </section>
      </div>
    </aside>
  )
}
