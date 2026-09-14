import { useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { dismissBootSkeleton } from '@/lib/lazy-with-retry'

const TITLES = {
  'monarch-ai-chat': 'Monarch AI Chat',
  'you': 'Spectre YOU',
  'brain': 'Spectre Brain',
  'discover': 'Discover',
  'intelligence-feed': 'Intelligence Feed',
  'search-engine': 'Search Engine',
  'liquidation-heatmap': 'Liquidation Heatmap',
  'ai-market-analysis': 'AI Market Analysis',
  'world': 'War Room',
  'pulse': 'Pulse',
  'social-zone': 'Social Zone',
  'x-dash': 'X Dashboard',
  'potential-gainers': 'Potential Gainers',
  // 2026-06-14: /x-intelligence = public "X Intelligence" dashboard (not gated);
  // /x-bubbles = legacy graph, gated, labeled "X Bubbles".
  'x-intelligence': 'X Intelligence',
  'x-bubbles': 'X Bubbles',
  'x-intel': 'X Intel',
  'arena': 'Agent Arena',
  'market-cinema': 'Market Cinema',
  'world-state': 'World State',
}

export default function ComingSoonPlaceholder({ pageId, pathname }) {
  const navigate = useNavigate()
  const title = (pageId && TITLES[pageId]) || 'This page'

  // This is the one route render that mounts NO lazy route chunk — the guard
  // returns it INSTEAD of <Outlet/> — so nothing else would hand the boot
  // skeleton off and a cold landing on a gated URL would sit on it until
  // main.jsx's 8s backstop. Cheap and idempotent.
  useLayoutEffect(() => { dismissBootSkeleton() }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 120px)',
        padding: '32px 24px',
        textAlign: 'center',
        gap: 0,
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
          marginBottom: 28,
        }}
      >
        <svg
          width="42"
          height="42"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(245, 245, 247, 0.85)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>

      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'rgba(245, 245, 247, 0.5)',
          marginBottom: 12,
        }}
      >
        Coming Soon
      </div>

      <h1
        style={{
          fontSize: 'clamp(1.75rem, 3vw, 2.25rem)',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          color: '#f5f5f7',
          margin: 0,
          marginBottom: 12,
          lineHeight: 1.1,
        }}
      >
        {title}
      </h1>

      <p
        style={{
          fontSize: '0.9375rem',
          lineHeight: 1.55,
          color: 'rgba(245, 245, 247, 0.55)',
          maxWidth: 440,
          margin: 0,
          marginBottom: 28,
        }}
      >
        We're putting the finishing touches on this. Check back soon.
      </p>

      <button
        type="button"
        onClick={() => navigate('/')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 22px',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)',
          color: '#f5f5f7',
          fontSize: '0.875rem',
          fontWeight: 600,
          letterSpacing: '-0.005em',
          cursor: 'pointer',
          transition: 'all 250ms cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-1px)'
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)'
          e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
          e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)'
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 12l9-9 9 9" />
          <path d="M5 10v10h14V10" />
        </svg>
        <span>Go Home</span>
      </button>
    </div>
  )
}
