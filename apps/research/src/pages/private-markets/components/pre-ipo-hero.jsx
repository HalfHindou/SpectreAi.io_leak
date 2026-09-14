/**
 * PreIpoHero — cinematic featured banner for the Pre-IPO tab.
 *
 * Today the flagship event is the SpaceX listing, so the hero leads with the
 * SpaceX mark + wordmark, the $SPCX ticker, the last private valuation (the
 * hard number from the curated roster), and a LIVE tweet rail pulled from X
 * Dash (official @SpaceX timeline + the $SPCX / "SpaceX IPO" search buzz).
 *
 * Market-cap / listing claims live in the tweet rail, attributed to their
 * authors — the hero asserts only the curated last-private valuation as fact.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import CompanyLogo from './company-logo'
import TweetCard from './tweet-card'
import PreIpoChart from './pre-ipo-chart'
import useCompanyQuote from './use-company-quote'
import { formatAmount } from './private-markets-constants'
import { FEATURED, preipoMeta } from './preipo-constants'

const fmtUsd = (n) =>
  Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null

function HeroSkeleton() {
  return (
    <section className="pi-hero glass-card pi-hero-skeleton" aria-hidden="true">
      <div className="pi-hero-main">
        <div className="pi-skel pi-skel-pill animate-shimmer" style={{ width: 120 }} />
        <div className="pi-hero-brand">
          <div className="pi-logo pi-logo-hero pi-skel animate-shimmer" />
          <div className="pi-skel pi-skel-line animate-shimmer" style={{ width: 220, height: 40 }} />
        </div>
        <div className="pi-skel pi-skel-line animate-shimmer" style={{ width: '70%', height: 16 }} />
        <div className="pi-hero-stats">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="pi-skel pi-skel-line animate-shimmer" style={{ width: 80, height: 36 }} />
          ))}
        </div>
      </div>
      <aside className="pi-hero-feed">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="pi-skel animate-shimmer" style={{ height: 96, borderRadius: 14 }} />
        ))}
      </aside>
    </section>
  )
}

export default function PreIpoHero({ entry, featured, onOpen }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => formatAmount(n, fmtLargeShort)
  const [bannerFailed, setBannerFailed] = useState(false)

  // Hooks must run unconditionally — derive a null-safe ticker before the
  // `!entry` early return so the quote hook keeps a stable call order.
  const meta = entry ? preipoMeta(entry.company) || {} : {}
  const ticker = meta.ticker || FEATURED.ticker
  const tickerSym = (ticker || '').replace(/^\$/, '')
  const { quote } = useCompanyQuote(entry && FEATURED.tvSymbol ? tickerSym : null)
  const up = quote ? quote.change >= 0 : true

  if (!entry) return <HeroSkeleton />

  const banner = !bannerFailed ? featured?.author?.banner : null
  const tweets = featured?.tweets || []
  const tweetsLoading = featured?.loading

  return (
    <section className="pi-hero glass-card pi-hero-live">
      {banner && (
        <img
          className="pi-hero-banner"
          src={banner}
          alt=""
          aria-hidden="true"
          onError={() => setBannerFailed(true)}
          referrerPolicy="no-referrer"
        />
      )}
      <div className="pi-hero-scrim" aria-hidden="true" />
      <div className="pi-hero-glow" aria-hidden="true" />

      <div className="pi-hero-cols">
      <div className="pi-hero-main">
        <div className="pi-hero-eyebrow">
          <span className="pi-status-dot" aria-hidden="true" />
          {FEATURED.eventTag}
          <span className="pi-hero-eyebrow-sep">·</span>
          {t('privateMarkets.preIpo.hero.eyebrow')}
        </div>

        <div className="pi-hero-brand">
          <CompanyLogo company={entry.company} logoUrl={entry.logoUrl} domain={entry.domain} className="pi-logo-hero" />
          <h1 className="pi-hero-title">{entry.company}</h1>
        </div>

        <p className="pi-hero-sub">
          {t('privateMarkets.preIpo.hero.sub', { company: entry.company, ticker })}
        </p>

        <div className="pi-hero-ticker">
          <span className="pi-hero-ticker-sym mono">{ticker}</span>
          {quote && (
            <span className="pi-hero-quote">
              <span className="pi-hero-price mono">{fmtUsd(quote.price)}</span>
              <span className={`pi-hero-chg mono${up ? ' pi-pos' : ' pi-neg'}`}>
                {up ? '+' : ''}{quote.change.toFixed(2)}%
              </span>
            </span>
          )}
          <span className="pi-hero-ticker-ex">{FEATURED.exchange}</span>
          <span className="pi-hero-ticker-status">
            <span className="pi-status-dot" aria-hidden="true" />
            {t('privateMarkets.preIpo.hero.nowTrading')}
          </span>
        </div>

        <div className="pi-hero-stats">
          {quote?.marketCap > 0 && (
            <div className="pi-hero-stat">
              <div className="caption">{t('privateMarkets.preIpo.hero.marketCap')}</div>
              <div className="pi-hero-stat-value mono">{fmtMoney(quote.marketCap)}</div>
            </div>
          )}
          <div className="pi-hero-stat">
            <div className="caption">{t('privateMarkets.preIpo.hero.lastValuation')}</div>
            <div className="pi-hero-stat-value mono">{fmtMoney(entry.currentValuation)}</div>
          </div>
          {entry.totalRaised > 0 && (
            <div className="pi-hero-stat">
              <div className="caption">{t('privateMarkets.preIpo.hero.totalRaised')}</div>
              <div className="pi-hero-stat-value mono">{fmtMoney(entry.totalRaised)}</div>
            </div>
          )}
          {meta.founded && (
            <div className="pi-hero-stat">
              <div className="caption">{t('privateMarkets.preIpo.hero.founded')}</div>
              <div className="pi-hero-stat-value mono">{meta.founded}</div>
            </div>
          )}
          <div className="pi-hero-stat">
            <div className="caption">{t('privateMarkets.preIpo.hero.sector')}</div>
            <div className="pi-hero-stat-value pi-hero-stat-sector">{entry.sector}</div>
          </div>
        </div>

        {entry.investors?.length > 0 && (
          <div className="pi-hero-backers">
            <span className="caption pi-hero-backers-label">{t('privateMarkets.preIpo.hero.backers')}</span>
            <div className="pi-hero-chips">
              {entry.investors.slice(0, 5).map((inv) => (
                <span key={inv} className="pi-chip">{inv}</span>
              ))}
            </div>
          </div>
        )}

        <button type="button" className="btn-secondary pi-hero-cta" onClick={() => onOpen(entry)}>
          {t('privateMarkets.preIpo.hero.viewProfile', { company: entry.company })}
        </button>
      </div>

      <aside className="pi-hero-feed" aria-label={t('privateMarkets.preIpo.hero.live')}>
        <div className="pi-hero-feed-head">
          <span className="pi-hero-feed-title">
            <span className="pi-status-dot" aria-hidden="true" />
            {t('privateMarkets.preIpo.hero.live')}
          </span>
          <span className="pi-hero-feed-src">X Dash</span>
        </div>
        <div className="pi-hero-feed-scroll">
          {tweetsLoading && tweets.length === 0 && (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="pi-skel animate-shimmer" style={{ height: 92, borderRadius: 14 }} />
            ))
          )}
          {!tweetsLoading && tweets.length === 0 && (
            <div className="pi-hero-feed-empty caption">{t('privateMarkets.preIpo.hero.feedEmpty')}</div>
          )}
          {tweets.slice(0, 14).map((tw) => (
            <TweetCard key={tw.id} tweet={tw} compact />
          ))}
        </div>
      </aside>
      </div>

      {FEATURED.tvSymbol && (
        <div className="pi-hero-chart-wrap">
          <PreIpoChart symbol={FEATURED.tvSymbol} label={ticker} />
        </div>
      )}
    </section>
  )
}
