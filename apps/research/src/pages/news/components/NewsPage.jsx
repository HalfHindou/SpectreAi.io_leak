/**
 * Spectre News — Perplexity Discover-inspired aggregator
 * Broad tech / science / business / world news hub.
 * Crypto is ONE category, not the focus (Intelligence handles crypto depth).
 */
import { useState, useEffect, useCallback, useMemo, useRef, memo, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { useNavigate } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { getCryptoNews, getRssMarketNews } from '@/services/cryptoNewsApi'
import { getFearGreedCurrent } from '@/services/fearGreedApi'
import { getSpectreNews, getSpectrePricesBySymbols } from '@/services/spectreMarketApi'
import { decodeHtmlEntities } from '@/utils/html'
import { hashStr as _hashStr, wireImage, MACRO_POSTERS, macroPoster, WIRE_KINDS, WIRE_SHOCK_MIN } from './wire-art'
export { wireImage, MACRO_POSTERS, macroPoster, WIRE_KINDS, WIRE_SHOCK_MIN }
import NewsCategoryTabs from './NewsCategoryTabs'
// NewsSidebar is hidden on mobile and not on the LCP path (the hero + first
// grid row is). Lazy-loading splits its ~9 KB of SVG icons + chrome out of
// the main page chunk and lets the hero paint without waiting on it.
const NewsSidebar = lazy(() => import('./NewsSidebar'))
import MobileBackButton from '@/components/mobile-back-button'
import './news-page.css'
import './news-page.mobile.css'

/* ═══════════════════════════════════════════════════
   SOURCE LOGOS — Google Favicon Service
   ═══════════════════════════════════════════════════ */

const SOURCE_LOGOS = {
  // Spectre's own desk — the app icon, not a favicon fetch
  'spectre macro wire': '/favicon-32x32.png',
  // Tech / General
  'techcrunch': 'https://www.google.com/s2/favicons?domain=techcrunch.com&sz=32',
  'the verge': 'https://www.google.com/s2/favicons?domain=theverge.com&sz=32',
  'ars technica': 'https://www.google.com/s2/favicons?domain=arstechnica.com&sz=32',
  'wired': 'https://www.google.com/s2/favicons?domain=wired.com&sz=32',
  'mit technology review': 'https://www.google.com/s2/favicons?domain=technologyreview.com&sz=32',
  'engadget': 'https://www.google.com/s2/favicons?domain=engadget.com&sz=32',
  'bbc': 'https://www.google.com/s2/favicons?domain=bbc.com&sz=32',
  'cnn': 'https://www.google.com/s2/favicons?domain=cnn.com&sz=32',
  'reuters': 'https://www.google.com/s2/favicons?domain=reuters.com&sz=32',
  'associated press': 'https://www.google.com/s2/favicons?domain=apnews.com&sz=32',
  'new york times': 'https://www.google.com/s2/favicons?domain=nytimes.com&sz=32',
  'guardian': 'https://www.google.com/s2/favicons?domain=theguardian.com&sz=32',
  'nature': 'https://www.google.com/s2/favicons?domain=nature.com&sz=32',
  'science': 'https://www.google.com/s2/favicons?domain=science.org&sz=32',
  'new scientist': 'https://www.google.com/s2/favicons?domain=newscientist.com&sz=32',
  // Business / Finance
  'bloomberg': 'https://www.google.com/s2/favicons?domain=bloomberg.com&sz=32',
  'cnbc': 'https://www.google.com/s2/favicons?domain=cnbc.com&sz=32',
  'wall street journal': 'https://www.google.com/s2/favicons?domain=wsj.com&sz=32',
  'financial times': 'https://www.google.com/s2/favicons?domain=ft.com&sz=32',
  'marketwatch': 'https://www.google.com/s2/favicons?domain=marketwatch.com&sz=32',
  'yahoo': 'https://www.google.com/s2/favicons?domain=finance.yahoo.com&sz=32',
  'benzinga': 'https://www.google.com/s2/favicons?domain=benzinga.com&sz=32',
  'investing.com': 'https://www.google.com/s2/favicons?domain=investing.com&sz=32',
  'seeking alpha': 'https://www.google.com/s2/favicons?domain=seekingalpha.com&sz=32',
  // Crypto (one vertical, not the focus)
  'coindesk': 'https://www.google.com/s2/favicons?domain=coindesk.com&sz=32',
  'cointelegraph': 'https://www.google.com/s2/favicons?domain=cointelegraph.com&sz=32',
  'the block': 'https://www.google.com/s2/favicons?domain=theblock.co&sz=32',
  'decrypt': 'https://www.google.com/s2/favicons?domain=decrypt.co&sz=32',
  'blockworks': 'https://www.google.com/s2/favicons?domain=blockworks.co&sz=32',
  'cryptoslate': 'https://www.google.com/s2/favicons?domain=cryptoslate.com&sz=32',
  'u.today': 'https://www.google.com/s2/favicons?domain=u.today&sz=32',
  'ambcrypto': 'https://www.google.com/s2/favicons?domain=ambcrypto.com&sz=32',
  'beincrypto': 'https://www.google.com/s2/favicons?domain=beincrypto.com&sz=32',
  'bitcoinist': 'https://www.google.com/s2/favicons?domain=bitcoinist.com&sz=32',
  'newsbtc': 'https://www.google.com/s2/favicons?domain=newsbtc.com&sz=32',
  'dailyhodl': 'https://www.google.com/s2/favicons?domain=dailyhodl.com&sz=32',
  'cryptopotato': 'https://www.google.com/s2/favicons?domain=cryptopotato.com&sz=32',
  'spectre': 'https://www.google.com/s2/favicons?domain=spectre.app&sz=32',
  'finnhub': 'https://www.google.com/s2/favicons?domain=finnhub.io&sz=32',
  // Additional sources
  'daily hodl': 'https://www.google.com/s2/favicons?domain=dailyhodl.com&sz=32',
  'oilprice': 'https://www.google.com/s2/favicons?domain=oilprice.com&sz=32',
  'science daily': 'https://www.google.com/s2/favicons?domain=sciencedaily.com&sz=32',
  'yahoo finance': 'https://www.google.com/s2/favicons?domain=finance.yahoo.com&sz=32',
  'the defiant': 'https://www.google.com/s2/favicons?domain=thedefiant.io&sz=32',
  'the tokenist': 'https://www.google.com/s2/favicons?domain=tokenist.com&sz=32',
  'tokenist': 'https://www.google.com/s2/favicons?domain=tokenist.com&sz=32',
  'protos': 'https://www.google.com/s2/favicons?domain=protos.com&sz=32',
  'bitcoin.com': 'https://www.google.com/s2/favicons?domain=news.bitcoin.com&sz=32',
  'coingape': 'https://www.google.com/s2/favicons?domain=coingape.com&sz=32',
  'fortune': 'https://www.google.com/s2/favicons?domain=fortune.com&sz=32',
  'pymnts': 'https://www.google.com/s2/favicons?domain=pymnts.com&sz=32',
  'crowdfund insider': 'https://www.google.com/s2/favicons?domain=crowdfundinsider.com&sz=32',
}

function getSourceLogo(sourceName) {
  if (!sourceName) return null
  const lower = sourceName.toLowerCase().trim()
  // Guard against empty post-trim source (e.g. " ") — JS `'any'.includes('')`
  // returns true, so an empty lower would match the first key and stamp the
  // wrong favicon on every empty-source card (same class as the CPI bug).
  if (!lower) return null
  if (SOURCE_LOGOS[lower]) return SOURCE_LOGOS[lower]
  for (const [key, url] of Object.entries(SOURCE_LOGOS)) {
    if (!key) continue
    if (lower.includes(key) || key.includes(lower)) return url
  }
  const domainMatch = sourceName.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,})/i)
  if (domainMatch) return `https://www.google.com/s2/favicons?domain=${domainMatch[1]}&sz=32`
  return null
}

/* ── Helpers ── */

function timeAgo(dateStr, t, locale) {
  if (!dateStr) return ''
  const now = Date.now()
  const then = typeof dateStr === 'number'
    ? (dateStr > 1e12 ? dateStr : dateStr * 1000)
    : new Date(dateStr).getTime()
  if (!then || isNaN(then)) return ''
  const diff = Math.max(0, now - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t ? t('news.time.justNow', 'Just now') : 'Just now'
  if (mins < 60) return t ? t('news.time.minutesAgo', { count: mins, defaultValue: '{{count}}m ago' }) : `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t ? t('news.time.hoursAgo', { count: hrs, defaultValue: '{{count}}h ago' }) : `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return t ? t('news.time.daysAgo', { count: days, defaultValue: '{{count}}d ago' }) : `${days}d ago`
  return new Date(then).toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric' })
}

function fetchWithTimeout(url, ms = 5000) {
  const c = new AbortController()
  const id = setTimeout(() => c.abort(), ms)
  return fetch(url, { signal: c.signal }).finally(() => clearTimeout(id))
}

async function fetchJson(url) {
  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

/* ═══════════════════════════════════════════════════
   CLASSIFIERS — Broad topic classification
   ═══════════════════════════════════════════════════ */

const AI_KW = /\b(artificial intelligence|openai|chatgpt|gpt-?[45o]|claude|gemini|deepseek|llm|machine learning|neural|deep learning|transformer|generative ai|gen\s?ai|ai model|ai agent|anthropic|midjourney|stable diffusion|copilot)\b/i
const TECH_KW = /\b(apple|google|microsoft|amazon|meta|nvidia|samsung|iphone|android|software|hardware|startup|silicon valley|semiconductor|chip|processor|cloud|saas|cybersecurity|hack|data breach|privacy|browser|app store|developer|api|robotics|autonomous|ev|electric vehicle|tesla|spacex|rivian|waymo|self.driving|5g|6g|wearable|smartwatch|headphone|laptop|tablet|pc|desktop|phone|gadget|display|oled|sensor|drone|3d print|virtual reality|vr|augmented reality|ar|streaming|tiktok|youtube|instagram|social media|app|firmware|update|patch|vulnerability|ios|macos|windows|linux|open.?source)\b/i
const SCIENCE_KW = /\b(nasa|space|mars|moon|telescope|crispr|genome|gene|physics|quantum|fusion|climate|environment|ocean|species|evolution|research|discovery|journal|peer.review|lab|experiment|vaccine|biology|chemistry|neuroscience)\b/i
const BUSINESS_KW = /\b(acquisition|merger|ipo|revenue|quarterly|earnings|startup|venture capital|funding|valuation|layoff|hire|ceo|cfo|executive|corporate|partnership|supply chain|logistics|retail|e-?commerce)\b/i
const FINANCE_KW = /\b(fed|federal reserve|rate|inflation|gdp|cpi|treasury|yields?|bonds?|recession|unemployment|tariff|stocks?|s&p|nasdaq|dow|index|market|bull|bear|rally|correction|etf|mutual fund|hedge fund|wall street)\b/i
const WORLD_KW = /\b(geopolit|sanctions?|trade war|election|diplomacy|united nations|nato|war|conflict|refugee|immigration|treaty|summit|bilateral|embassy|foreign policy|middle east|europe|asia|africa|latin america)\b/i
const CRYPTO_KW = /\b(bitcoin|btc|ethereum|eth|solana|sol|crypto|blockchain|defi|nft|web3|token|altcoin|memecoin|stablecoin|usdt|usdc|binance|coinbase|mining|halving|layer.?2|airdrop|dex|dao)\b/i
const HEALTH_KW = /\b(health|medical|pharma|drug|fda|clinical trial|cancer|diabetes|mental health|hospital|surgeon|therapy|diagnosis|patient|disease|epidemic|pandemic)\b/i
const ENERGY_KW = /\b(oil|crude|opec|natural gas|solar|wind|renewable|nuclear|battery|grid|electricity|fossil fuel|carbon|emission|net.zero|sustainability)\b/i
const TOKENIZED_KW = /\b(tokeniz\w*\s+(equit\w*|securit\w*|stock\w*|bond\w*|share\w*|asset\w*|fund\w*|treasur\w*|deposit\w*|trading|money\s+market)|security\s+token\w*|\bsto\b|digital\s+securit\w*|on.?chain\s+(equit\w*|securit\w*|stock\w*|bond\w*|asset\w*|perpetual|s&p|nasdaq|futures)|equity\s+token\w*|nasdaq\s+token\w*|securitize|polymesh|polymath|tzero|t.?zero|backed\s+token\w*|digital\s+asset\s+(exchange|bill|regulat\w*|framework|legislation|act)|tokenized\s+(fund|etf|index)|fractionali[sz]\w*\s+(asset|share|ownership|equit|real\s+estate|stock)|crypto\s+etf\s+(option|approv\w*|launch|list\w*|trading)|bitcoin\s+etf\s+(option|approv\w*|launch|list\w*|trading)|ethereum\s+etf|(nyse|nasdaq|cboe)\s+.{0,15}(crypto|etf|token|digital)|s&p\s+500\s+.{0,20}(perpetual|on.?chain|token|futures|defi)|on.?chain\s+.{0,15}(perpetual|derivative|futures|trading))/i
const RWA_KW = /\b(real.?world\s+asset\w*|\brwa\s|tokeniz\w*\s+(real\s+estate|commodit\w*|gold|property|art\b|carbon\s+credit\w*|debt\w*|treasur\w*)|asset\s+tokeniz\w*|tokenization\b|centrifuge|maple\s+finance|goldfinch|ondo\s+finance|backed\s+finance|clearpool|truefi|\bbuidl\b|blackrock\s+.{0,15}(token|fund|buidl|digital|crypto)|jpmorgan\s+.{0,10}(onyx|token|crypto|digital)|franklin\s+templeton|makerdao\s+rwa|private\s+credit\s+.{0,15}(on.?chain|token|protocol|defi)|stablecoin\w*\s+(yield|backing|reserve|bill|legislation|regulat\w*|framework|law|spending|integration|payment)|stablecoin\w*.{0,20}(usdc|usdt|pyusd|regulation|bill|act|framework)|digital\s+bond\w*|programmable\s+money|mantra\s+chain|ethena|superstate|hashnote|matrixdock|paxos\s+gold|tether\s+gold|tradfi\b|institutional\s+(crypto|defi|digital\s+asset|adoption|inflow\w*)|crypto\s+etf\s+(inflow|outflow)|bitcoin\s+etf\s+(inflow|outflow)|(crypto|bitcoin|ethereum)\s+.{0,10}(institutional|custody|custod\w*)|market\s+structure\s+bill|digital\s+asset\s+bill|crypto\s+regulat\w*\s+(bill|act|framework|legislation)|stablecoin\s+(act|bill|law)|redotpay|crypto\s+.{0,10}(ipo|credit\s+card|debit\s+card|payment)|cbdc|digital\s+(dollar|euro|currency|pound)|crypto\s+.{0,10}(compliance|licens\w*|custody)|bitcoin.{0,10}property|sec\s+.{0,20}(crypto|digital\s+asset|token|nft|securit\w*\s+law)|nft\w*\s+.{0,10}securit\w*\s+law|crypto\s+(pac|lobby|political|campaign)|fairshake|crypto\s+.{0,10}(atm|ban|restrict)|bitcoin\s+(atm|property|legal|status)|usdc\s+(integrat|payment|merchant)|stablecoin\s+(spend|merchant|checkout|commerce)|visa\s+.{0,10}crypto|mastercard\s+.{0,10}(crypto|stablecoin|digital)|paypal\s+.{0,10}(crypto|stablecoin|pyusd)|stripe\s+.{0,10}(crypto|stablecoin)|crypto\s+.{0,10}(wallet|card)\s+.{0,10}(payment|spend|merchant)|convertible\s+note|crypto\s+credit)/i

function classifyCategory(item) {
  const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase()
  // Tokenized Assets and RWA checked first — they're specific niches that would otherwise
  // get swallowed by broader crypto/finance classifiers
  if (TOKENIZED_KW.test(text)) return 'tokenized-assets'
  if (RWA_KW.test(text)) return 'rwa'
  if (AI_KW.test(text)) return 'ai'
  if (TECH_KW.test(text)) return 'tech'
  if (SCIENCE_KW.test(text)) return 'science'
  if (CRYPTO_KW.test(text)) return 'crypto'
  if (WORLD_KW.test(text)) return 'world'
  if (BUSINESS_KW.test(text)) return 'business'
  if (FINANCE_KW.test(text)) return 'finance'
  if (ENERGY_KW.test(text)) return 'energy'
  if (HEALTH_KW.test(text)) return 'health'
  // Default based on source type
  if (item.sourceType === 'stocks') return 'finance'
  if (item.sourceType === 'crypto') return 'crypto'
  if (item.sourceType === 'general') return 'tech'
  return 'tech'
}

/* ── Placeholder images — multiple variants per category to avoid repetition ── */
const PLACEHOLDER_VARIANTS = {
  tech: [
    'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=600&h=400&fit=crop',
  ],
  ai: [
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1655720828018-edd2daec9349?w=600&h=400&fit=crop',
  ],
  science: [
    'https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1564325724739-bae0bd08762c?w=600&h=400&fit=crop',
  ],
  business: [
    'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=400&fit=crop',
  ],
  finance: [
    'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1559589689-577aabd1db4f?w=600&h=400&fit=crop',
  ],
  world: [
    'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1526470608268-f674ce90ebd4?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1457464901128-7f773ae27e4f?w=600&h=400&fit=crop',
  ],
  crypto: [
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=600&h=400&fit=crop',
  ],
  health: [
    'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1559757175-5700dde675bc?w=600&h=400&fit=crop',
  ],
  energy: [
    'https://images.unsplash.com/photo-1509391366360-2e959784a276?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?w=600&h=400&fit=crop',
  ],
  space: [
    'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1462332420958-a05d1e002413?w=600&h=400&fit=crop',
  ],
  'tokenized-assets': [
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1642790106117-e829e14a795f?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=400&fit=crop',
  ],
  rwa: [
    'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1582407947092-5e56721ebc0a?w=600&h=400&fit=crop',
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&h=400&fit=crop',
  ],
  // wire fallback = the branded glass posters (never a broken image)
  macro: [
    '/images/wire/rates.svg',
    '/images/wire/market.svg',
    '/images/wire/geo.svg',
  ],
}

// Default placeholder per category (first variant)
const PLACEHOLDER_IMAGES = Object.fromEntries(
  Object.entries(PLACEHOLDER_VARIANTS).map(([k, v]) => [k, v[0]])
)
// Deterministic hash so the same article always maps to the same placeholder.
// A module-level counter caused image churn on every render / poll cycle.
function pickPlaceholder(category, key = '') {
  const variants = PLACEHOLDER_VARIANTS[category] || PLACEHOLDER_VARIANTS.tech
  return variants[_hashStr(String(key)) % variants.length]
}

function safeNewsImageUrl(url) {
  if (!url) return null
  return url
}

/* ═══════════════════════════════════════════════════
   SOURCE NAME CLEANUP — domain → friendly name
   ═══════════════════════════════════════════════════ */

const SOURCE_CLEAN_NAMES = {
  'techcrunch.com': 'TechCrunch',
  'feeds.arstechnica.com': 'Ars Technica',
  'arstechnica.com': 'Ars Technica',
  'feeds.wired.com': 'Wired',
  'wired.com': 'Wired',
  'theverge.com': 'The Verge',
  'feeds.feedburner.com': 'TechCrunch',
  'bbc.com': 'BBC',
  'cnn.com': 'CNN',
  'reuters.com': 'Reuters',
  'apnews.com': 'Associated Press',
  'nytimes.com': 'New York Times',
  'theguardian.com': 'The Guardian',
  'nature.com': 'Nature',
  'science.org': 'Science',
  'theblock.co': 'The Block',
  'decrypt.co': 'Decrypt',
  'blockworks.co': 'Blockworks',
  'cryptoslate.com': 'CryptoSlate',
  'beincrypto.com': 'BeInCrypto',
  'bitcoinist.com': 'Bitcoinist',
  'u.today': 'U.Today',
  'dailyhodl.com': 'Daily Hodl',
  'cryptopotato.com': 'CryptoPotato',
  'engadget.com': 'Engadget',
  'technologyreview.com': 'MIT Technology Review',
  'cnbc.com': 'CNBC',
  'marketwatch.com': 'MarketWatch',
  'finance.yahoo.com': 'Yahoo Finance',
  'investing.com': 'Investing.com',
  'sciencedaily.com': 'Science Daily',
  'newscientist.com': 'New Scientist',
  'oilprice.com': 'OilPrice',
  'thedefiant.io': 'The Defiant',
  'tokenist.com': 'The Tokenist',
  'protos.com': 'Protos',
  'news.bitcoin.com': 'Bitcoin.com',
  'bitcoin.com': 'Bitcoin.com',
  'ambcrypto.com': 'AMBCrypto',
  'coingape.com': 'CoinGape',
  'newsbtc.com': 'NewsBTC',
  'fortune.com': 'Fortune',
  'pymnts.com': 'PYMNTS',
  'crowdfundinsider.com': 'Crowdfund Insider',
}

const CRYPTO_SOURCES = new Set([
  'coindesk', 'cointelegraph', 'the block', 'decrypt', 'blockworks',
  'cryptoslate', 'u.today', 'ambcrypto', 'beincrypto', 'bitcoinist',
  'newsbtc', 'dailyhodl', 'cryptopotato', 'bitcoin world', 'bitcoin.com',
  'cryptopanic', 'cryptobriefing', 'coingape',
])

function cleanSourceName(raw) {
  if (!raw) return 'News'
  const lower = raw.toLowerCase().trim()
  if (SOURCE_CLEAN_NAMES[lower]) return SOURCE_CLEAN_NAMES[lower]
  // Already a proper name (not a domain)
  if (!lower.includes('.')) return raw
  // Try to extract domain and check
  for (const [domain, name] of Object.entries(SOURCE_CLEAN_NAMES)) {
    if (lower.includes(domain)) return name
  }
  // Capitalize domain-style names: "techcrunch.com" → "TechCrunch"
  const parts = lower.replace(/^(feeds?|www)\./, '').split('.')
  if (parts[0]) return parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
  return raw
}

function isCryptoSource(source) {
  if (!source) return false
  const lower = source.toLowerCase().trim()
  for (const cs of CRYPTO_SOURCES) {
    if (lower.includes(cs) || cs.includes(lower)) return true
  }
  return false
}

/* ═══════════════════════════════════════════════════
   NORMALIZERS
   ═══════════════════════════════════════════════════ */

// Stable fallback id from url + publishedAt so re-normalizing the same article
// across polls keeps the same React key. Math.random() here caused the full
// list to remount every 2-min poll.
function stableFallbackId(prefix, item) {
  const base = `${item.url || ''}|${item.title || ''}|${item.publishedOn || ''}`
  let h = 0
  for (let i = 0; i < base.length; i++) h = ((h << 5) - h + base.charCodeAt(i)) | 0
  return `${prefix}-${(h >>> 0).toString(36)}`
}

function normalizeCryptoItem(item) {
  const ts = item.publishedOn
    ? (item.publishedOn > 1e12 ? new Date(item.publishedOn).toISOString() : new Date(item.publishedOn * 1000).toISOString())
    : new Date().toISOString()
  const base = {
    id: item.id || stableFallbackId('c', item),
    title: decodeHtmlEntities(item.title || ''),
    summary: decodeHtmlEntities(item.summary || ''),
    source: item.source || 'Crypto',
    sourceType: 'crypto',
    url: item.url || '#',
    imageUrl: safeNewsImageUrl(item.imageUrl),
    publishedAt: ts,
    isSpectre: false, slug: null,
  }
  base.category = classifyCategory(base)
  if (!base.imageUrl) base.imageUrl = pickPlaceholder(base.category, base.url || base.title || base.id)
  return base
}

function normalizeRssItem(item) {
  const ts = item.publishedOn
    ? (item.publishedOn > 1e12 ? new Date(item.publishedOn).toISOString() : new Date(item.publishedOn * 1000).toISOString())
    : new Date().toISOString()
  const rawSource = item.source || 'RSS'
  const source = cleanSourceName(rawSource)
  const crypto = isCryptoSource(rawSource) || isCryptoSource(source)
  const base = {
    id: item.id || stableFallbackId('rss', item),
    title: decodeHtmlEntities(item.title || ''),
    summary: decodeHtmlEntities(item.summary || ''),
    source,
    sourceType: crypto ? 'crypto' : 'general',
    url: item.url || '#',
    imageUrl: safeNewsImageUrl(item.imageUrl),
    publishedAt: ts,
    isSpectre: false, slug: null,
  }
  base.category = classifyCategory(base)
  if (!base.imageUrl) base.imageUrl = pickPlaceholder(base.category, base.url || base.title || base.id)
  return base
}

/* ── Instant-paint cache ──
 * Persist a lean snapshot of the rendered list so a cold boot can paint rows
 * immediately. Rows carry no article bodies — the reader fetches full content
 * on demand — so we strip `content` to keep the payload small. Capped to keep
 * localStorage light. All access is try/catch-guarded (private mode / quota).
 */
const NEWS_CACHE_KEY = 'sn-news-cache'
const NEWS_CACHE_MAX = 60

function readNewsCache() {
  try {
    const raw = localStorage.getItem(NEWS_CACHE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

// 🪤 The seed cache is written AFTER diversityInterleave, which puts every
// Spectre original first — so once the editorial feed is healthy (60+ originals)
// the 60-item cap consumed the whole cache and NOT ONE Macro Wire item was
// kept. Every cold paint of /news then showed an empty Macro Wire tab until the
// network fetch landed, and stayed empty if it failed. The wire is its own
// source on its own tab; it gets its own reserved slice of the cache rather
// than competing with the editorial feed for the top of one list.
const NEWS_CACHE_WIRE_MIN = 20
function writeNewsCache(items) {
  try {
    const all = items || []
    const wire = all.filter((n) => n.isMacroWire)
    const rest = all.filter((n) => !n.isMacroWire)
    const wireKeep = wire.slice(0, Math.min(NEWS_CACHE_WIRE_MIN, wire.length))
    const restKeep = rest.slice(0, Math.max(0, NEWS_CACHE_MAX - wireKeep.length))
    // preserve the feed's own ordering — reserving the slots must not reorder
    const keep = new Set([...wireKeep, ...restKeep])
    const lean = all.filter((n) => keep.has(n)).map(({ content, ...rest2 }) => rest2)
    localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(lean))
  } catch {}
}

function normalizeSpectreItem(item) {
  const base = {
    id: item.slug || stableFallbackId('sp', item),
    title: decodeHtmlEntities(item.headline || item.title || ''),
    summary: decodeHtmlEntities(item.summary || ''),
    source: item.sourceArticle?.source || item.source || 'Spectre AI',
    sourceType: item.category === 'stocks' ? 'stocks' : 'crypto',
    url: item.sourceArticle?.url || item.url || '#',
    imageUrl: safeNewsImageUrl(item.imageUrl || item.sourceArticle?.imageUrl || item.ogImage),
    publishedAt: item.publishedAt || new Date().toISOString(),
    isSpectre: true, slug: item.slug || null, type: item.type || 'news',
    sentiment: item.sentiment || null, content: item.content || null,
  }
  base.category = classifyCategory(base)
  if (!base.imageUrl) base.imageUrl = pickPlaceholder(base.category, base.url || base.title || base.id)
  return base
}

/* ── Macro Wire (global macro desk — the feed behind the TG 🌍 Macro Shock alerts) ──
 * Items come from /data-api/v1/news/tradfi (macro_news ledger). Headlines are
 * rewritten by the macro desk in Spectre's own voice — there is NO external
 * source URL by design, so these articles read internally at /news/mw-<event_key>.
 * Category is forced to 'macro' (never classified), which keeps the wire on its
 * own tab and its own interleave bucket. */

export function normalizeMacroWireItem(item) {
  const key = item.event_key || `${item.headline || ''}:${item.ts || ''}`
  const kind = WIRE_KINDS[String(item.category || '').toLowerCase()] || WIRE_KINDS.macro
  // Lane = the TG alert vocabulary users already know (🌍 Macro Shock /
  // ⚡️ Breaking); routine stories carry just their kind.
  const imp = Number.isFinite(item.importance) ? item.importance : null
  const lane = imp >= WIRE_SHOCK_MIN
    ? { label: 'Macro Shock', color: '#EF4444' }
    : imp >= 70 ? { label: 'Breaking', color: '#F59E0B' } : null
  return {
    kindLabel: kind.label,
    kindColor: kind.color,
    laneLabel: lane?.label || null,
    laneColor: lane?.color || null,
    id: `mw-${key}`,
    title: decodeHtmlEntities(item.headline || ''),
    summary: decodeHtmlEntities(item.context || ''),
    content: item.context || null,
    source: 'Spectre Macro Wire',
    sourceType: 'macro',
    url: null,
    imageUrl: wireImage(item.headline, item.category, key),
    publishedAt: item.source_ts || item.ts || new Date().toISOString(),
    isSpectre: false,
    isMacroWire: true,
    category: 'macro',
    sentiment: item.sentiment || null,
    importance: Number.isFinite(item.importance) ? item.importance : null,
    assets: Array.isArray(item.assets) ? item.assets : [],
    wireCategory: item.category || null,
  }
}

export async function fetchMacroWire({ hours = 168, limit = 50 } = {}) {
  try {
    // order=recent → chronological wire (the default importance-ranked order
    // returns the week's top-50 biggest stories, which reads as a wall of
    // near-identical impact scores and buries the freshest headlines)
    const res = await fetch(`/data-api/v1/news/tradfi?hours=${hours}&limit=${limit}&order=recent`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return []
    const json = await res.json()
    const rows = Array.isArray(json?.data) ? json.data : []
    return rows.filter(r => r && r.headline).map(normalizeMacroWireItem)
  } catch { return [] }
}

/* ── Dedup ── */
function normalizeTitle(t) { return (t || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 80) }

function deduplicateNews(items) {
  const seen = new Map()
  const out = []
  for (const item of items) {
    const key = normalizeTitle(item.title)
    if (!key || key.length < 10) continue
    const shortKey = key.slice(0, 50)
    if (seen.has(shortKey)) {
      const existing = seen.get(shortKey)
      if (!existing.imageUrl && item.imageUrl) {
        const idx = out.indexOf(existing)
        if (idx >= 0) out[idx] = item
        seen.set(shortKey, item)
      }
      continue
    }
    seen.set(shortKey, item)
    out.push(item)
  }
  return out
}

/* ── Trending — broad topics ── */
const TOPIC_KW = {
  'Artificial Intelligence': /\bartificial intelligence|openai|chatgpt|gpt|claude|gemini|llm|gen\s?ai\b/i,
  'Apple': /\bapple|iphone|ios|mac|wwdc\b/i,
  'Google': /\bgoogle|alphabet|android|pixel|gemini|deepmind\b/i,
  'Microsoft': /\bmicrosoft|windows|azure|copilot\b/i,
  'Nvidia': /\bnvidia|gpu|cuda|jensen\b/i,
  'Tesla': /\btesla|elon\s?musk|spacex\b/i,
  'Climate': /\bclimate|global warming|carbon|net.zero|renewable\b/i,
  'Space': /\bnasa|spacex|space|mars|artemis|rocket|satellite\b/i,
  'Bitcoin': /\bbitcoin|btc\b/i,
  'Federal Reserve': /\bfed(eral reserve)?|fomc|rate\s(cut|hike)\b/i,
  'Cybersecurity': /\bcyber|hack|breach|ransomware|security\b/i,
  'Quantum': /\bquantum\s(comput|processor|chip|supremacy)\b/i,
  'Tokenized Assets': /\btokeniz\w*\s(equit|securit|stock|bond|asset|fund)|security\stoken|digital\ssecurit|securitize|fractionali[sz]/i,
  'RWA': /\breal.world\sasset|rwa\b|asset\stokeniz|tokenization\b|ondo\b|centrifuge|buidl\b|blackrock.+token|on.chain\s(treasur|bond|credit|fund|yield)|private\scredit.+(on.chain|defi|token)/i,
}

function extractTrending(items) {
  const counts = {}
  for (const item of items) {
    const text = `${item.title} ${item.summary}`
    for (const [topic, rx] of Object.entries(TOPIC_KW)) {
      if (rx.test(text)) counts[topic] = (counts[topic] || 0) + 1
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([topic, count]) => ({ topic, count }))
}

/* ── Diversity interleave — prevent any category from dominating ── */
const CAT_PRIORITY = ['tech', 'ai', 'science', 'world', 'business', 'finance', 'macro', 'tokenized-assets', 'rwa', 'energy', 'health', 'crypto']

function diversityInterleave(items) {
  if (items.length < 6) return items

  // Spectre AI originals always get priority placement at the top
  const spectreOriginals = items.filter(n => n.isSpectre)
  const rest = items.filter(n => !n.isSpectre)

  // Group remaining by category, each bucket keeps its chronological order
  const buckets = {}
  for (const item of rest) {
    const cat = item.category || 'tech'
    if (!buckets[cat]) buckets[cat] = []
    buckets[cat].push(item)
  }
  // Ordered round-robin: prioritize tech-forward categories first,
  // crypto last (since Intelligence page already covers crypto depth)
  const catOrder = CAT_PRIORITY.filter(c => buckets[c]?.length > 0)
  // Add any remaining categories not in priority list
  for (const c of Object.keys(buckets)) {
    if (!catOrder.includes(c)) catOrder.push(c)
  }
  const interleaved = []
  const indices = {}
  catOrder.forEach(c => { indices[c] = 0 })
  while (interleaved.length < rest.length) {
    let added = false
    for (const cat of catOrder) {
      if (indices[cat] < buckets[cat].length) {
        interleaved.push(buckets[cat][indices[cat]])
        indices[cat]++
        added = true
      }
    }
    if (!added) break
  }

  // Spectre originals first, then interleaved rest
  return [...spectreOriginals, ...interleaved]
}

/* ── Fisher-Yates shuffle with seed ── */
function seededShuffle(arr, seed) {
  const result = [...arr]
  let s = seed
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647
    const j = s % (i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/* ═══════════════════════════════════════════════════
   SOURCE LOGO COMPONENT
   ═══════════════════════════════════════════════════ */

function SourceLogo({ source }) {
  const logo = getSourceLogo(source)
  if (!logo) return null
  return (
    <img
      src={logo}
      alt=""
      className="sn-source-logo"
      width="16"
      height="16"
      loading="lazy"
      onError={(e) => { e.target.style.display = 'none' }}
    />
  )
}

/* ═══════════════════════════════════════════════════
   CARD COMPONENT
   ═══════════════════════════════════════════════════ */

// Kicker cluster: category label + (for wire stories) the kind in its color
// and the SHOCK chip on importance >= WIRE_SHOCK_MIN — mirrors the TG lanes.
function CardKicker({ article, catLabel }) {
  if (!article.isMacroWire) return <span className="sn-cat">{catLabel}</span>
  return (
    <>
      <span className="sn-cat sn-cat--macro">{catLabel}</span>
      {article.laneLabel === 'Macro Shock' && <span className="sn-shockchip">Macro Shock</span>}
      {article.laneLabel === 'Breaking' && <span className="sn-shockchip sn-shockchip--breaking">Breaking</span>}
      {article.kindLabel && article.kindLabel !== 'Macro' && (
        <span className="sn-cat sn-kind" style={{ color: article.kindColor }}>{article.kindLabel}</span>
      )}
    </>
  )
}

function NewsCardBase({ article, variant = 'grid', navigate, t, locale }) {
  const handleClick = () => {
    const encodedId = encodeURIComponent(article.id)
    navigate(`/news/${encodedId}`, { state: { article } })
  }
  const catLabel = t ? t(`newsPage.categories.${article.category === 'tokenized-assets' ? 'tokenizedAssets' : article.category}`, article.category) : article.category
  if (variant === 'hero') {
    return (
      <article className="sn-hero" onClick={handleClick}>
        <img
          src={article.imageUrl}
          alt=""
          className="sn-hero__bg"
          loading="eager"
          // Tell the browser this image is the LCP candidate so it isn't
          // queued behind the below-fold grid card images.
          fetchpriority="high"
          decoding="async"
          onError={(e) => { if (e.target.dataset.fallback) return; e.target.dataset.fallback = '1'; e.target.src = PLACEHOLDER_IMAGES[article.category] || PLACEHOLDER_IMAGES.tech }}
        />
        <div className="sn-hero__gradient" />
        <div className="sn-hero__top">
          <SourceLogo source={article.source} />
          <CardKicker article={article} catLabel={catLabel} />
        </div>
        <div className="sn-hero__content">
          <h2 className="sn-hero__title">{article.title}</h2>
          <div className="sn-meta">
            <SourceLogo source={article.source} />
            <span className="sn-meta__src">{article.source}</span>
            <span className="sn-meta__dot">&middot;</span>
            <span className="sn-meta__time">{timeAgo(article.publishedAt, t, locale)}</span>
          </div>
        </div>
      </article>
    )
  }

  if (variant === 'featured') {
    return (
      <article className="sn-feat" onClick={handleClick}>
        <div className="sn-feat__img">
          <img src={article.imageUrl} alt="" loading="lazy" onError={(e) => { if (e.target.dataset.fallback) return; e.target.dataset.fallback = '1'; e.target.src = PLACEHOLDER_IMAGES[article.category] || PLACEHOLDER_IMAGES.tech }} />
        </div>
        <div className="sn-feat__body">
          <CardKicker article={article} catLabel={catLabel} />
          <h3 className="sn-feat__title">{article.title}</h3>
          <div className="sn-meta">
            <SourceLogo source={article.source} />
            <span className="sn-meta__src">{article.source}</span>
            <span className="sn-meta__dot">&middot;</span>
            <span className="sn-meta__time">{timeAgo(article.publishedAt, t, locale)}</span>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article className="sn-card" onClick={handleClick}>
      <div className="sn-card__img">
        <img src={article.imageUrl} alt="" loading="lazy" onError={(e) => { if (e.target.dataset.fallback) return; e.target.dataset.fallback = '1'; e.target.src = PLACEHOLDER_IMAGES[article.category] || PLACEHOLDER_IMAGES.tech }} />
      </div>
      <div className="sn-card__body">
        <div className="sn-card__top">
          <CardKicker article={article} catLabel={catLabel} />
          <span className="sn-meta__time">{timeAgo(article.publishedAt, t, locale)}</span>
        </div>
        <h3 className="sn-card__title">{article.title}</h3>
        <p className="sn-card__summary">{article.summary}</p>
        <div className="sn-meta">
          <SourceLogo source={article.source} />
          <span className="sn-meta__src">{article.source}</span>
        </div>
      </div>
    </article>
  )
}

// Memoized so the page-level 60s prices/fear-greed polls (which update the
// ticker/sidebar, not the articles) don't re-render every news card. Props are
// stable: article per id, navigate/t/locale stable across those polls.
const NewsCard = memo(NewsCardBase)

/* ═══════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════ */

export default function NewsPage({ dayMode }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  // Instant-paint: seed the list from the last-fetched snapshot so a cold boot
  // (or return visit) renders rows immediately instead of spinner+skeleton.
  // The background fetchAllNews() below refreshes it once data lands.
  const [allNews, setAllNews] = useState(() => readNewsCache())
  const [breaking, setBreaking] = useState([])
  const [prices, setPrices] = useState([])
  const [fearGreed, setFearGreed] = useState(null)
  // ?cat=<key> deep-links straight onto a category tab — the TG bot's macro
  // alerts land on /news?cat=macro so the Read button opens the Macro Wire.
  const [category, setCategory] = useState(() => {
    try {
      const c = new URLSearchParams(window.location.search).get('cat')
      const valid = ['all', ...CAT_PRIORITY]
      return c && valid.includes(c) ? c : 'all'
    } catch { return 'all' }
  })
  // Skip the loading state when we have a seeded snapshot — render it instantly
  // and let the background refresh swap in fresh rows.
  const [loading, setLoading] = useState(() => readNewsCache().length === 0)
  const [visibleCount, setVisibleCount] = useState(18)
  const [interests, setInterests] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sn-interests') || '[]') } catch { return [] }
  })
  const [shuffled, setShuffled] = useState(false)
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 2147483647))
  const [shuffleAnimating, setShuffleAnimating] = useState(false)

  // Tracks mount state so fire-and-forget fetches don't setState after unmount.
  const mountedRef = useRef(true)
  useEffect(() => {
    // Reset on (re)mount so StrictMode's mount→unmount→remount in dev doesn't
    // leave the ref stuck `false` — which would make every fetch skip setState
    // and render the empty state forever (works in prod, broke only on localhost).
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /* ── FETCHES — diverse sources ── */

  const fetchAllNews = useCallback(async () => {
    // Primary: cached Spectre news bridge (one /v1/news?limit=80 call).
    // The prior implementation also fired getRssMarketNews + getCryptoNews
    // in parallel "for diversity", but both facades proxy through
    // getSpectreNews internally — RSS with limit=80 was deduplicated by
    // the spectreMarketApi inflight map, and Crypto with limit=20 was a
    // pure-waste second network call (different cache key, strict subset
    // of the 80-row response, dropped during dedupe). We only hit the
    // legacy facades if Spectre itself returns empty.
    // The Macro Wire rides alongside the editorial feed — independent source,
    // fetched in parallel so neither blocks the other.
    const [spectre, macroWire] = await Promise.all([
      getSpectreNews({ limit: 80 }).catch(() => []),
      fetchMacroWire().catch(() => []),
    ])
    let rss = []
    let crypto = []
    if (!spectre.length) {
      const [rssRes, cryptoRes] = await Promise.allSettled([
        getRssMarketNews(null, 80),
        getCryptoNews(null, 20),
      ])
      if (rssRes.status === 'fulfilled' && Array.isArray(rssRes.value)) rss = rssRes.value
      if (cryptoRes.status === 'fulfilled' && Array.isArray(cryptoRes.value)) crypto = cryptoRes.value
    }

    const items = []
    // Priority order: Spectre normalized news first, legacy-shaped facades after.
    if (Array.isArray(spectre) && spectre.length) items.push(...spectre.map(normalizeSpectreItem))
    if (rss.length) items.push(...rss.map(normalizeRssItem))
    if (crypto.length) items.push(...crypto.map(normalizeCryptoItem))
    if (macroWire.length) items.push(...macroWire)
    // Drop SEC EDGAR regulatory filings - they're 8-K / 8-K/A boilerplate
    // with identical SEC-seal images, NOT editorial news. Intelligence page
    // already filters these (index.jsx:222); News page was missing the
    // filter, so the same B&G Foods 8-K, Energy Vault 8-K, etc were
    // dominating the Discover grid with repeated SEC-seal thumbnails.
    const editorial = items.filter((n) => {
      const src = String(n.source || '').toLowerCase()
      if (src.includes('sec edgar') || src === 'sec') return false
      // Defense in depth: even if source is mis-labeled, filter by title
      // signature (8-K, 8-K/A, 10-Q, 10-K, S-1 etc. with parenthesised CIK).
      const title = String(n.title || '')
      if (/^\d+-K(?:\/A)?\s+-\s+.+\(\d{6,}\)/i.test(title)) return false
      if (/^(10-K|10-Q|8-K|8-K\/A|S-1|S-4|13F|13G|13D|6-K|N-CSR)\s/i.test(title)) return false
      return true
    })
    editorial.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    const deduped = deduplicateNews(editorial)
    // Apply diversity interleave so no single category dominates the feed
    const diverse = diversityInterleave(deduped)
    if (!mountedRef.current) return deduped
    setAllNews(diverse)
    writeNewsCache(diverse)
    return deduped
  }, [])

  const fetchBreaking = useCallback(async () => {
    const data = await getSpectreNews({ breaking: true, limit: 12 }).catch(() => [])
    if (!mountedRef.current) return
    if (data.length) setBreaking(data.map(normalizeSpectreItem))
  }, [])

  const fetchPrices = useCallback(async () => {
    try {
      const rows = await getSpectrePricesBySymbols(['BTC', 'ETH', 'SOL'])
      const list = ['BTC', 'ETH', 'SOL'].map((symbol) => {
        const row = rows[symbol]
        return row ? { symbol, price: row.price, change: row.change24h ?? row.change } : null
      }).filter(Boolean)
      if (!mountedRef.current) return
      setPrices(list)
    } catch {}
  }, [])

  const fetchFearGreed = useCallback(async () => {
    try {
      const data = await getFearGreedCurrent()
      if (!mountedRef.current) return
      if (data?.value != null) setFearGreed({ value: Number(data.value), classification: (data.classification || '').replace(/\b\w/g, c => c.toUpperCase()) })
    } catch {}
  }, [])

  useEffect(() => {
    let cancelled = false
    async function init() {
      // Don't re-show the loading state if we already painted seeded rows —
      // the refresh happens silently underneath. Only gate on a cold (empty) boot.
      if (readNewsCache().length === 0) setLoading(true)
      // Only fetchAllNews gates the spinner — the Discover grid and the
      // category timeline both feed off allNews. Breaking banner, prices
      // ticker, and Fear & Greed have their own skeletons / placeholders
      // and populate progressively. Cold paint drops from
      // max(allNews 230 ms, breaking 240 ms) to just allNews.
      await fetchAllNews()
      if (!cancelled) setLoading(false)
      fetchBreaking(); fetchPrices(); fetchFearGreed()
    }
    init()
    return () => { cancelled = true }
  }, []) // eslint-disable-line

  // Adaptive polling for data refreshes. prices bumped 30 s -> 60 s — the
  // masthead ticker shows 3 quotes, this isn't a trading surface.
  // News moves slower than 2 min — 180 s cuts ~33% of news calls/day.
  // useAdaptivePolling keeps the document.hidden visibility guard.
  useAdaptivePolling(fetchAllNews, { interval: 180000 })
  useAdaptivePolling(fetchBreaking, { interval: 60000 })
  useAdaptivePolling(fetchPrices, { interval: 60000 })

  /* ── INTERESTS ── */
  const toggleInterest = useCallback((key) => {
    setInterests(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      localStorage.setItem('sn-interests', JSON.stringify(next))
      return next
    })
    setVisibleCount(18)
  }, [])

  /* ── SHUFFLE ── */
  const handleShuffle = useCallback(() => {
    setShuffleAnimating(true)
    setTimeout(() => setShuffleAnimating(false), 400)
    if (shuffled) {
      setShuffled(false)
    } else {
      setShuffleSeed(Math.floor(Math.random() * 2147483647))
      setShuffled(true)
    }
  }, [shuffled])

  /* ── FILTER ── */
  const filtered = useMemo(() => {
    let items = allNews

    if (category !== 'all') {
      items = items.filter(n => n.category === category)
    }

    if (interests.length > 0) {
      const matched = items.filter(n => interests.includes(n.category))
      if (matched.length > 0) items = matched
    }

    if (shuffled) {
      items = seededShuffle(items, shuffleSeed)
    }

    return items
  }, [allNews, category, interests, shuffled, shuffleSeed])

  // Memo so the layoutSections useMemo below actually holds - a fresh .slice()
  // array every render defeated it, re-running the section layout on every 60s
  // prices/fear-greed poll tick.
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = visibleCount < filtered.length
  const trending = useMemo(() => extractTrending(allNews), [allNews])
  // Right-rail wire feed — newest first regardless of the interleave order.
  const macroWire = useMemo(() => allNews
    .filter(n => n.isMacroWire)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 8), [allNews])

  const handleCategoryChange = useCallback((cat) => { setCategory(cat); setVisibleCount(18) }, [])

  /* ── MIXED LAYOUT ── */
  const layoutSections = useMemo(() => {
    const sections = []
    let i = 0
    const a = visible

    if (a[i]) { sections.push({ type: 'hero', items: [a[i]] }); i++ }
    if (a.length > i) { sections.push({ type: 'grid3', items: a.slice(i, i + 3) }); i += 3 }
    if (a.length > i) { sections.push({ type: 'feat2', items: a.slice(i, i + 2) }); i += 2 }
    if (a.length > i) { sections.push({ type: 'grid3', items: a.slice(i, i + 3) }); i += 3 }
    if (a[i]) { sections.push({ type: 'hero-alt', items: [a[i]] }); i++ }
    while (i < a.length) {
      sections.push({ type: 'grid3', items: a.slice(i, i + 3) })
      i += 3
    }
    return sections
  }, [visible])

  /* ── LOADING ── */
  if (loading) {
    return (
      <div className={`sn-page${dayMode ? ' sn-day' : ''}${isMobile ? ' sn-mobile' : ''}`}>
        <header className="sn-header">
          <div className="sn-header__row">
            <h1 className="sn-header__title">{t('newsPageChrome.discover', 'Discover')}</h1>
          </div>
        </header>
        <div className="sn-layout">
          <main className="sn-main">
            <div className="sn-section sn-section--hero">
              <div className="sn-skel sn-skel--hero" />
            </div>
            <div className="sn-section sn-section--feat2">
              <div className="sn-skel sn-skel--feat" />
              <div className="sn-skel sn-skel--feat" />
            </div>
            <div className="sn-section sn-section--grid3">
              <div className="sn-skel sn-skel--card" />
              <div className="sn-skel sn-skel--card" />
              <div className="sn-skel sn-skel--card" />
            </div>
            <div className="sn-section sn-section--grid3">
              <div className="sn-skel sn-skel--card" />
              <div className="sn-skel sn-skel--card" />
              <div className="sn-skel sn-skel--card" />
            </div>
          </main>
          {!isMobile && (
            <aside className="sn-aside">
              <div className="sn-skel sn-skel--aside-block" />
              <div className="sn-skel sn-skel--aside-block" />
              <div className="sn-skel sn-skel--aside-block" />
            </aside>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`sn-page${dayMode ? ' sn-day' : ''}${isMobile ? ' sn-mobile' : ''}`}>
      <header className="sn-header">
        <div className="sn-header__row">
          <MobileBackButton className="sn-header__back" />
          <h1 className="sn-header__title">{t('newsPageChrome.discover', 'Discover')}</h1>
          <button
            className={`sn-shuffle ${shuffled ? 'sn-shuffle--active' : ''} ${shuffleAnimating ? 'sn-shuffle--spin' : ''}`}
            onClick={handleShuffle}
            title={shuffled ? t('newsPageChrome.restoreOrder', 'Restore chronological order') : t('newsPageChrome.shuffle', 'Shuffle articles')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
          </button>
        </div>
        {filtered.length > 0 && (
          <p className="sn-header__count">{t('newsPageChrome.articlesCount', { count: filtered.length, defaultValue: '{{count}} articles' })}{interests.length > 0 ? ` · ${t('newsPageChrome.interestActive', { count: interests.length, defaultValue: '{{count}} interests active' })}` : ''}</p>
        )}
      </header>

      <NewsCategoryTabs active={category} onChange={handleCategoryChange} />

      {breaking.length > 0 && (
        <div className="sn-breaking" onClick={() => navigate(`/news/${encodeURIComponent(breaking[0].id)}`, { state: { article: breaking[0] } })}>
          <span className="sn-breaking__badge">{t('newsPageChrome.live', 'LIVE')}</span>
          <span className="sn-breaking__text">{breaking[0].title}</span>
          <span className="sn-breaking__time">{timeAgo(breaking[0].publishedAt, t, i18n.language)}</span>
        </div>
      )}

      <div className="sn-layout">
        <main className="sn-main">
          {layoutSections.map((section, si) => {
            if (section.type === 'hero' && section.items[0]) {
              return <div key={si} className="sn-section sn-section--hero">
                <NewsCard article={section.items[0]} variant="hero" navigate={navigate} t={t} locale={i18n.language} />
              </div>
            }
            if (section.type === 'hero-alt' && section.items[0]) {
              return <div key={si} className="sn-section sn-section--hero sn-section--hero-alt">
                <NewsCard article={section.items[0]} variant="hero" navigate={navigate} t={t} locale={i18n.language} />
              </div>
            }
            if (section.type === 'feat2') {
              return <div key={si} className="sn-section sn-section--feat2">
                {section.items.map(a => <NewsCard key={a.id} article={a} variant="featured" navigate={navigate} t={t} locale={i18n.language} />)}
              </div>
            }
            if (section.type === 'grid3') {
              return <div key={si} className="sn-section sn-section--grid3">
                {section.items.map(a => <NewsCard key={a.id} article={a} variant="grid" navigate={navigate} t={t} locale={i18n.language} />)}
              </div>
            }
            return null
          })}

          {filtered.length === 0 && (
            <div className="sn-empty">
              <p>{t('newsPageChrome.noArticles', 'No articles match your filters.')}</p>
              <button className="sn-empty__reset" onClick={() => { setInterests([]); setCategory('all'); localStorage.removeItem('sn-interests') }}>
                {t('newsPageChrome.resetFilters', 'Reset Filters')}
              </button>
            </div>
          )}

          {hasMore && (
            <button className="sn-load-more" onClick={() => setVisibleCount(p => p + 12)}>{t('newsPageChrome.showMore', 'Show More')}</button>
          )}
        </main>

        {!isMobile && (
          <aside className="sn-aside">
            <Suspense fallback={
              <>
                <div className="sn-skel sn-skel--aside-block" />
                <div className="sn-skel sn-skel--aside-block" />
                <div className="sn-skel sn-skel--aside-block" />
              </>
            }>
              <NewsSidebar
                prices={prices} fearGreed={fearGreed} trendingTopics={trending}
                interests={interests} onToggleInterest={toggleInterest}
                dayMode={dayMode}
                macroWire={macroWire}
                onOpenWireItem={(a) => navigate(`/news/${encodeURIComponent(a.id)}`, { state: { article: a } })}
                onOpenWireTab={() => handleCategoryChange('macro')}
              />
            </Suspense>
          </aside>
        )}
      </div>
    </div>
  )
}

export { getSourceLogo, SOURCE_LOGOS }
