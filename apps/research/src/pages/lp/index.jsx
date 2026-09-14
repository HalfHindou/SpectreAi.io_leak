import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getOfficialTweets, normalizeOfficialTweet } from '../../services/spectreApi'
import BgMusicToggle from '../website2/components/bg-music'
import '../website2/website2.css'
import './lp.css'

// In-page nav for the LP — anchors to the LP's own sections (no jump away).
// `labelKey` + `labelFallback` resolve via t() at render time.
const LP_NAV_LINKS = [
  { id: 'overview', icon: 'compass', labelKey: 'lp.nav.overview', labelFallback: 'Overview' },
  { id: 'proof', icon: 'chart', labelKey: 'lp.nav.proof', labelFallback: 'Proof' },
  { id: 'transition', icon: 'prism', labelKey: 'lp.nav.transition', labelFallback: 'Transition' },
  { id: 'token', icon: 'cube', labelKey: 'lp.nav.token', labelFallback: 'Token' },
  { id: 'community', icon: 'people', labelKey: 'lp.nav.community', labelFallback: 'Community' },
]

/* Outline icon set for the drawer — matches website2.
   1.75 stroke, rounded linecaps, 18px grid. No sparkles, no robots. */
const LP_DRAWER_ICONS = {
  compass: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-5 2-2 5 5-2 2-5Z" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V5" /><path d="M4 20h16" /><path d="M7 16l4-4 3 3 5-6" /><path d="M15 9h4v4" />
    </svg>
  ),
  prism: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4 19h16L12 3Z" /><path d="M12 3v16" /><path d="M12 11l-4 4" /><path d="M12 11l4 4" />
    </svg>
  ),
  cube: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z" /><path d="M3 7.5 12 12l9-4.5" /><path d="M12 12v9" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="9" r="3" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 8a3 3 0 0 1 0 6" /><path d="M18 19c0-2 1-3.5 3-4" />
    </svg>
  ),
}

function formatCount(n) {
  const num = Number(n) || 0
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return String(num)
}

function cleanTweetText(raw) {
  if (!raw) return ''
  let text = String(raw)
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
  // Strip trailing t.co short-links (usually media/quote links)
  text = text.replace(/\s*https?:\/\/t\.co\/\S+\s*$/gi, '').trim()
  return text
}

function formatRelative(iso, lang, t) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return t ? t('lp.tweets.justNow', 'just now') : 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  try {
    return new Intl.DateTimeFormat(lang || 'en', { month: 'short', day: 'numeric' }).format(d)
  } catch {
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  }
}

const CA = '0x9Cf0ED013e67DB12cA3AF8e7506fE401aA14dAd6'
const ETHERSCAN_URL = `https://etherscan.io/token/${CA}`

const SOCIALS = [
  {
    name: 'X',
    count: '22,900',
    href: 'https://x.com/Spectre__AI',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    name: 'Telegram',
    count: '5,200',
    href: 'https://telegram.me/AI_SPECTRE',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.492-1.302.48-.428-.012-1.252-.242-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
  {
    name: 'YouTube',
    count: '1,800',
    href: 'https://www.youtube.com/@ai-spectre',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  {
    name: 'LinkedIn',
    count: '3,400',
    href: 'https://www.linkedin.com/company/ai-spectre',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
]

export default function LandingPage() {
  const { t, i18n } = useTranslation()
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [thanksOpen, setThanksOpen] = useState(false)
  const [caCopied, setCaCopied] = useState(false)
  const [morphLightbox, setMorphLightbox] = useState(null) // 'v1' | 'v2' | null
  const [scrolled, setScrolled] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)
  const [isMuted, setIsMuted] = useState(true)
  const [tweets, setTweets] = useState([])
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const videoRef = useRef(null)
  // Attribution: captured once on mount so UTM + referrer survive any
  // in-page navigation the visitor does before submitting.
  const attributionRef = useRef({ referrer: '', utm: {} })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const utm = {}
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      const v = params.get(k)
      if (v) utm[k] = v
    }
    attributionRef.current = { referrer: document.referrer || '', utm }
  }, [])

  // Scroll lock via class toggle — no inline styles, no restore-value races.
  // CSS safety net in lp.css handles html/body height + overflow globally.
  useEffect(() => {
    const cls = 'w2-body-scroll-locked'
    if (mobileNavOpen) document.body.classList.add(cls)
    else document.body.classList.remove(cls)
    return () => document.body.classList.remove(cls)
  }, [mobileNavOpen])

  // Scope <html> so CSS safety net applies while we're on /lp.
  useEffect(() => {
    document.documentElement.classList.add('lp-html-scope')
    return () => document.documentElement.classList.remove('lp-html-scope')
  }, [])

  // Always land at the top when /lp mounts. Without this, react-router
  // preserves the previous page's scroll position, so "Open App" from the
  // bottom of /website2 dumps the visitor at the bottom of /lp.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [])

  useEffect(() => {
    // SEO title — kept English (canonical meta string for the public landing page).
    document.title = 'Spectre AI - Something New Is Coming'

    const link = document.createElement('link')
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap'
    link.rel = 'stylesheet'
    document.head.appendChild(link)

    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })

    // Fetch official Spectre tweets from X — originals only (no RTs, no replies)
    const loadTweets = async () => {
      try {
        const data = await getOfficialTweets('Spectre__AI')
        if (!data) return
        const raw = Array.isArray(data) ? data : (data?.results || data?.tweets || [])
        const isOriginalPost = (tw) => {
          const text = (tw?.tweet_text || '').trim()
          const user = (tw?.username || '').toLowerCase()
          if (!text) return false
          // Must actually be posted by Spectre (API also returns quoted tweets from other accounts)
          if (user !== 'spectre__ai') return false
          // Exclude retweets
          if (/^RT\s*@/i.test(text)) return false
          if (tw?.is_retweet === true || tw?.retweeted === true || tw?.retweeted_status) return false
          // Exclude replies (leading @handle)
          if (/^@\w+/.test(text)) return false
          if (tw?.in_reply_to_status_id || tw?.in_reply_to_user_id || tw?.is_reply === true) return false
          // Exclude short quote-tweet reactions that only make sense with the quoted post
          // (e.g., "We are very proud of this post.", "this tweet 🔥")
          const isQuoteReaction = /\b(this\s+(post|tweet|one|guy|take|thread)|very proud|so proud|great post|big if true|same energy)\b/i.test(text)
          if (isQuoteReaction && text.length < 100) return false
          return true
        }
        const normalized = raw
          .filter(isOriginalPost)
          .map((tw, i) => normalizeOfficialTweet(tw, i))
          .filter((tw) => tw.text && tw.text.length > 0)
          .slice(0, 6)
        if (normalized.length) setTweets(normalized)
      } catch { /* silent */ }
    }
    loadTweets()

    // Ensure video actually plays after mount
    const v = videoRef.current
    if (v) {
      v.muted = true
      const tryPlay = v.play()
      if (tryPlay && typeof tryPlay.catch === 'function') {
        tryPlay.catch(() => {
          // autoplay blocked — leave as-is, user will press play
          setIsPlaying(false)
        })
      }
    }

    return () => {
      window.removeEventListener('scroll', onScroll)
      document.title = 'Spectre AI'
    }
  }, [])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play().then(() => setIsPlaying(true)).catch(() => {})
    } else {
      v.pause()
      setIsPlaying(false)
    }
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setIsMuted(v.muted)
    // If unmuting and video was paused by browser policy, try to play
    if (!v.muted && v.paused) {
      v.play().then(() => setIsPlaying(true)).catch(() => {})
    }
  }

  const handleWaitlist = (e) => {
    e.preventDefault()
    const v = email.trim()
    if (!v || !v.includes('@')) return
    try {
      const { referrer, utm } = attributionRef.current
      fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: v,
          source: 'spectre-waitlist-lp',
          telegram: null,
          hp: '',
          referrer,
          ...utm,
        })
      }).catch(() => {})
    } catch (_) { console.error(_) }
    setSubmitted(true)
    setThanksOpen(true)
  }

  // Close thanks modal on Escape
  useEffect(() => {
    if (!thanksOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setThanksOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [thanksOpen])

  const copyCA = () => {
    navigator.clipboard.writeText(CA)
    setCaCopied(true)
    setTimeout(() => setCaCopied(false), 2000)
  }

  return (
    <div className="lp">
      {/* Film grain */}
      <div className="lp-grain" />

      {/* Ambient orbs — soft warm layered gradients that drift */}
      <div className="lp-ambient" aria-hidden="true">
        <div className="lp-orb lp-orb--a" />
        <div className="lp-orb lp-orb--b" />
        <div className="lp-orb lp-orb--c" />
      </div>

      {/* Subtle animated grid */}
      <div className="lp-grid-bg" aria-hidden="true" />

      {/* LP-owned nav — internal anchors, logo + back button return to /website2 */}
      <nav className={`w2-nav lp-nav${scrolled ? ' w2-nav--scrolled' : ''}`}>
        <div className="w2-nav-inner">
          <a href="/" className="w2-nav-left lp-nav-brand" style={{ textDecoration: 'none', color: 'inherit' }} aria-label={t('lp.nav.backToLandingAria', 'Back to Spectre AI landing page')}>
            <img src="/spectre-logo-dark.png" alt="Spectre AI" className="w2-nav-logo" />
            <span className="w2-nav-wordmark">Spectre<span className="lp-nav-wordmark-ai">&nbsp;AI</span></span>
          </a>
          <div className="w2-nav-links">
            {LP_NAV_LINKS.map((link) => (
              <a
                key={link.id}
                className="w2-nav-link"
                href={`#${link.id}`}
              >
                {t(link.labelKey, link.labelFallback)}
              </a>
            ))}
          </div>
          <div className="w2-nav-right">
            <a className="lp-nav-back" href="/" aria-label={t('lp.nav.backShortAria', 'Back to landing page')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
              <span>{t('lp.nav.backToLanding', 'Back to Landing')}</span>
            </a>
            <a className="w2-btn-accent w2-btn-accent--hideMobile" href="https://app.uniswap.org/explore/tokens/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6" target="_blank" rel="noopener noreferrer">{t('lp.nav.buySpectre', 'Buy $SPECTRE')}</a>
            <button
              type="button"
              className={`w2-nav-burger${mobileNavOpen ? ' w2-nav-burger--open' : ''}`}
              aria-label={mobileNavOpen ? t('lp.nav.closeMenuAria', 'Close menu') : t('lp.nav.openMenuAria', 'Open menu')}
              aria-expanded={mobileNavOpen}
              aria-controls="lp-mobile-drawer"
              onClick={() => setMobileNavOpen((v) => !v)}
            >
              <span className="w2-nav-burger-line" />
              <span className="w2-nav-burger-line" />
              <span className="w2-nav-burger-line" />
            </button>
          </div>
        </div>
      </nav>

      {/* ═══════════════════════ MOBILE DRAWER ═══════════════════════ */}
      <div
        className={`w2-mobile-scrim${mobileNavOpen ? ' w2-mobile-scrim--open' : ''}`}
        aria-hidden="true"
        onClick={() => setMobileNavOpen(false)}
      />
      <aside
        id="lp-mobile-drawer"
        className={`w2-mobile-drawer${mobileNavOpen ? ' w2-mobile-drawer--open' : ''}`}
        aria-label={t('lp.drawer.navAria', 'Mobile navigation')}
        aria-hidden={!mobileNavOpen}
      >
        <div className="w2-mobile-drawer-head">
          <a
            href="/"
            className="w2-mobile-drawer-brand lp-drawer-brand-link"
            onClick={() => setMobileNavOpen(false)}
            aria-label={t('lp.nav.backToLandingAria', 'Back to Spectre AI landing page')}
          >
            <img src="/spectre-logo-dark.png" alt="" className="w2-mobile-drawer-logo" />
            <span className="w2-mobile-drawer-wordmark">Spectre<span className="w2-mobile-drawer-wordmark-ai">AI</span></span>
          </a>
          <button
            type="button"
            className="w2-mobile-drawer-close"
            aria-label={t('lp.nav.closeMenuAria', 'Close menu')}
            onClick={() => setMobileNavOpen(false)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <span className="w2-mobile-drawer-eyebrow">{t('lp.drawer.eyebrow', 'Navigate')}</span>
        <nav className="w2-mobile-drawer-nav" aria-label={t('lp.drawer.sectionsAria', 'Sections')}>
          {LP_NAV_LINKS.map((link, idx) => (
            <button
              key={link.id}
              type="button"
              className="w2-mobile-drawer-link"
              style={{ '--w2-drawer-stagger': `${idx * 40}ms` }}
              onClick={() => {
                setMobileNavOpen(false)
                // Wait for drawer close + scroll-lock release before scrolling,
                // otherwise the browser re-anchors to body top.
                setTimeout(() => {
                  const el = document.getElementById(link.id)
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }, 180)
              }}
            >
              <span className="w2-mobile-drawer-link-icon" aria-hidden="true">
                {LP_DRAWER_ICONS[link.icon] || LP_DRAWER_ICONS.compass}
              </span>
              <span className="w2-mobile-drawer-link-label">{t(link.labelKey, link.labelFallback)}</span>
              <svg className="w2-mobile-drawer-link-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ))}
          <BgMusicToggle />
        </nav>
        <div className="w2-mobile-drawer-foot">
          <a
            className="w2-mobile-drawer-cta w2-mobile-drawer-cta--primary lp-drawer-back-cta"
            href="/"
            onClick={() => setMobileNavOpen(false)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            <span>{t('lp.nav.backToLanding', 'Back to Landing')}</span>
          </a>
          <a
            className="w2-mobile-drawer-cta w2-mobile-drawer-cta--accent"
            href="https://app.uniswap.org/explore/tokens/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMobileNavOpen(false)}
          >
            {t('lp.nav.buySpectre', 'Buy $SPECTRE')}
          </a>
        </div>
      </aside>

      {/* Hero — full-bleed atmosphere, no bounded card */}
      <section id="overview" className="lp-hero lp-hero--bleed">
        {/* Atmospheric background portraits (blended, not boxed) */}
        <div className="lp-hero-bg" aria-hidden="true">
          <div className="lp-hero-bg-figure lp-hero-bg-figure--left">
            <img
              src="/u4754797691_ultra_photorealistic_cinematic_lifestyle_photo_of_a_b5a7b4ee-1b49-4416-bc06-ae801a89a15d.jpg"
              alt=""
              className="lp-hero-bg-img"
              loading="eager"
            />
          </div>
          <div className="lp-hero-bg-figure lp-hero-bg-figure--right">
            <img
              src="/partnerka.eth_Create_a_vibrant_image_of_a_woman_working_on_her__3cef7db7-f12a-4972-8e6f-5d9612668bd7.jpg"
              alt=""
              className="lp-hero-bg-img"
              loading="eager"
            />
          </div>
          {/* Multi-layer blend: horizontal center veil + bottom-to-background fade */}
          <div className="lp-hero-bg-veil" />
          <div className="lp-hero-bg-grid" />
        </div>

        <div className="lp-hero-wide">
          <div className="lp-hero-split">
            {/* LEFT — story column */}
            <div className="lp-hero-story">
              <div className="lp-hero-brandbar">
                <span className="lp-hero-brandbar-mark">
                  <img src="/spectre-logo-dark.png" alt="" className="lp-hero-brandbar-logo" />
                </span>
                <span className="lp-hero-brandbar-name">Spectre AI</span>
                <span className="lp-hero-brandbar-rule" aria-hidden="true" />
                <span className="lp-hero-brandbar-label">{t('lp.hero.brandbarLabel', 'Market Intelligence Terminal')}</span>
                <span className="lp-hero-brandbar-divider" aria-hidden="true" />
                <span className="lp-hero-brandbar-status">{t('lp.hero.brandbarStatus', 'V2 launching soon')}</span>
              </div>

              <h1 className="lp-hero-heading">
                {t('lp.hero.headingLine1', 'Spectre has run live for a year.')}<br />
                <em>{t('lp.hero.headingLine2', 'V2 launches this quarter.')}</em>
              </h1>

              <p className="lp-hero-subline">
                {t('lp.hero.subline', 'V1 shipped in 2024 and has been in production ever since. V2 is the same platform rewritten from scratch, with every screen driven by infrastructure we own.')}
              </p>
            </div>

            {/* RIGHT - CTA block, no box */}
            <aside className="lp-hero-cta">
              <div className="lp-hero-cta-head">
                <span className="lp-hero-cta-eyebrow">{t('lp.hero.ctaEyebrow', 'LIMITED SPOTS')}</span>
                <span className="lp-hero-cta-count">100 / 100</span>
              </div>

              <h2 className="lp-hero-cta-title">
                {t('lp.hero.ctaTitle', 'Join the V2 waitlist.')}
              </h2>
              <p className="lp-hero-cta-copy">
                {t('lp.hero.ctaCopy', "The first 100 seats go to $SPECTRE holders and early waitlist members. Leave an email and we'll reach out when invites open.")}
              </p>

              {!submitted ? (
                <form className="lp-hero-form" onSubmit={handleWaitlist}>
                  <div className="lp-hero-form-inner">
                    <svg className="lp-hero-form-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                    <input
                      type="email"
                      className="lp-hero-form-input"
                      placeholder={t('lp.hero.emailPlaceholder', 'you@company.com')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                    <button type="submit" className="lp-hero-form-btn">
                      {t('lp.hero.requestAccess', 'Request Access')}
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </form>
              ) : (
                <div className="lp-hero-success">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  <span>{t('lp.hero.successMsg', "You're on the list. We'll be in touch.")}</span>
                </div>
              )}

              <div className="lp-hero-trust">
                <span className="lp-hero-trust-icon" aria-hidden="true">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="10" width="16" height="11" rx="2.4" />
                    <path d="M8 10V7a4 4 0 1 1 8 0v3" />
                  </svg>
                </span>
                <span className="lp-hero-trust-text">
                  <strong className="lp-hero-trust-strong">{t('lp.hero.trustStrong', '$SPECTRE holders first.')}</strong>
                  <span className="lp-hero-trust-soft">{t('lp.hero.trustSoft', 'Everyone else joins the queue.')}</span>
                </span>
              </div>
            </aside>
          </div>
        </div>

        {/* Video showcase */}
        <div className="lp-hero-video-frame">
          <div className="lp-hero-video-glow" />

          {/* Corner frame marks for editorial feel */}
          <div className="lp-corner lp-corner--tl" />
          <div className="lp-corner lp-corner--tr" />
          <div className="lp-corner lp-corner--bl" />
          <div className="lp-corner lp-corner--br" />

          <div className="lp-hero-video-container">
            <video
              ref={videoRef}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              poster="/spectre-hero-poster.jpg"
              className="lp-hero-video"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onClick={togglePlay}
            >
              {/* Primary: CDN-hosted preview (set VITE_LP_PREVIEW_URL in Vercel).
                  Fallbacks: repo-bundled preview assets. Poster shows while
                  video resolves, and if every source 404s the poster stays. */}
              {import.meta.env.VITE_LP_PREVIEW_URL && (
                <source src={import.meta.env.VITE_LP_PREVIEW_URL} type="video/mp4" />
              )}
              <source src="/spectre-lp.mp4" type="video/mp4" />
            </video>

            {/* Play/Pause big overlay (visible when paused) */}
            <button
              type="button"
              className={`lp-video-overlay${isPlaying ? ' lp-video-overlay--hidden' : ''}`}
              onClick={togglePlay}
              aria-label={t('lp.video.playAria', 'Play video')}
            >
              <span className="lp-video-overlay-btn">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </button>

            {/* Controls bar */}
            <div className="lp-video-controls">
              <button
                type="button"
                className="lp-video-ctrl"
                onClick={togglePlay}
                aria-label={isPlaying ? t('lp.video.pauseAria', 'Pause') : t('lp.video.playShortAria', 'Play')}
              >
                {isPlaying ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              <div className="lp-video-live">
                <span className="lp-video-live-dot" />
                {t('lp.video.preview', 'Preview')}
              </div>

              <button
                type="button"
                className="lp-video-ctrl lp-video-ctrl--sound"
                onClick={toggleMute}
                aria-label={isMuted ? t('lp.video.unmuteAria', 'Unmute') : t('lp.video.muteAria', 'Mute')}
              >
                {isMuted ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5 6 9H2v6h4l5 4V5z" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5 6 9H2v6h4l5 4V5z" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
                <span className="lp-video-ctrl-label">{isMuted ? t('lp.video.soundOff', 'Sound off') : t('lp.video.soundOn', 'Sound on')}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Numbers / Proof band */}
      <section id="proof" className="lp-numbers">
        <div className="lp-numbers-inner">
          <p className="lp-numbers-eyebrow">{t('lp.numbers.eyebrow', 'Twelve months, in numbers')}</p>
          <div className="lp-numbers-row">
            <div className="lp-numbers-cell">
              <div className="lp-numbers-value">132K<em>+</em></div>
              <div className="lp-numbers-label">{t('lp.numbers.visitors', 'unique visitors')}</div>
            </div>
            <div className="lp-numbers-cell">
              <div className="lp-numbers-value">400K<em>+</em></div>
              <div className="lp-numbers-label">{t('lp.numbers.pageViews', 'page views served')}</div>
            </div>
            <div className="lp-numbers-cell">
              <div className="lp-numbers-value">50K<em>+</em></div>
              <div className="lp-numbers-label">{t('lp.numbers.tokensTracked', 'tokens tracked')}</div>
            </div>
            <div className="lp-numbers-cell">
              <div className="lp-numbers-value">30K<em>+</em></div>
              <div className="lp-numbers-label">{t('lp.numbers.community', 'community members')}</div>
            </div>
            <div className="lp-numbers-cell">
              <div className="lp-numbers-value"><em>1</em>{t('lp.numbers.yrSuffix', 'yr')}</div>
              <div className="lp-numbers-label">{t('lp.numbers.liveInProd', 'live in production')}</div>
            </div>
            <div className="lp-numbers-cell">
              <div className="lp-numbers-value">24/7</div>
              <div className="lp-numbers-label">{t('lp.numbers.uptime', 'signal engine uptime')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* V1 → V2 Ledger */}
      <section id="transition" className="lp-ledger">
        <div className="lp-ledger-inner">
          <div className="lp-ledger-head">
            <p className="lp-ledger-eyebrow">{t('lp.ledger.eyebrow', 'The transition')}</p>
            <h2 className="lp-ledger-title">
              {t('lp.ledger.titleA', 'What V1 delivered and')} <em>{t('lp.ledger.titleB', 'what V2 adds.')}</em>
            </h2>
          </div>

          {/* V1 → V2 morph visual */}
          <div className="lp-morph">
            <button
              type="button"
              className="lp-morph-frame lp-morph-frame--v1"
              onClick={() => setMorphLightbox('v1')}
              aria-label={t('lp.morph.expandV1Aria', 'Expand V1 Research Zone')}
            >
              <div className="lp-morph-badge">{t('lp.morph.v1Badge', 'Old Platform · V1 · 2024 → 2025')}</div>
              <img
                src="/v1-spectre-research.png"
                alt={t('lp.morph.v1Alt', 'Spectre V1 Research Zone')}
                className="lp-morph-img"
                loading="lazy"
              />
              <div className="lp-morph-frame-fade" />
              <span className="lp-morph-expand-hint">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                {t('lp.morph.expand', 'Expand')}
              </span>
            </button>

            <div className="lp-morph-bridge" aria-hidden="true">
              <div className="lp-morph-arrows">
                <svg viewBox="0 0 80 24" className="lp-morph-chev lp-morph-chev--1"><path d="M4 12 H70 M60 4 L70 12 L60 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <svg viewBox="0 0 80 24" className="lp-morph-chev lp-morph-chev--2"><path d="M4 12 H70 M60 4 L70 12 L60 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <svg viewBox="0 0 80 24" className="lp-morph-chev lp-morph-chev--3"><path d="M4 12 H70 M60 4 L70 12 L60 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <span className="lp-morph-bridge-label">{t('lp.morph.bridge', 'Morphing into')}</span>
            </div>

            <button
              type="button"
              className="lp-morph-frame lp-morph-frame--v2"
              onClick={() => setMorphLightbox('v2')}
              aria-label={t('lp.morph.expandV2Aria', 'Expand V2 Command Center')}
            >
              <div className="lp-morph-badge lp-morph-badge--next">
                <span className="lp-morph-badge-dot" />
                {t('lp.morph.v2Badge', 'New Platform · V2 · 2026')}
              </div>
              <img
                src="/screenshots/command-center.png"
                alt={t('lp.morph.v2Alt', 'Spectre V2 Command Center')}
                className="lp-morph-img"
                loading="lazy"
              />
              <div className="lp-morph-frame-fade" />
              <div className="lp-morph-frame-glow" />
              <span className="lp-morph-expand-hint">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                {t('lp.morph.expand', 'Expand')}
              </span>
            </button>
          </div>

          <div className="lp-ledger-grid">
            <div className="lp-ledger-col lp-ledger-col--shipped">
              <div className="lp-ledger-col-head">
                <div className="lp-ledger-col-headline">
                  <span className="lp-ledger-col-num">V1</span>
                  <div className="lp-ledger-col-heads">
                    <span className="lp-ledger-col-status lp-ledger-col-status--shipped">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                      {t('lp.ledger.v1Status', 'Shipped')}
                    </span>
                    <h3 className="lp-ledger-col-title">{t('lp.ledger.v1Title', 'The platform you already know.')}</h3>
                  </div>
                </div>
              </div>
              <ul className="lp-ledger-list">
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v1.cryptoOnlyLabel', 'Crypto only')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v1.cryptoOnlyDesc', '3,000 tokens across EVM and Solana.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v1.researchLabel', 'Research & sentiment')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v1.researchDesc', 'Dashboards, scores, technical analysis.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v1.xIntelLabel', 'X intelligence')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v1.xIntelDesc', 'KOL tracking and social heatmaps.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v1.thirdPartyLabel', 'Third-party data')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v1.thirdPartyDesc', 'Built on external APIs and feeds.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v1.webOnlyLabel', 'Web app only')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v1.webOnlyDesc', 'Single layout, one screen size.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v1.manualLabel', 'Manual monitoring')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v1.manualDesc', 'You check the dashboard when you remember.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v1.tokenLaunchLabel', '$SPECTRE launch')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v1.tokenLaunchDesc', 'Token shipped. 30,000+ community formed around it.')}</span>
                  </div>
                </li>
              </ul>
            </div>
            <div className="lp-ledger-col lp-ledger-col--next">
              <div className="lp-ledger-col-head">
                <div className="lp-ledger-col-headline">
                  <span className="lp-ledger-col-num lp-ledger-col-num--next">V2</span>
                  <div className="lp-ledger-col-heads">
                    <span className="lp-ledger-col-status lp-ledger-col-status--next">
                      <span className="lp-ledger-col-status-dot" />
                      {t('lp.ledger.v2Status', 'Shipping now')}
                    </span>
                    <h3 className="lp-ledger-col-title">{t('lp.ledger.v2Title', 'What the rebuild gives you.')}</h3>
                  </div>
                </div>
              </div>
              <ul className="lp-ledger-list">
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v2.universalLabel', 'Crypto, stocks, commodities, macro')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v2.universalDesc', "If it moves a market, it's here.")}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v2.agentsLabel', 'AI-native agents')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v2.agentsDesc', 'Agents surface what matters before you ask.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v2.infraLabel', 'Own infrastructure')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v2.infraDesc', 'Spectre API, 500+ endpoints, five exchange feeds, real-time data.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v2.newsLabel', 'Breaking news pipeline')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v2.newsDesc', 'Government sources, Bluesky, Telegram. Classified by AI in under 200ms.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v2.alertsLabel', 'Real-time alerts')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v2.alertsDesc', 'Push, email, Telegram. Tuned to your watchlists.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v2.surfacesLabel', 'Web, desktop, mobile')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v2.surfacesDesc', 'Full-screen pro terminal across every surface.')}</span>
                  </div>
                </li>
                <li className="lp-ledger-item">
                  <span className="lp-ledger-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
                  </span>
                  <div className="lp-ledger-item-body">
                    <strong className="lp-ledger-item-label">{t('lp.ledger.v2.gatingLabel', '$SPECTRE gating + subscriptions')}</strong>
                    <span className="lp-ledger-item-desc">{t('lp.ledger.v2.gatingDesc', 'Token access, paid tiers, API keys, future holder rewards.')}</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Token + CA */}
      <section id="token" className="lp-token">
        <div className="lp-token-inner">
          <div className="lp-token-header">
            <h2 className="lp-token-display">
              {t('lp.token.display', '$SPECTRE Token.')}
            </h2>
            <p className="lp-token-lede">{t('lp.token.lede', 'Access is tied to the wallet, not a billing cycle.')}</p>
            <p className="lp-token-sub">
              {t('lp.token.sub', 'Hold the tier threshold and the platform unlocks automatically. Every tool and every future upgrade stay accessible for as long as the wallet holds.')}
            </p>
          </div>

          {/* Hero CA block - the centerpiece */}
          <div className="lp-ca-card">
            <div className="lp-ca-top">
              <div className="lp-ca-chip">
                {/* Ethereum diamond logo */}
                <svg width="14" height="22" viewBox="0 0 256 417" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#F5F5F7" d="M127.9611 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z" opacity="0.95"/>
                  <path fill="#F5F5F7" d="M127.962 0L0 212.32l127.962 75.639V154.158z" opacity="0.65"/>
                  <path fill="#F5F5F7" d="M127.9611 312.1866l-1.575 1.92v98.199l1.575 4.601L256 236.5866z" opacity="0.95"/>
                  <path fill="#F5F5F7" d="M127.962 416.9052v-104.72L0 236.585z" opacity="0.65"/>
                  <path fill="#F5F5F7" d="M127.9611 287.9577l127.96-75.637-127.96-58.162z" opacity="0.85"/>
                  <path fill="#F5F5F7" d="M0 212.3208l127.96 75.637v-133.799z" opacity="0.75"/>
                </svg>
                {t('lp.token.chainEthereum', 'Ethereum')}
              </div>
              <div className="lp-ca-chip lp-ca-chip--muted">ERC-20</div>
              <div className="lp-ca-chip lp-ca-chip--muted">{t('lp.token.supply', '1,000,000,000 supply')}</div>
              <a
                href={ETHERSCAN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-ca-chip lp-ca-chip--link"
              >
                {t('lp.token.viewEtherscan', 'View on Etherscan')}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17L17 7M17 7H7M17 7v10" />
                </svg>
              </a>
            </div>

            <div className="lp-ca-label">{t('lp.token.contractAddress', 'Contract Address')}</div>

            <div className="lp-ca-hero">
              <code className="lp-ca-hero-hash">{CA}</code>
              <button
                type="button"
                className={`lp-ca-hero-copy${caCopied ? ' lp-ca-hero-copy--done' : ''}`}
                onClick={copyCA}
              >
                {caCopied ? (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {t('lp.token.copied', 'Copied')}
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                    {t('lp.token.copyAddress', 'Copy address')}
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="lp-token-ctas">
            <a className="lp-btn-glow" href="https://app.uniswap.org/explore/tokens/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6" target="_blank" rel="noopener noreferrer">
              {t('lp.token.buyUniswap', 'Buy on Uniswap')}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10" /></svg>
            </a>
            <a className="lp-btn-glow" href="https://www.dextools.io/app/en/ether/pair-explorer/0x9Cf0ED013e67DB12cA3AF8e7506fE401aA14dAd6" target="_blank" rel="noopener noreferrer">
              {t('lp.token.viewChart', 'View Chart')}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            </a>
          </div>
        </div>
      </section>

      {/* Live from @Spectre__AI */}
      {tweets.length > 0 && (
        <section className="lp-tweets">
          <div className="lp-tweets-inner">
            <div className="lp-tweets-head">
              <p className="lp-tweets-eyebrow">
                <span className="lp-tweets-dot" />
                {t('lp.tweets.eyebrow', 'Live from @Spectre__AI')}
              </p>
              <h2 className="lp-tweets-title">
                {t('lp.tweets.titleA', 'Signal,')} <em>{t('lp.tweets.titleB', 'straight from the feed.')}</em>
              </h2>
            </div>
            <div className="lp-tweets-grid">
              {tweets.slice(0, 6).map((tw) => (
                <a
                  key={tw.id}
                  href={tw.url || `https://x.com/${tw.handle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-tweet-card"
                >
                  <div className="lp-tweet-head">
                    <img
                      src={tw.avatar}
                      alt=""
                      className="lp-tweet-avatar"
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                    />
                    <div className="lp-tweet-identity">
                      <span className="lp-tweet-name">Spectre AI</span>
                      <span className="lp-tweet-handle">@{tw.handle}</span>
                    </div>
                    <svg className="lp-tweet-x" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </div>
                  <p className="lp-tweet-text">{cleanTweetText(tw.text)}</p>
                  {tw.mediaUrl && (
                    <div className="lp-tweet-media">
                      <img src={tw.mediaUrl} alt="" loading="lazy" />
                    </div>
                  )}
                  <div className="lp-tweet-footer">
                    <span className="lp-tweet-time">{formatRelative(tw.createdAt || tw.time, i18n.language, t)}</span>
                    <div className="lp-tweet-stats">
                      <span className="lp-tweet-stat" title={t('lp.tweets.viewsTitle', 'Views')}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                        {formatCount(tw.views)}
                      </span>
                      <span className="lp-tweet-stat" title={t('lp.tweets.likesTitle', 'Likes')}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                        {formatCount(tw.likes)}
                      </span>
                      <span className="lp-tweet-stat" title={t('lp.tweets.retweetsTitle', 'Retweets')}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                        {formatCount(tw.retweets)}
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
            <a
              href="https://x.com/Spectre__AI"
              target="_blank"
              rel="noopener noreferrer"
              className="lp-tweets-cta"
            >
              {t('lp.tweets.followCta', 'Follow @Spectre__AI on X')}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10" /></svg>
            </a>
          </div>
        </section>
      )}

      {/* Community */}
      <section id="community" className="lp-community">
        <div className="lp-community-visual" aria-hidden="true">
          <img src="/community-silhouettes.png" alt="" className="lp-community-image" />
          <div className="lp-community-visual-overlay" />
        </div>

        <div className="lp-community-inner">
          <div className="lp-community-head">
            <p className="lp-tag">{t('lp.community.tag', 'Community')}</p>
            <h2 className="lp-community-heading">
              <span className="lp-community-count">30,000+</span>
              <span className="lp-community-heading-sub">{t('lp.community.headingSub', 'members already inside the network.')}</span>
            </h2>
            <p className="lp-community-sub">
              {t('lp.community.sub', 'The community reads the same signals and compares notes in real time. Join while V2 is being built.')}
            </p>
          </div>

          <div className="lp-socials-grid">
            {SOCIALS.map((s) => (
              <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer" className="lp-social-card">
                <div className="lp-social-icon">{s.icon}</div>
                <div className="lp-social-info">
                  <span className="lp-social-name">{s.name}</span>
                  <span className="lp-social-count">{s.count}</span>
                </div>
                <svg className="lp-social-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10" /></svg>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-top">
            <div className="lp-footer-brand">
              <img src="/spectre-logo-dark.png" alt="" className="lp-footer-logo" />
              <span className="lp-footer-wordmark">Spectre AI</span>
            </div>
            <div className="lp-footer-links">
              <a href="/">{t('lp.footer.mainWebsite', 'Main Website')}</a>
              <a href="https://x.com/Spectre__AI" target="_blank" rel="noopener noreferrer">X</a>
              <a href="https://telegram.me/AI_SPECTRE" target="_blank" rel="noopener noreferrer">Telegram</a>
              <a href="https://www.youtube.com/@ai-spectre" target="_blank" rel="noopener noreferrer">YouTube</a>
              <a href="https://www.linkedin.com/company/ai-spectre" target="_blank" rel="noopener noreferrer">LinkedIn</a>
              <a href="mailto:spectre@spectreai.io">spectre@spectreai.io</a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>{t('lp.footer.copyright', '© 2026 Spectre AI. All rights reserved.')}</span>
            <div className="lp-footer-status">
              <span className="lp-footer-status-dot" />
              {t('lp.footer.status', 'All systems operational')}
            </div>
          </div>
        </div>
      </footer>

      {/* V1 / V2 comparison lightbox */}
      {morphLightbox && (
        <div
          className="lp-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={t('lp.lightbox.dialogAria', 'V1 and V2 side-by-side comparison')}
          onClick={() => setMorphLightbox(null)}
        >
          <button
            type="button"
            className="lp-lightbox-close"
            onClick={(e) => { e.stopPropagation(); setMorphLightbox(null) }}
            aria-label={t('lp.lightbox.closeAria', 'Close comparison')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>

          <div className="lp-lightbox-stage" onClick={(e) => e.stopPropagation()}>
            <div className="lp-lightbox-switcher">
              <button
                type="button"
                className={`lp-lightbox-tab${morphLightbox === 'v1' ? ' is-active' : ''}`}
                onClick={() => setMorphLightbox('v1')}
              >
                <span className="lp-lightbox-tab-kicker">{t('lp.lightbox.oldPlatform', 'Old Platform')}</span>
              </button>
              <button
                type="button"
                className={`lp-lightbox-tab${morphLightbox === 'v2' ? ' is-active' : ''}`}
                onClick={() => setMorphLightbox('v2')}
              >
                <span className="lp-lightbox-tab-kicker">{t('lp.lightbox.newPlatform', 'New Platform')}</span>
              </button>
            </div>

            <div className="lp-lightbox-rail">
              <div className={`lp-lightbox-frame${morphLightbox === 'v1' ? ' is-active' : ''}`}>
                <img src="/v1-spectre-research.png" alt={t('lp.morph.v1Alt', 'Spectre V1 Research Zone')} />
              </div>
              <div className={`lp-lightbox-frame${morphLightbox === 'v2' ? ' is-active' : ''}`}>
                <img src="/screenshots/command-center.png" alt={t('lp.morph.v2Alt', 'Spectre V2 Command Center')} />
              </div>
            </div>

            <p className="lp-lightbox-caption">
              {morphLightbox === 'v1'
                ? t('lp.lightbox.captionV1', 'V1 shipped in 2024 and has run in production for a year.')
                : t('lp.lightbox.captionV2', 'V2 launches in 2026, rewritten from scratch as a unified market command center.')}
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════ WAITLIST THANKS MODAL ═══════════════════════ */}
      {thanksOpen && (
        <div
          className="w2-thanks-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lp-thanks-title"
          onClick={() => setThanksOpen(false)}
        >
          <div className="w2-thanks-modal-backdrop" aria-hidden="true" />
          <div className="w2-thanks-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="w2-thanks-modal-glow" aria-hidden="true" />
            <button
              type="button"
              className="w2-thanks-modal-close"
              onClick={() => setThanksOpen(false)}
              aria-label={t('lp.thanks.closeAria', 'Close')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>

            <div className="w2-thanks-modal-check">
              <span className="w2-thanks-modal-check-ring" aria-hidden="true" />
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </div>

            <div className="w2-thanks-modal-eyebrow">
              <span className="w2-thanks-modal-dot" />
              {t('lp.thanks.eyebrow', "You're on the list")}
            </div>

            <h3 id="lp-thanks-title" className="w2-thanks-modal-title">
              {t('lp.thanks.title', 'Welcome to Spectre.')}
            </h3>
            <p className="w2-thanks-modal-sub">
              {t('lp.thanks.sub', "We'll email you when a seat opens. $SPECTRE holders get access first.")}
            </p>

            <div className="w2-thanks-modal-actions">
              <button
                type="button"
                className="w2-thanks-modal-btn w2-thanks-modal-btn--primary"
                onClick={() => setThanksOpen(false)}
              >
                {t('lp.thanks.gotIt', 'Got it')}
              </button>
              <a
                className="w2-thanks-modal-btn w2-thanks-modal-btn--ghost"
                href="https://x.com/Spectre__AI"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('lp.thanks.followX', 'Follow on X')}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
              </a>
            </div>

            <div className="w2-thanks-modal-footer">
              <span className="w2-thanks-modal-footer-dot" />
              <span>{t('lp.thanks.footer', 'Seat held. No spam, ever.')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
