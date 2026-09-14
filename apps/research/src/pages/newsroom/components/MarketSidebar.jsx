/**
 * MarketSidebar - Right column: live prices, Fear & Greed, newsroom stats (~220px).
 * Compact vertical layout with section dividers.
 */
export default function MarketSidebar({ prices, fearGreed, stats }) {
  function fmtPrice(p) {
    if (p == null) return '-'
    if (p >= 1) return `$${Number(p).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    return `$${p.toFixed(2)}`
  }

  function fmtChange(c) {
    if (c == null) return ''
    const sign = c > 0 ? '+' : ''
    return `${sign}${c.toFixed(1)}%`
  }

  function getFngColor(val) {
    if (val <= 25) return 'var(--bear)'
    if (val <= 45) return 'var(--text-muted)'
    if (val <= 55) return 'var(--text-secondary)'
    if (val <= 75) return 'var(--bull)'
    return 'var(--bull)'
  }

  return (
    <aside className="nr-sidebar">
      {/* Market Prices */}
      {prices && prices.length > 0 && (
        <div className="nr-sidebar__section">
          <div className="nr-sidebar__label">Market Prices</div>
          {prices.map(p => (
            <div key={p.symbol} className="nr-sidebar__price-row">
              <span className="nr-sidebar__price-symbol">{p.symbol}</span>
              <span className="nr-sidebar__price-value">{fmtPrice(p.price)}</span>
              <span className={`nr-sidebar__price-change ${p.change >= 0 ? 'nr-sidebar__price-change--bull' : 'nr-sidebar__price-change--bear'}`}>
                {fmtChange(p.change)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Fear & Greed */}
      {fearGreed && (
        <>
          <div className="nr-sidebar__divider" />
          <div className="nr-sidebar__section">
            <div className="nr-sidebar__label">Fear & Greed</div>
            <div className="nr-sidebar__fng-value" style={{ color: getFngColor(parseInt(fearGreed.value)) }}>
              {fearGreed.value}
            </div>
            <div className="nr-sidebar__fng-class">{fearGreed.value_classification}</div>
          </div>
        </>
      )}

      {/* Newsroom Stats */}
      {stats && (
        <>
          <div className="nr-sidebar__divider" />
          <div className="nr-sidebar__section">
            <div className="nr-sidebar__label">Newsroom</div>
            <div className="nr-sidebar__stat">
              <span className="nr-sidebar__stat-value">{stats.totalToday || stats.articlesPerDay || 0}</span>
              <span className="nr-sidebar__stat-label">published today</span>
            </div>
            <div className="nr-sidebar__stat">
              <span className="nr-sidebar__stat-value">{stats.totalArticles || 0}</span>
              <span className="nr-sidebar__stat-label">total articles</span>
            </div>
            {stats.coverage && typeof stats.coverage === 'object' && (
              <div className="nr-sidebar__coverage">
                {stats.coverage.crypto > 0 && <span>{stats.coverage.crypto} crypto</span>}
                {stats.coverage.stocks > 0 && <span>{stats.coverage.stocks} stocks</span>}
                {stats.coverage.daily > 0 && <span>{stats.coverage.daily} daily</span>}
                {stats.coverage.news > 0 && <span>{stats.coverage.news} news</span>}
              </div>
            )}
          </div>
        </>
      )}

      {/* Agent Status */}
      {stats && (
        <>
          <div className="nr-sidebar__divider" />
          <div className="nr-sidebar__section">
            <div className="nr-sidebar__label">Agent Status</div>
            <div className="nr-sidebar__agent">
              <span className="nr-sidebar__agent-dot nr-sidebar__agent-dot--active" />
              <span>Agents {stats.agentsActive ? 'Active' : 'Idle'}</span>
            </div>
            {stats.lastGeneration && (
              <div className="nr-sidebar__agent-time">
                Last: {new Date(stats.lastGeneration).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
