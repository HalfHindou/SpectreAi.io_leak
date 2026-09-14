import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ArchitectureFlow from './components/ArchitectureFlow'
import './website.css'

/* ══════════════════════════════════════════════════════════════
   DATA CONSTANTS
   ══════════════════════════════════════════════════════════════ */

const NAV_LINKS = [
  { label: 'Home', id: 'home' },
  { label: 'Why', id: 'why' },
  { label: 'Platform', id: 'research' },
  { label: 'Token', id: 'tokenomics' },
  { label: 'Roadmap', id: 'roadmap' },
  { label: 'Team', id: 'about' },
  { label: 'Partners', id: 'partners' },
]

/* Inline SVG helper - matches spectreIcons.jsx style (strokeWidth 1.5, round caps) */
const wsIcon = (paths, size = 22) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(paths) ? paths : [paths]).map((d, i) => <path key={i} d={d} />)}
  </svg>
)

/* Icons pulled from spectreIcons.jsx - the app's actual icon language */
const ICONS = {
  dashboard: 'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25',
  library: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  technical: 'M12 20V10M18 20V4M6 20v-4',
  news: 'M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z',
  globe: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
  monarch: 'M12 2L9 8.5L3 10l4.5 5L6 21l6-3l6 3l-1.5-6L21 10l-6-1.5L12 2z',
  user: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z',
}

/* ── WHY section - selling benefits, not features ── */
const WHY_CARDS = [
  {
    num: '01',
    title: 'Wake up smarter',
    desc: 'Every morning, Spectre delivers an AI-generated market brief - what moved overnight, what is building momentum, and what matters today. No noise. Just the signal.',
    color: '#6B9AE8',
    iconPath: 'M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z',
    points: ['AI Morning Brief with actionable insights', 'Fear & Greed sentiment context', 'Macro events that impact your portfolio'],
  },
  {
    num: '02',
    title: 'See what others miss',
    desc: '50,000+ tokens tracked across 500+ data sources. The research that takes analysts hours - delivered in seconds. On-chain metrics, social sentiment, and AI-written theses in one view.',
    color: '#10B981',
    iconPath: 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
    points: ['Institutional-grade research on any token', 'Real-time on-chain and DEX analytics', 'AI pattern detection across markets'],
  },
  {
    num: '03',
    title: 'Move before the crowd',
    desc: 'Real-time liquidation tracking, social pulse monitoring, and whale movement alerts. Know when sentiment shifts before it hits the price.',
    color: '#EC4899',
    iconPath: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
    points: ['Real-time intelligence feeds', 'Social volume and narrative detection', 'Smart alerts before price moves'],
  },
]

/* ── Testimonials ── */
const TESTIMONIALS = [
  { quote: 'The morning brief alone replaced three apps I was paying for. I open Spectre before I open Twitter.', name: 'Marcus R.', role: 'Crypto Day Trader', initials: 'MR' },
  { quote: 'Research Zone gave me the confidence to take bigger positions. The AI thesis generation is genuinely useful.', name: 'Sarah L.', role: 'Portfolio Analyst', initials: 'SL' },
  { quote: 'I caught the SOL breakout 40 minutes early because of the social pulse alerts. That single trade paid for a year.', name: 'David K.', role: 'Swing Trader', initials: 'DK' },
  { quote: 'Finally, a platform that treats crypto research like equity research. Bloomberg-level depth without Bloomberg-level pricing.', name: 'James W.', role: 'Fund Manager', initials: 'JW' },
  { quote: 'The heatmaps and liquidation data are incredible. I can see where the leverage is stacked before the flush happens.', name: 'Elena V.', role: 'Derivatives Trader', initials: 'EV' },
  { quote: 'Switched from TradingView + CoinGecko + Nansen to just Spectre. Everything in one place, and the AI actually adds value.', name: 'Tom H.', role: 'Full-time Trader', initials: 'TH' },
]

/* ── Product categories (clean card version) ── */
const PRODUCT_CATEGORIES = [
  {
    id: 'command-center',
    name: 'Command Center',
    tagline: 'YOUR DAILY BRIEFING',
    desc: 'AI-generated market briefs, sentiment gauges, watchlist snapshots, and macro context.',
    color: '#6B9AE8',
    icon: wsIcon(ICONS.dashboard),
    features: ['AI Morning Brief', 'Fear & Greed Index', 'Watchlist Overview', 'Market Stats', 'Macro Context'],
  },
  {
    id: 'research',
    name: 'Research',
    tagline: 'INSTITUTIONAL-GRADE ANALYSIS',
    desc: 'Deep-dive into any token with AI-written research, real-time charts, and on-chain metrics.',
    color: '#10B981',
    icon: wsIcon(ICONS.library),
    features: ['Research Zone', 'Token Detail', 'Discover', 'Search Engine', 'Categories', 'Structure Guide'],
  },
  {
    id: 'trading',
    name: 'Trading',
    tagline: 'PROFESSIONAL TOOLS',
    desc: 'Canvas-rendered charts, multi-chart terminals, modular workspaces, and liquidation tracking.',
    color: '#F59E0B',
    icon: wsIcon(ICONS.technical),
    features: ['AI Charts', 'AI Charts Lab', "Trader's Corner", 'Trading Lite', 'ROI Calculator', 'Liquidation Heatmap'],
  },
  {
    id: 'intelligence',
    name: 'Intelligence',
    tagline: 'REAL-TIME NEWS ENGINE',
    desc: 'AI-curated news, X sentiment analysis, social pulse tracking, and narrative detection.',
    color: '#3B82F6',
    icon: wsIcon(ICONS.news),
    features: ['News Feed', 'X Dashboard', 'X Bubbles', 'X Intelligence', 'Social Zone', 'Lens', 'AI Media Center'],
  },
  {
    id: 'visualize',
    name: 'Visualize',
    tagline: 'SEE THE MARKET',
    desc: 'Heatmaps, bubble charts, 3D globe, economic calendars, and venture tracking.',
    color: '#EC4899',
    icon: wsIcon(ICONS.globe),
    features: ['Heatmaps', 'Bubbles', '3D Globe', 'Economic Calendar', 'Ventures', 'Tokenized Assets'],
  },
  {
    id: 'ai',
    name: 'AI Agents',
    tagline: 'AUTONOMOUS INTELLIGENCE',
    desc: 'Specialized AI agents that analyze markets 24/7 - conversational chat to automated reports.',
    color: '#A78BFA',
    icon: wsIcon(ICONS.monarch),
    features: ['Monarch Chat', 'AI Market Analysis', 'GM Dashboard'],
  },
]

const SOCIAL_STATS = [
  { value: '2,400+', label: 'Active Traders' },
  { value: '50,000+', label: 'Tokens Tracked' },
  { value: '500+', label: 'Data Sources' },
  { value: '24/7', label: 'AI Monitoring' },
  { value: '12', label: 'Tools' },
]

const TEAM = [
  { name: 'Sunny', role: 'Founder & Lead', initial: 'S' },
  { name: 'Alaa', role: 'Lead AI', initial: 'A' },
  { name: 'Haitham', role: 'Agentic Backend', initial: 'H' },
  { name: 'KD', role: 'Blockchain', initial: 'K' },
  { name: 'Adamski', role: 'Software Lead', initial: 'A' },
]

const ROADMAP = [
  {
    quarter: 'Q1 2026',
    title: 'Platform Launch',
    desc: 'Core dashboard, AI agents, multi-chain data aggregation, and real-time market intelligence.',
    status: 'active',
  },
  {
    quarter: 'Q2 2026',
    title: 'Trading Terminal',
    desc: 'Advanced charts, whale tracking, liquidation heatmaps, and professional order flow tools.',
    status: 'upcoming',
  },
  {
    quarter: 'Q3 2026',
    title: 'Mobile App',
    desc: 'iOS and Android native apps with full feature parity, push alerts, and biometric security.',
    status: 'upcoming',
  },
  {
    quarter: 'Q4 2026',
    title: 'Institutional',
    desc: 'White-label API, team seats, custom reports, and enterprise-grade compliance tooling.',
    status: 'upcoming',
  },
]

const TIERS = [
  { name: 'Starter', amount: '500+', desc: 'Core dashboards, basic AI analysis, multi-chain data access.' },
  { name: 'Pro', amount: '1,000+', desc: 'Advanced research, whale alerts, premium AI agents, priority support.' },
  { name: 'Elite', amount: '7,000+', desc: 'Full platform access, institutional tools, API, custom reports.' },
]

const PARTNERS = [
  { name: 'CoinGecko', icon: 'https://www.google.com/s2/favicons?domain=coingecko.com&sz=32' },
  { name: 'Binance', icon: 'https://www.google.com/s2/favicons?domain=binance.com&sz=32' },
  { name: 'Uniswap', icon: 'https://www.google.com/s2/favicons?domain=uniswap.org&sz=32' },
  { name: 'Codex', icon: 'https://www.google.com/s2/favicons?domain=codex.io&sz=32' },
  { name: 'Yahoo Finance', icon: 'https://www.google.com/s2/favicons?domain=finance.yahoo.com&sz=32' },
  { name: 'Perplexity AI', icon: 'https://www.google.com/s2/favicons?domain=perplexity.ai&sz=32' },
]

const FOOTER_LINKS = {
  product: [
    { label: 'Command Center', path: '/' },
    { label: 'Research Zone', path: '/research-zone' },
    { label: 'Intelligence', path: '/intelligence' },
    { label: 'AI Charts', path: '/ai-charts' },
    { label: 'Pricing', path: '/pricing' },
  ],
  tools: [
    { label: 'Fear & Greed', path: '/fear-greed' },
    { label: 'Heatmaps', path: '/heatmaps' },
    { label: 'Economic Calendar', path: '/economic-calendar' },
    { label: "Trader's Corner", path: '/traders-corner' },
    { label: 'Watchlists', path: '/watchlists' },
  ],
  resources: [
    { label: 'Whitepaper', href: '#' },
    { label: 'Documentation', href: '#' },
    { label: 'GitHub', href: 'https://github.com/Spectre-AI-Bot/spectre-app' },
    { label: 'API Reference', href: '#' },
  ],
  company: [
    { label: 'About', href: '#about' },
    { label: 'Blog', href: '#' },
    { label: 'Careers', href: '#' },
    { label: 'Contact', href: 'mailto:sales@spectreai.io' },
  ],
}

const SECTION_IDS = ['home', 'why', 'research', 'tokenomics', 'roadmap', 'about', 'partners']

/* ══════════════════════════════════════════════════════════════
   COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function WebsitePage() {
  const navigate = useNavigate()
  const iframeRef = useRef(null)
  const videoRef = useRef(null)
  const timelineRef = useRef(null)
  const wirePathRef = useRef(null)
  const [emailInput, setEmailInput] = useState('')
  const [activeSection, setActiveSection] = useState('home')
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  // expandedCategories removed - using clean card layout now
  const [wireProgress, setWireProgress] = useState(0)

  // Load Geist + Fustat fonts
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Fustat:wght@600;700;800&display=swap'
    document.head.appendChild(link)
    return () => { if (link.parentNode) link.parentNode.removeChild(link) }
  }, [])

  // Override root/body overflow for this page
  useEffect(() => {
    const html = document.documentElement
    const root = document.getElementById('root')
    const prev = {
      htmlHeight: html.style.height,
      htmlOverflow: html.style.overflow,
      rootHeight: root?.style.height,
      rootOverflow: root?.style.overflow,
      bodyOverflow: document.body.style.overflow,
      bodyOverflowX: document.body.style.overflowX,
      bodyOverflowY: document.body.style.overflowY,
    }
    html.style.height = 'auto'
    html.style.overflow = 'visible'
    if (root) { root.style.height = 'auto'; root.style.overflow = 'visible' }
    document.body.style.overflowX = 'hidden'
    document.body.style.overflowY = 'visible'
    return () => {
      html.style.height = prev.htmlHeight
      html.style.overflow = prev.htmlOverflow
      if (root) { root.style.height = prev.rootHeight; root.style.overflow = prev.rootOverflow }
      document.body.style.overflow = prev.bodyOverflow
      document.body.style.overflowX = prev.bodyOverflowX
      document.body.style.overflowY = prev.bodyOverflowY
    }
  }, [])

  // Track active section via IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => { entries.forEach((entry) => { if (entry.isIntersecting) setActiveSection(entry.target.id) }) },
      { threshold: 0.5 }
    )
    SECTION_IDS.forEach((id) => { const el = document.getElementById(id); if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [])

  // Track scroll position for nav styling
  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 100)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Scroll reveal animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => { entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('ws-visible') }) },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    )
    document.querySelectorAll('.ws-reveal, .ws-reveal-left, .ws-reveal-right, .ws-reveal-scale').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  // Roadmap wire scroll-driven animation
  useEffect(() => {
    const timeline = timelineRef.current
    if (!timeline) return
    const handleScroll = () => {
      const rect = timeline.getBoundingClientRect()
      const viewH = window.innerHeight
      const start = rect.top - viewH * 0.8
      const end = rect.bottom - viewH * 0.3
      const progress = Math.max(0, Math.min(1, (0 - start) / (end - start)))
      setWireProgress(progress)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  // toggleCategory removed - clean card layout doesn't need expand/collapse

  // Wire path for roadmap SVG
  const wirePathLength = wirePathRef.current?.getTotalLength?.() || 800

  return (
    <div className="ws-landing">

      {/* ================================================================
          SECTION 1: HERO
          ================================================================ */}
      <section className="ws-hero" id="home">
        <div className="ws-social-sidebar">
          <a href="https://x.com/Spectre__AI" target="_blank" rel="noopener noreferrer" className="ws-social-link" title="X (Twitter)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
          </a>
          <a href="https://telegram.me/AI_SPECTRE" target="_blank" rel="noopener noreferrer" className="ws-social-link" title="Telegram">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
          </a>
          <a href="https://www.youtube.com/@ai-spectre" target="_blank" rel="noopener noreferrer" className="ws-social-link" title="YouTube">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
          </a>
          <a href="https://www.linkedin.com/company/ai-spectre" target="_blank" rel="noopener noreferrer" className="ws-social-link" title="LinkedIn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
          </a>
        </div>

        <div className="ws-hero-frame">
          <div className="ws-video-bg">
            <video ref={videoRef} autoPlay muted loop playsInline className="ws-video">
              <source src="/spectre-hero.mp4" type="video/mp4" />
            </video>
            <div className="ws-video-overlay" />
            <button className="ws-volume-btn" onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setIsMuted(v.muted) } }} title={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
              )}
            </button>
          </div>

          <header className="ws-header">
            <div className="ws-header-left">
              <img src="/spectre-logo-dark.png" alt="Spectre AI" className="ws-logo-img" />
              <span className="ws-logo-text">Spectre AI</span>
            </div>
            <div className="ws-header-right">
              <button className="ws-btn-glass" onClick={() => navigate('/')}>Log in</button>
              <a className="ws-btn-download" href="#" onClick={(e) => e.preventDefault()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" /></svg>
                Download for Mac
              </a>
            </div>
          </header>

          <div className="ws-hero-content">
            <h1 className="ws-hero-title">AI Market Intelligence<br /><span className="ws-hero-title-dim">for Stocks & Crypto</span></h1>
            <p className="ws-hero-sub">Real-time analysis, institutional-grade research, and AI-powered insights. All in one platform.</p>
          </div>

          <div className="ws-hero-actions">
            <a className="ws-btn-primary-pill" href="https://app.uniswap.org/explore/tokens/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6" target="_blank" rel="noopener noreferrer">Buy $SPECTRE</a>
            <button className="ws-btn-glass-pill" onClick={() => navigate('/')}>Launch App <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg></button>
            <a className="ws-btn-glass-pill" href="https://x.com/SpectreAI_Bot" target="_blank" rel="noopener noreferrer">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              Join X
            </a>
          </div>
        </div>

        <div className="ws-hero-bottom-peek" onClick={() => scrollTo('showcase')} style={{ cursor: 'pointer' }}>
          <div className="ws-peek-inner">
            <div className="ws-peek-macbook"><div className="ws-peek-lid"><div className="ws-peek-screen" /><div className="ws-peek-notch" /></div><div className="ws-peek-base" /></div>
            <div className="ws-peek-text">
              <span className="ws-peek-label">See the platform</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          SECTION 1.5: MACBOOK SHOWCASE
          ================================================================ */}
      <section className="ws-macbook-showcase" id="showcase">
        <div className="ws-macbook-wrapper ws-reveal">
          <div className="ws-macbook-glow" />
          <div className="ws-macbook-device">
            <div className="ws-macbook-screen-bezel">
              <div className="ws-macbook-camera" />
              <div className="ws-macbook-screen-inner">
                <iframe ref={iframeRef} src="/" title="Spectre AI Platform" className="ws-macbook-iframe" loading="lazy" />
              </div>
            </div>
            <div className="ws-macbook-bottom-lid"><div className="ws-macbook-hinge" /></div>
          </div>
        </div>
      </section>

      {/* ================================================================
          SECTION 2: ARCHITECTURE DIAGRAM — React Flow node-wire
          ================================================================ */}
      <section className="ws-arch" id="markets">
        <div className="ws-section-header ws-reveal">
          <p className="ws-tag">How It Works</p>
          <h2 className="ws-heading">Data in. <span className="ws-heading-dim">Intelligence out.</span></h2>
        </div>

        <div className="ws-reveal">
          <ArchitectureFlow />
        </div>

        {/* Stats bar */}
        <div className="ws-arch-stats ws-reveal">
          {SOCIAL_STATS.map((stat) => (
            <div className="ws-arch-stat" key={stat.label}>
              <span className="ws-arch-stat-value">{stat.value}</span>
              <span className="ws-arch-stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ================================================================
          SECTION 2.5: MARKET GAP — PMF Visualization
          ================================================================ */}
      <section className="ws-gap">
        <div className="ws-section-header ws-section-header--light ws-reveal">
          <p className="ws-tag ws-tag--light">The Gap</p>
          <h2 className="ws-heading ws-heading--light">Everyone chose a side.<br /><span className="ws-heading-dim--light">We chose the middle.</span></h2>
        </div>

        {/* Spectre logo above, pointing down into the void */}
        <div className="ws-gap-spectre ws-reveal">
          <img src="/spectre-logo-dark.png" alt="Spectre" className="ws-gap-spectre-logo" />
          <span className="ws-gap-spectre-name">Spectre</span>
          <span className="ws-gap-spectre-sub">Intelligence + Community</span>
          <svg className="ws-gap-spectre-arrow" width="20" height="64" viewBox="0 0 20 64" fill="none">
            <path d="M10 0 L10 50" stroke="rgba(0,0,0,0.15)" strokeWidth="1.5" strokeDasharray="4 4" />
            <path d="M4 46 L10 58 L16 46" stroke="#1d1d1f" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="ws-gap-canvas ws-reveal">
          {/* Left - Community */}
          <div className="ws-gap-side">
            <div className="ws-gap-side-label">Community Lives Here</div>
            <div className="ws-gap-cluster">
              <div className="ws-gap-bubble ws-gap-bubble--warm ws-gap-bubble--xl" style={{ animationDelay: '0s' }}>
                <span>X / CT</span>
              </div>
              <div className="ws-gap-bubble ws-gap-bubble--warm ws-gap-bubble--lg" style={{ animationDelay: '0.8s' }}>
                <span>Discord</span>
              </div>
              <div className="ws-gap-bubble ws-gap-bubble--warm ws-gap-bubble--lg" style={{ animationDelay: '1.6s' }}>
                <span>Telegram</span>
              </div>
              <div className="ws-gap-bubble ws-gap-bubble--warm ws-gap-bubble--md" style={{ animationDelay: '2.4s' }}>
                <span>Reddit</span>
              </div>
            </div>
            <div className="ws-gap-verdict">Opinions. No data.</div>
          </div>

          {/* Center - The Void */}
          <div className="ws-gap-void">
            <div className="ws-gap-void-border" />
            <div className="ws-gap-void-inner">
              <div className="ws-gap-void-text">Nobody is here</div>
              <div className="ws-gap-void-sub">Intelligence + Community</div>
            </div>
          </div>

          {/* Right - Data */}
          <div className="ws-gap-side">
            <div className="ws-gap-side-label">Data Lives Here</div>
            <div className="ws-gap-cluster ws-gap-cluster--right">
              <div className="ws-gap-bubble ws-gap-bubble--cool ws-gap-bubble--xl" style={{ animationDelay: '0.4s' }}>
                <span>Nansen</span>
              </div>
              <div className="ws-gap-bubble ws-gap-bubble--cool ws-gap-bubble--lg" style={{ animationDelay: '1.2s' }}>
                <span>DeFiLlama</span>
              </div>
              <div className="ws-gap-bubble ws-gap-bubble--cool ws-gap-bubble--md" style={{ animationDelay: '2s' }}>
                <span>Dune</span>
              </div>
              <div className="ws-gap-bubble ws-gap-bubble--cool ws-gap-bubble--lg" style={{ animationDelay: '0.6s' }}>
                <span>Messari</span>
              </div>
              <div className="ws-gap-bubble ws-gap-bubble--cool ws-gap-bubble--md" style={{ animationDelay: '1.4s' }}>
                <span>CMC</span>
              </div>
              <div className="ws-gap-bubble ws-gap-bubble--cool ws-gap-bubble--md" style={{ animationDelay: '2.2s' }}>
                <span>CoinGecko</span>
              </div>
              <div className="ws-gap-bubble ws-gap-bubble--cool ws-gap-bubble--sm" style={{ animationDelay: '1.8s' }}>
                <span>Bloomberg</span>
              </div>
            </div>
            <div className="ws-gap-verdict">Data. No community.</div>
          </div>
        </div>
      </section>

      {/* ================================================================
          SECTION 2.75: LIVE PULSE — Animated Data Typography
          ================================================================ */}
      <section className="ws-pulse">
        <div className="ws-pulse-glow" />

        <div className="ws-pulse-header ws-reveal">
          <h2 className="ws-pulse-title">The market never sleeps.</h2>
          <p className="ws-pulse-sub">Neither do we.</p>
        </div>

        <div className="ws-pulse-grid ws-reveal">
          {/* Primary price - large */}
          <div className="ws-pulse-item ws-pulse-item--hero ws-stagger-1">
            <span className="ws-pulse-label">BTC / USD</span>
            <span className="ws-pulse-price">
              $97,48<span className="ws-pulse-tick">2.50</span>
            </span>
          </div>

          {/* Percentage change */}
          <div className="ws-pulse-item ws-pulse-item--change ws-stagger-2">
            <span className="ws-pulse-change-value ws-pulse-change--up">+3.47%</span>
            <span className="ws-pulse-change-label">24h Change</span>
          </div>

          {/* Market cap */}
          <div className="ws-pulse-item ws-pulse-item--stat ws-stagger-3">
            <span className="ws-pulse-stat-value">$2.1T</span>
            <span className="ws-pulse-stat-label">Total Market Cap</span>
          </div>

          {/* Fear & Greed */}
          <div className="ws-pulse-item ws-pulse-item--fng ws-stagger-4">
            <span className="ws-pulse-fng-number">72</span>
            <span className="ws-pulse-fng-label">Greed</span>
          </div>

          {/* Heartbeat line - spans full width */}
          <div className="ws-pulse-item ws-pulse-item--line ws-stagger-5">
            <svg className="ws-pulse-heartbeat" viewBox="0 0 800 60" preserveAspectRatio="none">
              <path className="ws-pulse-heartbeat-path" d="M0,30 L120,30 L140,30 L160,8 L180,52 L200,20 L220,40 L240,30 L400,30 L420,30 L440,10 L460,50 L480,22 L500,38 L520,30 L800,30" />
              <path className="ws-pulse-heartbeat-glow" d="M0,30 L120,30 L140,30 L160,8 L180,52 L200,20 L220,40 L240,30 L400,30 L420,30 L440,10 L460,50 L480,22 L500,38 L520,30 L800,30" />
            </svg>
          </div>

          {/* Token symbols row */}
          <div className="ws-pulse-item ws-pulse-item--tokens ws-stagger-6">
            <div className="ws-pulse-token">
              <span className="ws-pulse-token-symbol">BTC</span>
              <svg className="ws-pulse-token-spark" viewBox="0 0 60 20"><path d="M0,14 L8,12 L16,10 L24,8 L32,11 L40,6 L48,4 L56,7 L60,5" fill="none" stroke="#10B981" strokeWidth="1.5" /></svg>
            </div>
            <div className="ws-pulse-token">
              <span className="ws-pulse-token-symbol">ETH</span>
              <svg className="ws-pulse-token-spark" viewBox="0 0 60 20"><path d="M0,8 L8,10 L16,12 L24,9 L32,14 L40,12 L48,15 L56,13 L60,16" fill="none" stroke="#EF4444" strokeWidth="1.5" /></svg>
            </div>
            <div className="ws-pulse-token">
              <span className="ws-pulse-token-symbol">SOL</span>
              <svg className="ws-pulse-token-spark" viewBox="0 0 60 20"><path d="M0,16 L8,14 L16,11 L24,13 L32,9 L40,7 L48,10 L56,6 L60,4" fill="none" stroke="#10B981" strokeWidth="1.5" /></svg>
            </div>
          </div>

          {/* Volume */}
          <div className="ws-pulse-item ws-pulse-item--vol ws-stagger-7">
            <span className="ws-pulse-stat-value">$84.2B</span>
            <span className="ws-pulse-stat-label">24h Volume</span>
          </div>

          {/* ETH price */}
          <div className="ws-pulse-item ws-pulse-item--eth ws-stagger-8">
            <span className="ws-pulse-label">ETH</span>
            <span className="ws-pulse-price ws-pulse-price--sm">
              $3,84<span className="ws-pulse-tick">1.20</span>
            </span>
          </div>
        </div>
      </section>

      {/* ================================================================
          SECTION 3: WHY SPECTRE — selling benefits, not features
          ================================================================ */}
      <section className="ws-why" id="why">
        <div className="ws-section-header ws-reveal">
          <p className="ws-tag">Why Spectre</p>
          <h2 className="ws-heading">The unfair advantage<br /><span className="ws-heading-dim">you have been looking for.</span></h2>
        </div>

        <div className="ws-why-cards">
          {WHY_CARDS.map((card, i) => (
            <div className={`ws-why-card ws-reveal ws-stagger-${i + 1}`} key={card.num}>
              <div className="ws-why-card-accent" style={{ background: `linear-gradient(180deg, ${card.color}, transparent)` }} />
              <div className="ws-why-card-content">
                <div className="ws-why-num" style={{ color: card.color }}>{card.num}</div>
                <div className="ws-why-icon" style={{ color: card.color }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={card.iconPath} /></svg>
                </div>
                <h3 className="ws-why-title">{card.title}</h3>
                <p className="ws-why-desc">{card.desc}</p>
                <ul className="ws-why-points">
                  {card.points.map((p) => (
                    <li key={p}>
                      <span className="ws-why-dot" style={{ background: card.color }} />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================================================================
          SECTION 4: TESTIMONIALS
          ================================================================ */}
      <section className="ws-testimonials">
        <div className="ws-section-header ws-reveal">
          <p className="ws-tag">Traders Trust Spectre</p>
          <h2 className="ws-heading">What our users say.</h2>
        </div>

        <div className="ws-testimonials-grid ws-reveal">
          {TESTIMONIALS.map((t, i) => (
            <div className={`ws-testimonial-card ws-reveal-scale ws-stagger-${(i % 5) + 1}`} key={t.name}>
              <svg className="ws-testimonial-quote" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" opacity="0.08"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10H14.017zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10H0z" /></svg>
              <p className="ws-testimonial-text">{t.quote}</p>
              <div className="ws-testimonial-author">
                <div className="ws-testimonial-avatar">{t.initials}</div>
                <div>
                  <div className="ws-testimonial-name">{t.name}</div>
                  <div className="ws-testimonial-role">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================================================================
          SECTION 5: PRODUCT CATEGORIES — clean card grid
          ================================================================ */}
      <section className="ws-categories" id="research">
        <div className="ws-section-header ws-reveal">
          <p className="ws-tag">Platform</p>
          <h2 className="ws-heading">38+ tools. Six categories.<br /><span className="ws-heading-dim">One platform.</span></h2>
        </div>

        <div className="ws-categories-grid">
          {PRODUCT_CATEGORIES.map((cat, i) => (
            <div className={`ws-category-card ws-reveal ws-stagger-${(i % 4) + 1}`} key={cat.id} style={{ '--cat-color': cat.color }}>
              <div className="ws-category-accent" />
              <div className="ws-category-header">
                <div className="ws-category-icon">{cat.icon}</div>
                <div>
                  <span className="ws-category-tagline">{cat.tagline}</span>
                  <h3 className="ws-category-name">{cat.name}</h3>
                </div>
              </div>
              <p className="ws-category-desc">{cat.desc}</p>
              <div className="ws-category-pills">
                {cat.features.map((f) => (
                  <span className="ws-category-pill" key={f}>{f}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================================================================
          SECTION 5: TOKENOMICS — dark
          ================================================================ */}
      <section className="ws-tokenomics" id="tokenomics">
        <div className="ws-section-header ws-reveal">
          <p className="ws-tag">Tokenomics</p>
          <h2 className="ws-heading">$SPECTRE Token</h2>
          <p className="ws-subtext">The native token powering the Spectre AI ecosystem. Hold $SPECTRE to unlock premium features, governance rights, and platform rewards.</p>
        </div>
        <div className="ws-token-metrics ws-reveal">
          <div className="ws-token-metric"><span className="ws-token-metric-label">Total Supply</span><span className="ws-token-metric-value">1,000,000,000</span></div>
          <div className="ws-token-metric"><span className="ws-token-metric-label">Token Type</span><span className="ws-token-metric-value">ERC-20</span></div>
          <div className="ws-token-metric"><span className="ws-token-metric-label">Network</span><span className="ws-token-metric-value">Ethereum</span></div>
        </div>
        <div className="ws-tiers ws-reveal">
          {TIERS.map((tier) => (
            <div className="ws-tier-card" key={tier.name}><span className="ws-tier-name">{tier.name}</span><span className="ws-tier-amount">{tier.amount} $SPECTRE</span><p className="ws-tier-desc">{tier.desc}</p></div>
          ))}
        </div>
        <p className="ws-token-discount">Pay with $SPECTRE and save 10% on all premium tiers.</p>
        <div className="ws-token-cta">
          <a className="ws-btn-primary-pill" href="https://app.uniswap.org/explore/tokens/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6" target="_blank" rel="noopener noreferrer">Buy on Uniswap <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10" /></svg></a>
        </div>
      </section>

      {/* ================================================================
          SECTION 6: ROADMAP — light, animated wire
          ================================================================ */}
      <section className="ws-roadmap" id="roadmap">
        <div className="ws-section-header ws-section-header--light ws-reveal">
          <p className="ws-tag ws-tag--light">Roadmap</p>
          <h2 className="ws-heading ws-heading--light">What's next.</h2>
        </div>

        <div className="ws-timeline" ref={timelineRef}>
          {/* Animated SVG wire */}
          <svg className="ws-timeline-wire" viewBox="0 0 400 600" preserveAspectRatio="none">
            <defs>
              <linearGradient id="ws-wire-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(107,154,232,0.6)" />
                <stop offset="60%" stopColor="rgba(107,154,232,0.3)" />
                <stop offset="100%" stopColor="rgba(107,154,232,0.08)" />
              </linearGradient>
            </defs>
            {/* Glow layer */}
            <path
              className="ws-wire-glow"
              d="M200,0 C100,60 300,120 200,180 C100,240 300,300 200,360 C100,420 300,480 200,540 L200,600"
              style={{
                strokeDasharray: wirePathLength,
                strokeDashoffset: wirePathLength * (1 - wireProgress),
              }}
            />
            {/* Main wire */}
            <path
              ref={wirePathRef}
              className="ws-wire-path"
              d="M200,0 C100,60 300,120 200,180 C100,240 300,300 200,360 C100,420 300,480 200,540 L200,600"
              style={{
                strokeDasharray: wirePathLength,
                strokeDashoffset: wirePathLength * (1 - wireProgress),
              }}
            />
          </svg>

          {ROADMAP.map((item, i) => {
            const side = i % 2 === 0 ? 'ws-timeline-left' : 'ws-timeline-right'
            const reveal = i % 2 === 0 ? 'ws-reveal-left' : 'ws-reveal-right'
            const active = item.status === 'active' ? ' ws-timeline-item--active' : ''
            const dotReached = wireProgress > (i / ROADMAP.length) ? ' ws-timeline-dot--reached' : ''
            return (
              <div className={`ws-timeline-item ${side}${active} ${reveal} ws-stagger-${i + 1}`} key={item.quarter}>
                <div className={`ws-timeline-dot${item.status === 'active' ? ' ws-timeline-dot--active' : ''}${dotReached}`} />
                <div className="ws-timeline-card">
                  <span className="ws-timeline-quarter">{item.quarter}</span>
                  <h3 className="ws-timeline-title">{item.title}</h3>
                  <p className="ws-timeline-desc">{item.desc}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ================================================================
          SECTION 7: TEAM — dark
          ================================================================ */}
      <section className="ws-team" id="about">
        <div className="ws-section-header ws-reveal">
          <p className="ws-tag">Team</p>
          <h2 className="ws-heading">Built by traders.<br /><span className="ws-heading-dim">For traders.</span></h2>
          <p className="ws-subtext">A focused team of engineers and AI specialists building the intelligence layer for modern markets.</p>
        </div>
        <div className="ws-team-grid ws-reveal">
          {TEAM.map((m, i) => (
            <div className={`ws-team-card ws-reveal-scale ws-stagger-${i + 1}`} key={m.name}>
              <div className="ws-team-avatar">{m.initial}</div>
              <h3 className="ws-team-name">{m.name}</h3>
              <p className="ws-team-role">{m.role}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ================================================================
          SECTION 8: PARTNERS — dark, marquee
          ================================================================ */}
      <section className="ws-partners" id="partners">
        <div className="ws-section-header ws-reveal">
          <p className="ws-tag">Integrations</p>
          <h2 className="ws-heading">Powered by the best<br /><span className="ws-heading-dim">data infrastructure.</span></h2>
        </div>
        <div className="ws-partners-marquee ws-reveal">
          <div className="ws-partners-track">
            {PARTNERS.map((p) => (<div className="ws-partner" key={p.name}><img src={p.icon} alt="" className="ws-partner-icon" /><span className="ws-partner-name">{p.name}</span></div>))}
            {PARTNERS.map((p) => (<div className="ws-partner" key={`dup-${p.name}`}><img src={p.icon} alt="" className="ws-partner-icon" /><span className="ws-partner-name">{p.name}</span></div>))}
          </div>
        </div>
      </section>

      {/* Fixed Bottom Nav */}
      <nav className={`ws-bottom-nav${isScrolled ? ' ws-bottom-nav--scrolled' : ''}`}>
        <div className="ws-bottom-nav-inner">
          {NAV_LINKS.map((link) => (
            <button key={link.label} className={`ws-bottom-link${activeSection === link.id ? ' ws-bottom-link--active' : ''}`} onClick={() => scrollTo(link.id)}>{link.label}</button>
          ))}
        </div>
      </nav>

      {/* ================================================================
          FOOTER — Waitlister-style: deep space + earth horizon curve
          ================================================================ */}
      <footer className="ws-waitlist-footer">
        {/* Star field */}
        <div className="ws-waitlist-stars" />

        {/* Main content - centered vertically */}
        <div className="ws-waitlist-content ws-reveal">
          <h2 className="ws-waitlist-heading">
            The edge belongs<br />to those <em>who see first.</em>
          </h2>
          <p className="ws-waitlist-sub">
            Join the waitlist for early access to Spectre AI -<br />
            institutional-grade market intelligence, delivered.
          </p>
          <div className="ws-waitlist-form">
            <input
              type="email"
              className="ws-waitlist-input"
              placeholder="Your Email Address"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
            />
            <button className="ws-waitlist-btn">Get Notified</button>
          </div>
        </div>

        {/* Half-orbit horizon with gradient glow + beam */}
        <div className="ws-waitlist-horizon">
          <div className="ws-waitlist-orbit-glow" />
          <svg className="ws-waitlist-orbit-svg" viewBox="0 0 1440 300" preserveAspectRatio="none">
            <defs>
              <linearGradient id="orbit-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="transparent" />
                <stop offset="20%" stopColor="rgba(140,170,220,0.15)" />
                <stop offset="50%" stopColor="rgba(200,215,240,0.35)" />
                <stop offset="80%" stopColor="rgba(140,170,220,0.15)" />
                <stop offset="100%" stopColor="transparent" />
              </linearGradient>
              <radialGradient id="orbit-beam" cx="50%" cy="0%" r="50%">
                <stop offset="0%" stopColor="rgba(180,200,235,0.12)" />
                <stop offset="40%" stopColor="rgba(140,170,220,0.04)" />
                <stop offset="100%" stopColor="transparent" />
              </radialGradient>
            </defs>
            {/* Glow fill behind the arc */}
            <ellipse cx="720" cy="300" rx="800" ry="220" fill="url(#orbit-beam)" />
            {/* Main arc line */}
            <ellipse cx="720" cy="300" rx="750" ry="200" fill="none" stroke="url(#orbit-stroke)" strokeWidth="1.5" />
            {/* Outer glow arc */}
            <ellipse cx="720" cy="300" rx="750" ry="200" fill="none" stroke="rgba(180,200,235,0.06)" strokeWidth="8" />
          </svg>
        </div>

        {/* Bottom copyright */}
        <div className="ws-waitlist-bottom">
          <span>&copy; 2026 Spectre AI</span>
          <span>&middot;</span>
          <a href="#">Privacy</a>
          <span>&middot;</span>
          <a href="#">Terms</a>
        </div>
      </footer>
    </div>
  )
}
