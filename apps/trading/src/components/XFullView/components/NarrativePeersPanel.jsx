import { memo } from 'react'

/**
 * NarrativePeersPanel — narrative chip + comparison table of peer tokens
 * sitting in the same X Dash narrative as the current token.
 *
 * Hides the table entirely if no narrative is detected.
 */
function NarrativePeersPanel({ narrative, peers, loading, selfCgId }) {
  return (
    <div className="xfv-panel">
      <div className="xfv-panel-header">
        <div
          className="xfv-panel-title xfv-tip"
          data-xfv-tip="The CoinGecko narrative this token belongs to, plus the other tokens X traders are mentioning inside that same narrative right now."
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
            <path d="M3 12h18M12 3v18" />
          </svg>
          <span>Narrative & Peers</span>
        </div>
      </div>

      <div className="xfv-panel-body">
        {!narrative && !loading && (
          <div className="xfv-empty">No narrative assigned yet</div>
        )}

        {narrative && (
          <div className="xfv-narrative-chip-row">
            <div className="xfv-narrative-chip">{narrative}</div>
            {peers && peers.length > 0 && (
              <span
                className="xfv-narrative-meta xfv-tip xfv-tip--inline"
                data-xfv-tip={`Other tokens in the "${narrative}" narrative ranked by mention momentum on X over the last 24h.`}
              >
                {peers.length} peers
                <span className="xfv-tip-icon" aria-hidden="true">?</span>
              </span>
            )}
          </div>
        )}

        {loading && (!peers || peers.length === 0) && (
          <PeerSkeleton count={4} />
        )}

        {peers && peers.length > 0 && (
          <div className="xfv-peers-table">
            <div className="xfv-peer-row xfv-peer-row--header">
              <div className="xfv-peer-rank">#</div>
              <div className="xfv-peer-logo xfv-peer-logo--header" />
              <div className="xfv-peer-name">Token</div>
              <div
                className="xfv-peer-mentions xfv-tip"
                data-xfv-tip="Total tweets mentioning this token on X in the last 24 hours."
              >
                24h
              </div>
              <div
                className="xfv-peer-momentum xfv-tip"
                data-xfv-tip="Momentum: % change in mention velocity vs the token's normal daily pace. +100 means mentions are 2x usual, -50 means half."
              >
                Mom.
              </div>
            </div>
            {peers.map((peer, i) => {
              const norm = normalizePeer(peer)
              const dir = norm.momentum > 5 ? 'up' : norm.momentum < -5 ? 'down' : 'flat'
              return (
                <div key={norm.cgId || i} className="xfv-peer-row">
                  <div className="xfv-peer-rank">{i + 1}</div>
                  {norm.logo ? (
                    <img className="xfv-peer-logo" src={norm.logo} alt="" loading="lazy" />
                  ) : (
                    <div className="xfv-peer-logo" />
                  )}
                  <div className="xfv-peer-name" title={norm.name}>
                    {norm.symbol || norm.name}
                  </div>
                  <div className="xfv-peer-mentions">{formatCompact(norm.mentions)}</div>
                  <div className={`xfv-peer-momentum xfv-peer-momentum--${dir}`}>
                    {dir === 'up' ? '+' : ''}{Math.round(norm.momentum)}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && narrative && (!peers || peers.length === 0) && (
          <div className="xfv-empty">No peer data available</div>
        )}
      </div>
    </div>
  )
}

function normalizePeer(p) {
  const tk = p?.token || p
  const m = p?.metrics || {}
  // velocity_ratio is centered on 1.0 (1.0 = flat, 2.0 = +100%, 0.5 = -50%).
  // Express as a percentage delta so the row reads as a momentum %.
  const velocity = m.velocity_ratio
  const momentum = Number.isFinite(velocity) ? (velocity - 1) * 100 : 0
  return {
    cgId: tk?.cg_id || tk?.cgId || tk?.id || null,
    name: tk?.name || tk?.symbol || '',
    symbol: tk?.symbol || tk?.ticker || '',
    logo: tk?.image_small || tk?.image_thumb || tk?.image_url || tk?.image || tk?.logo || null,
    mentions: num(m.mentions_24h ?? m.external_mentions_24h ?? m.total_mentions ?? p?.mentions),
    momentum,
  }
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function formatCompact(n) {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function PeerSkeleton({ count = 4 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="xfv-peer-row">
          <div className="xfv-skeleton" style={{ width: 12, height: 10 }} />
          <div className="xfv-skeleton" style={{ width: 18, height: 18, borderRadius: '50%' }} />
          <div className="xfv-skeleton" style={{ height: 10, width: '60%' }} />
          <div className="xfv-skeleton" style={{ height: 10, width: 40 }} />
          <div className="xfv-skeleton" style={{ height: 10, width: 30 }} />
        </div>
      ))}
    </div>
  )
}

export default memo(NarrativePeersPanel)
