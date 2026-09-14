/**
 * HeroStory - Full-width premium hero story card.
 * Split layout: OG image (left) + text (right) when image exists.
 * Research articles get a generated editorial visual with token logos + topic tags.
 * Falls back to gradient placeholder when no image.
 * Props: article, prices (array of { symbol, price, change })
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { timeAgo, formatChange, getSourceInfo } from '../utils'
import { useCurrency } from '@/hooks/useCurrency'
import '../Intelligence.css'

const CATEGORY_COLORS = {
  bitcoin:    '#F7931A',
  ethereum:   '#627EEA',
  defi:       '#10B981',
  stocks:     '#3B82F6',
  macro:      '#F59E0B',
  regulation: '#EF4444',
  ai:         '#A855F7',
  markets:    '#8B5CF6',
  crypto:     '#8B5CF6',
  daily:      '#06B6D4',
  news:       '#EF4444',
  rwa:        '#EAB308',
  layer2:     '#06B6D4',
  stablecoin: '#10B981',
  research:   '#8B5CF6',
}

/* Topic tag extraction - pull key phrases from headline */
function extractTopicTags(headline, category) {
  const tags = []
  // Category as a tag
  const catMap = {
    rwa: 'Real World Assets',
    defi: 'DeFi',
    ai: 'AI & Compute',
    layer2: 'Layer 2',
    stablecoin: 'Stablecoins',
    bitcoin: 'Bitcoin',
    ethereum: 'Ethereum',
    macro: 'Macro',
  }
  if (catMap[category]) tags.push(catMap[category])

  // Extract keywords from headline
  const kw = headline.toLowerCase()
  if (/\brwa\b|tokeniz|real.?world/i.test(kw)) { if (!tags.includes('Real World Assets')) tags.push('Tokenization') }
  if (/\bdefi\b|yield|tvl|liquidity/i.test(kw)) { if (!tags.includes('DeFi')) tags.push('DeFi') }
  if (/\bai\b|compute|gpu/i.test(kw)) { if (!tags.includes('AI & Compute')) tags.push('AI') }
  if (/\bl2\b|layer.?2|rollup/i.test(kw)) { if (!tags.includes('Layer 2')) tags.push('L2 Scaling') }
  if (/\bstable/i.test(kw)) { if (!tags.includes('Stablecoins')) tags.push('Stablecoins') }
  if (/\bdepin\b|infrastructure/i.test(kw)) tags.push('Infrastructure')
  if (/\binstitution/i.test(kw)) tags.push('Institutional')
  if (/\bcompet|race|war|vs\b/i.test(kw)) tags.push('Competitive Analysis')
  if (/\bthesis\b|bull|bear/i.test(kw)) tags.push('Investment Thesis')
  if (/\bfirst wave|adoption/i.test(kw)) tags.push('Adoption Curve')

  return [...new Set(tags)].slice(0, 4)
}

function cleanHeadline(text) {
  if (!text) return ''
  return text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '')
}

function getCategoryColor(article) {
  const cat = (article.category || article.type || '').toLowerCase()
  return CATEGORY_COLORS[cat] || '#8B5CF6'
}

function getCategoryLabel(article) {
  const cat = article.category || article.type || 'Markets'
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

/* Get CoinGecko logo URL for a ticker */
function getTickerLogoUrl(ticker) {
  // Use CoinGecko static logos - works for major tokens
  const map = {
    BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
    ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
    SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
    ONDO: 'https://assets.coingecko.com/coins/images/26580/small/ONDO.png',
    ZIG: 'https://assets.coingecko.com/coins/images/14796/small/zignaly.png',
    CFG: 'https://assets.coingecko.com/coins/images/17106/small/centrifuge.png',
    MPL: 'https://assets.coingecko.com/coins/images/14174/small/maple.png',
    ARB: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
    OP: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
    RENDER: 'https://assets.coingecko.com/coins/images/11636/small/rndr.png',
    AKT: 'https://assets.coingecko.com/coins/images/12785/small/akash-logo.png',
    TAO: 'https://assets.coingecko.com/coins/images/28452/small/ARUsPeNQ_400x400.jpeg',
    HNT: 'https://assets.coingecko.com/coins/images/4284/small/Helium_HNT.png',
    ENA: 'https://assets.coingecko.com/coins/images/36530/small/ethena.png',
    MKR: 'https://assets.coingecko.com/coins/images/1364/small/Mark_Maker.png',
    LINK: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
    AVAX: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
    DOT: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
    BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  }
  return map[ticker] || null
}

export default function HeroStory({ article, prices = [] }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [imgError, setImgError] = useState(false)
  const { fmtPrice: formatPrice } = useCurrency()

  // The hero ROTATES every 8s through one mounted component, so `imgError`
  // was a latch: the first article whose image failed to load flipped it and
  // every later article rendered the gradient placeholder instead of its own
  // photo — for the rest of the session. Reset it whenever the article changes.
  const articleSlug = article?.slug
  useEffect(() => { setImgError(false) }, [articleSlug])

  if (!article) return null

  const slug = article.slug
  const type = article.type || 'news'
  const headline = cleanHeadline(article.headline || article.title)
  const summary = article.summary || ''
  const time = timeAgo(article.publishedAt, { t })
  const categoryColor = getCategoryColor(article)
  const categoryLabel = getCategoryLabel(article)
  const coverPhoto = article.coverImage || article.sourceArticle?.imageUrl || article.imageUrl || (slug ? `/api/hero/${slug}` : null)
  const hasPhoto = coverPhoto && !imgError
  const isResearch = type === 'research' || article.isResearch
  const showSplit = true
  const { isSpectre, sourceName } = getSourceInfo(article, { t })

  // Research-specific data
  const tickers = article.tickers || []
  const topicTags = isResearch ? extractTopicTags(headline, article.category) : []

  const handleClick = () => {
    if (slug) {
      navigate(`/intelligence/${type}/${slug}`)
    }
  }

  /* ── Research article generated visual ── */
  const renderResearchVisual = () => {
    const primaryTicker = tickers[0] || null
    const secondaryTickers = tickers.slice(1, 4)
    const accentColor = categoryColor

    return (
      <div
        className="st-hero__research-visual"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 30% 40%, ${accentColor}18 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 70% 60%, ${accentColor}0c 0%, transparent 50%),
            linear-gradient(160deg, #08070c 0%, #0c0a12 30%, #080610 60%, #040308 100%)
          `,
        }}
      >
        {/* Decorative grid pattern */}
        <div className="st-hero__research-grid" />

        {/* Floating accent orbs */}
        <div className="st-hero__research-orb st-hero__research-orb--1" style={{ background: `${accentColor}15` }} />
        <div className="st-hero__research-orb st-hero__research-orb--2" style={{ background: `${accentColor}0a` }} />

        {/* Token logos cluster */}
        <div className="st-hero__research-logos">
          {primaryTicker && (
            <div className="st-hero__research-logo st-hero__research-logo--primary">
              <img
                src={getTickerLogoUrl(primaryTicker)}
                alt={primaryTicker}
                onError={(e) => { e.target.style.display = 'none' }}
              />
              <span className="st-hero__research-logo-label">{primaryTicker}</span>
            </div>
          )}
          {secondaryTickers.map((t, i) => (
            <div key={t} className="st-hero__research-logo st-hero__research-logo--secondary" style={{ animationDelay: `${i * 0.3}s` }}>
              <img
                src={getTickerLogoUrl(t)}
                alt={t}
                onError={(e) => { e.target.style.display = 'none' }}
              />
            </div>
          ))}
        </div>

        {/* Topic tags */}
        <div className="st-hero__research-tags">
          {topicTags.map((tag) => (
            <span key={tag} className="st-hero__research-tag" style={{ borderColor: `${accentColor}30`, color: `${accentColor}cc` }}>
              {tag}
            </span>
          ))}
        </div>

        {/* Bottom label */}
        <div className="st-hero__research-badge">
          <span className="st-hero__research-badge-dot" style={{ background: accentColor }} />
          <span>{t('intelligencePage.spectreResearch', 'SPECTRE RESEARCH')}</span>
        </div>
      </div>
    )
  }

  const isBreaking = article.isBreaking
  const sentiment = article.sentiment

  return (
    <article
      className={`st-hero${showSplit ? ' st-hero--has-image' : ''}${isBreaking ? ' st-hero--breaking' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      <div className="st-hero__inner">
        {/* Left side - real photo, generated research visual, or gradient placeholder */}
        {showSplit && (
          <div className="st-hero__image">
            {hasPhoto ? (
              <img
                src={coverPhoto}
                alt={headline}
                loading="eager"
                onError={() => setImgError(true)}
              />
            ) : isResearch ? (
              renderResearchVisual()
            ) : (
              <div
                className="st-hero__gradient"
                style={{
                  background: `linear-gradient(135deg, ${categoryColor}22 0%, ${categoryColor}08 40%, rgba(0,0,0,0.3) 100%)`,
                }}
              >
                <div className="st-hero__gradient-label">
                  <span className="st-hero__gradient-icon">◆</span>
                  <span>{t('intelligencePage.spectreUpper', 'SPECTRE')}</span>
                </div>
                <div className="st-hero__gradient-category" style={{ color: categoryColor }}>
                  {categoryLabel.toUpperCase()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Text content - right side */}
        <div className="st-hero__text">
          {/* Breaking badge or category badge */}
          {isBreaking ? (
            <div className="st-hero__breaking-badge">
              <span className="st-hero__breaking-dot" />
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>
              {t('intelligencePage.breakingUpper', 'BREAKING')}
              {sentiment && (
                <span className={`st-hero__breaking-sentiment st-hero__breaking-sentiment--${sentiment}`}>
                  {sentiment === 'bullish' ? '\u25B2' : sentiment === 'bearish' ? '\u25BC' : '\u2013'} {
                    sentiment === 'bullish'
                      ? t('intelligencePage.sentimentBullish')
                      : sentiment === 'bearish'
                        ? t('intelligencePage.sentimentBearish')
                        : t('intelligencePage.sentimentNeutral')
                  }
                </span>
              )}
            </div>
          ) : (
          <div className="st-hero__category">
            <span
              className="st-hero__category-square"
              style={{ background: categoryColor }}
              aria-hidden="true"
            />
            <span className="st-hero__category-label">
              {isResearch ? t('intelligencePage.spectreResearch', 'SPECTRE RESEARCH') : categoryLabel.toUpperCase()}
            </span>
          </div>
          )}

          {/* Headline */}
          <h2 className="st-hero__headline">{headline}</h2>

          {/* Summary */}
          {summary && (
            <p className="st-hero__summary">{summary}</p>
          )}

          {/* Bottom row: meta + prices */}
          <div className="st-hero__bottom">
            <div className="st-hero__meta">
              <span className="st-hero__time">{time}</span>
              <span className="st-hero__separator" aria-hidden="true" />
              <span className={`st-source-badge ${isSpectre ? 'st-source-badge--spectre' : 'st-source-badge--external'}`}>
                {isSpectre ? '★ Spectre AI' : t('intelligencePage.viaSource', { source: sourceName })}
              </span>
            </div>

            {prices.length > 0 && (
              <div className="st-hero__prices" onClick={e => e.stopPropagation()}>
                {prices.map(p => (
                  <div className="st-hero__price-item" key={p.symbol}>
                    <span className="st-hero__price-symbol">{p.symbol}</span>
                    <span className="st-hero__price-value">{formatPrice(p.price)}</span>
                    <span
                      className={`st-hero__price-change ${
                        p.change > 0 ? 'st-hero__price-change--up' : p.change < 0 ? 'st-hero__price-change--down' : ''
                      }`}
                    >
                      {formatChange(p.change)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
