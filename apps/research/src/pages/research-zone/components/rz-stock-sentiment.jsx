/**
 * Stock Sentiment — Phase 2 Tier 1 (stocks-ta-sentiment-plan.md).
 *
 * The equity desk read: an LLM synthesis grounded ONLY in real inputs — Yahoo
 * fundamentals, analyst consensus, the next earnings print and live headlines
 * (GET /api/sentiment-read?assetClass=stock). There is NO crowd/social feed
 * for equities yet (Tier 2 = StockTwits/Reddit on Hetzner), and this surface
 * says so honestly instead of painting a fabricated gauge.
 *
 * Deliberately NOT the crypto SentimentTab: mounting that for a stock would
 * fire the crypto engine (mindshare/X Dash keyed by bare symbol = the AAPL
 * ticker-collision class).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SectionShell from './rz-pro-sections/section-shell'
import './rz-technicals-tab.css'
import './rz-stock-sentiment.css'

const STANCE_META = {
  bullish: { label: 'Bullish', cls: 'bull' },
  bearish: { label: 'Bearish', cls: 'bear' },
  cautious: { label: 'Cautious', cls: 'warn' },
  neutral: { label: 'Neutral', cls: 'neutral' },
}

const MAX_PENDING_RETRIES = 5

// ── Crowd classify — EQUITY lexicon over the ticker tweets the page already
// fetched for the right rail. Sample-based and labeled as such (the pattern
// PR #1207 set with the CA-badge read); the full StockTwits/Reddit feed is the
// Tier-2 upgrade. Engagement-weighted like the server crowd-stance classifier.
const EQ_BULL_RE = /\b(calls?|long(?:ed|ing)?|buy(?:ing)?|bought|bullish|breakout|break(?:s|ing)? (?:out|higher)|squeeze|undervalued|upside|rip(?:s|ping)?|moon(?:ing)?|new highs?|all[- ]time high|ath|accumulat\w*|adding|loaded|send it|higher|upgrade[ds]?|beat(?:s|ing)?)\b/i
const EQ_BEAR_RE = /\b(puts?|short(?:ed|ing)?|sell(?:ing)?|sold|bearish|overvalued|bubble|dump(?:ed|ing)?|crash(?:ing)?|tank(?:ed|ing)?|drill(?:ed|ing)?|downgrade[ds]?|miss(?:es|ed)?|lawsuit|bagholder|top is in|rug|fade|exit(?:ed|ing)? (?:my|the)? ?position)\b/i

function classifyCrowd(tweets) {
  const rows = []
  let bullW = 0, bearW = 0, neutralW = 0
  for (const t of Array.isArray(tweets) ? tweets : []) {
    const text = String(t?.text || t?.content || '').trim()
    if (!text || text.length < 8) continue
    const bull = EQ_BULL_RE.test(text)
    const bear = EQ_BEAR_RE.test(text)
    const tag = bull && !bear ? 'bull' : bear && !bull ? 'bear' : 'neutral'
    // log-scaled engagement + follower weight — one whale post ≠ one bot post
    const w = 1
      + Math.log10(1 + (Number(t?.likes) || 0) + (Number(t?.retweets) || 0) * 2)
      + Math.log10(1 + (Number(t?.followers) || 0)) / 4
      + (t?.is_verified ? 0.4 : 0)
    if (tag === 'bull') bullW += w
    else if (tag === 'bear') bearW += w
    else neutralW += w
    rows.push({ ...t, _tag: tag, _w: w })
  }
  const total = bullW + bearW + neutralW
  if (!rows.length || total <= 0) return null
  // Top posts: directional first, by weight
  const top = rows
    .sort((a, b) => (a._tag === 'neutral' ? 0 : 1) !== (b._tag === 'neutral' ? 0 : 1)
      ? (a._tag === 'neutral' ? 1 : -1)
      : b._w - a._w)
    .slice(0, 5)
  return {
    sample: rows.length,
    bullPct: Math.round((bullW / total) * 100),
    bearPct: Math.round((bearW / total) * 100),
    neutralPct: Math.max(0, 100 - Math.round((bullW / total) * 100) - Math.round((bearW / total) * 100)),
    top,
  }
}

export default function StockSentimentTab({ sym, tweets = null }) {
  const { t } = useTranslation()
  const crowd = useMemo(() => classifyCrowd(tweets), [tweets])
  const [read, setRead] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | error
  const retriesRef = useRef(0)

  useEffect(() => {
    if (!sym) return undefined
    let cancelled = false
    let timer = null
    retriesRef.current = 0
    setRead(null)
    setState('loading')

    const load = async () => {
      try {
        const r = await fetch(`/api/sentiment-read?symbol=${encodeURIComponent(sym)}&assetClass=stock`, {
          credentials: 'include',
          signal: AbortSignal.timeout(30_000),
        })
        const data = await r.json().catch(() => null)
        if (cancelled) return
        if (data?.read?.thesis) {
          setRead(data.read)
          setState('ready')
          return
        }
        // Another instance is generating — poll a few times, then give up honestly.
        if (data?.pending && retriesRef.current < MAX_PENDING_RETRIES) {
          retriesRef.current += 1
          timer = setTimeout(load, 6000)
          return
        }
        setState('error')
      } catch {
        if (!cancelled) setState('error')
      }
    }
    load()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [sym])

  const stance = STANCE_META[read?.stance] || STANCE_META.neutral

  return (
    <div className="rz-te2-container">
      <SectionShell
        id="stk-sen-read"
        label={t('researchPro.stockSentiment.stocksentimenttab.label', "SENTIMENT · DESK READ")}
        title={t('researchPro.stockSentiment.stocksentimenttab.title', "Equity Desk Read")}
        subtitle={t('researchPro.stockSentiment.stocksentimenttab.subtitle', "Grounded in fundamentals, Street consensus, earnings and live headlines — AI-composed")}
        aiBadge
      >
        {state === 'loading' && (
          <div className="rz-stksen">
            <div className="animate-shimmer" style={{ width: '55%', height: 22, borderRadius: 6 }} />
            <div className="animate-shimmer" style={{ width: '100%', height: 84, borderRadius: 10, marginTop: 14 }} />
            <div className="animate-shimmer" style={{ width: '100%', height: 60, borderRadius: 10, marginTop: 10 }} />
            <p className="rz-stksen-loading-note">Composing the desk read from live data — first load takes ~10s.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="rz-stksen rz-stksen--empty">
            The desk read isn't available right now — data sources or the model didn't respond. It retries on the next visit.
          </div>
        )}

        {state === 'ready' && read && (
          <div className="rz-stksen">
            <div className="rz-stksen-head">
              <span className={`rz-stksen-stance rz-stksen-stance--${stance.cls}`}>{stance.label}</span>
              {read.conviction != null && (
                <span className="rz-stksen-conviction mono">conviction {read.conviction}/100</span>
              )}
              {read.inputs?.analystCount ? (
                <span className="rz-stksen-inputs">grounded in {read.inputs.analystCount} analyst ratings{read.inputs.headlineCount ? ` · ${read.inputs.headlineCount} headlines` : ''}</span>
              ) : null}
            </div>

            <p className="rz-stksen-thesis">{read.thesis}</p>

            {[
              ['The Catalyst', read.catalyst_read],
              ['The Company', read.company_read],
              ['The Street', read.street_read],
              ['Next Earnings', read.earnings_read],
              ['Investor Take', read.investor_take],
              ['Vs the Index', read.macro_read],
            ].filter(([, v]) => v && v !== 'n/a').map(([title, body]) => (
              <div key={title} className="rz-stksen-block">
                <div className="rz-stksen-block-title">{title}</div>
                <p className="rz-stksen-block-body">{body}</p>
              </div>
            ))}

            {read.risk_flags?.length > 0 && (
              <div className="rz-stksen-chips">
                {read.risk_flags.map((f, i) => (
                  <span key={i} className="rz-stksen-chip rz-stksen-chip--risk">{f}</span>
                ))}
              </div>
            )}
            {read.watch_for?.length > 0 && (
              <div className="rz-stksen-chips">
                {read.watch_for.map((f, i) => (
                  <span key={i} className="rz-stksen-chip rz-stksen-chip--watch">{f}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </SectionShell>

      {/* Crowd — classified from the REAL ticker tweets the page already
          fetched (same posts as the Tweets rail). Sample-based and says so;
          never a fabricated score. */}
      <SectionShell
        id="stk-sen-crowd"
        label={t('researchPro.stockSentiment.stocksentimenttab.label2', "SENTIMENT · CROWD")}
        title={t('researchPro.stockSentiment.stocksentimenttab.title2', "Crowd Sentiment")}
        subtitle={crowd ? `Classified from ${crowd.sample} recent $${sym} posts · engagement-weighted` : 'Retail chatter'}
      >
        {crowd ? (
          <div className="rz-stksen">
            <div className="rz-stksen-crowd-head">
              <span className={`rz-stksen-stance rz-stksen-stance--${crowd.bullPct >= crowd.bearPct + 15 ? 'bull' : crowd.bearPct >= crowd.bullPct + 15 ? 'bear' : 'neutral'}`}>
                {crowd.bullPct >= crowd.bearPct + 15 ? 'Crowd leaning bullish' : crowd.bearPct >= crowd.bullPct + 15 ? 'Crowd leaning bearish' : 'Crowd mixed'}
              </span>
              <span className="rz-stksen-crowd-split mono">
                <span className="rz-stk-up">{crowd.bullPct}% bull</span> · {crowd.neutralPct}% neutral · <span className="rz-stk-down">{crowd.bearPct}% bear</span>
              </span>
            </div>
            <div className="rz-stksen-crowd-bar" role="img" aria-label={`${crowd.bullPct}% bullish, ${crowd.neutralPct}% neutral, ${crowd.bearPct}% bearish`}>
              <span className="rz-stksen-crowd-seg rz-stksen-crowd-seg--bull" style={{ width: `${crowd.bullPct}%` }} />
              <span className="rz-stksen-crowd-seg rz-stksen-crowd-seg--neutral" style={{ width: `${crowd.neutralPct}%` }} />
              <span className="rz-stksen-crowd-seg rz-stksen-crowd-seg--bear" style={{ width: `${crowd.bearPct}%` }} />
            </div>
            <div className="rz-stksen-posts">
              {crowd.top.map((t) => (
                <a key={t.id} href={t.url || undefined} target="_blank" rel="noopener noreferrer" className="rz-stksen-post">
                  <img className="rz-stksen-post-avatar" src={t.avatar} alt="" loading="lazy" onError={(e) => { e.target.style.visibility = 'hidden' }} />
                  <div className="rz-stksen-post-main">
                    <span className="rz-stksen-post-meta">
                      <strong>{t.name}</strong> <span className="rz-stksen-post-handle">{t.handle}</span>
                      {t._tag !== 'neutral' && (
                        <span className={`rz-stksen-post-tag rz-stksen-post-tag--${t._tag}`}>{t._tag === 'bull' ? 'BULL' : 'BEAR'}</span>
                      )}
                    </span>
                    <span className="rz-stksen-post-text">{String(t.text || '').slice(0, 220)}</span>
                  </div>
                </a>
              ))}
            </div>
            <p className="rz-stksen-loading-note">
              Sample read — lexicon-classified from the posts in the Tweets rail, weighted by engagement.
              The full retail feed (StockTwits bull/bear tags + r/stocks, r/wallstreetbets) ships next and replaces this sample.
            </p>
          </div>
        ) : (
          <div className="rz-stksen rz-stksen--empty">
            No recent ${sym} posts captured yet — the crowd gauge lights up as soon as the ticker's
            tweet feed has posts to classify. It never paints a fabricated score.
          </div>
        )}
      </SectionShell>

      <p className="rz-te2-ta-disclaimer">
        AI-composed research read on live market data — not financial advice. It narrates the data
        sheet it was given; verify anything load-bearing before acting.
      </p>
    </div>
  )
}
