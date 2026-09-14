import { useState, useMemo } from 'react'
import { TIER_COLORS } from '../data/zigchainGraph'

function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function ListView({ nodes, links, adjacency, onSelectNode, onClose, dayMode }) {
  const [sortBy, setSortBy] = useState('mentions') // 'mentions' | 'followers' | 'connections' | 'name'
  const [sortDir, setSortDir] = useState('desc')
  const [listSearch, setListSearch] = useState('')
  // No pagination — full scrollable list

  // Compute mention counts per node
  const nodeStats = useMemo(() => {
    const mentionCounts = new Map()
    for (const link of links) {
      mentionCounts.set(link.target, (mentionCounts.get(link.target) || 0) + link.tweetCount)
      mentionCounts.set(link.source, (mentionCounts.get(link.source) || 0) + link.tweetCount)
    }
    return mentionCounts
  }, [links])

  // Filter + sort
  const sortedNodes = useMemo(() => {
    const q = listSearch.toLowerCase()
    let filtered = nodes.filter(n => {
      if (!q) return true
      return n.name.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)
    })

    filtered.sort((a, b) => {
      let av, bv
      switch (sortBy) {
        case 'followers': av = a.followers; bv = b.followers; break
        case 'connections': av = adjacency.get(a.id)?.size || 0; bv = adjacency.get(b.id)?.size || 0; break
        case 'name': av = a.name.toLowerCase(); bv = b.name.toLowerCase(); return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
        default: av = nodeStats.get(a.id) || 0; bv = nodeStats.get(b.id) || 0; break
      }
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return filtered
  }, [nodes, listSearch, sortBy, sortDir, nodeStats, adjacency])

  // All rows rendered — scroll to see more
  const maxMentions = Math.max(1, ...sortedNodes.slice(0, 5).map(n => nodeStats.get(n.id) || 0))

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const SortArrow = ({ col }) => {
    if (sortBy !== col) return null
    return <span style={{ marginLeft: 4, opacity: 0.5 }}>{sortDir === 'desc' ? '\u25BE' : '\u25B4'}</span>
  }

  return (
    <div className="xi-listview xi-glass xi-glass-border">
      {/* Header */}
      <div className="xi-listview__header">
        <div className="xi-listview__search-wrap">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
            <circle cx="6" cy="6" r="4.5" /><path d="M9.5 9.5L13 13" />
          </svg>
          <input
            type="text"
            className="xi-listview__search"
            placeholder="Search rows..."
            value={listSearch}
            onChange={e => setListSearch(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="xi-listview__header-right">
          <span className="xi-listview__count">{sortedNodes.length} rows</span>
          <button className="xi-listview__close-btn" onClick={onClose} title="Back to graph">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="xi-listview__table-wrap">
        <table className="xi-listview__table">
          <thead>
            <tr>
              <th style={{ width: '5%', textAlign: 'center' }}>#</th>
              <th style={{ width: '5%' }}></th>
              <th style={{ width: '28%', cursor: 'pointer' }} onClick={() => handleSort('name')}>Name<SortArrow col="name" /></th>
              <th style={{ width: '10%', textAlign: 'center' }}>Type</th>
              <th style={{ width: '7%', textAlign: 'center' }}>Tier</th>
              <th style={{ width: '12%', textAlign: 'center', cursor: 'pointer' }} onClick={() => handleSort('followers')}>Followers<SortArrow col="followers" /></th>
              <th style={{ width: '12%', textAlign: 'center', cursor: 'pointer' }} onClick={() => handleSort('mentions')}>Mentions<SortArrow col="mentions" /></th>
              <th style={{ width: '12%', textAlign: 'center', cursor: 'pointer' }} onClick={() => handleSort('connections')}>Connections<SortArrow col="connections" /></th>
              <th style={{ width: '14%' }}>Activity</th>
            </tr>
          </thead>
          <tbody>
            {sortedNodes.map((node, i) => {
              const mentions = nodeStats.get(node.id) || 0
              const connections = adjacency.get(node.id)?.size || 0
              const tierColor = TIER_COLORS[node.tier] || TIER_COLORS.C
              const barWidth = Math.min(100, (mentions / maxMentions) * 100)
              const barColor = tierColor

              return (
                <tr
                  key={node.id}
                  className="xi-listview__row"
                  onClick={() => onSelectNode(node.id)}
                >
                  <td className="xi-listview__rank" style={{ textAlign: 'center' }}>{i + 1}</td>
                  <td>
                    <div className="xi-listview__avatar" style={{ borderColor: tierColor }}>
                      {node.avatar ? (
                        <img src={node.avatar} alt="" crossOrigin="anonymous" onError={e => { e.target.style.display = 'none' }} />
                      ) : (
                        <span style={{ color: tierColor, fontWeight: 600, fontSize: '0.6875rem' }}>
                          {(node.name || '?')[0].toUpperCase()}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="xi-listview__name">{node.name}</div>
                    <div className="xi-listview__handle">{node.handle}</div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`xi-listview__type xi-listview__type--${node.type}`}>
                      {node.type === 'kol' ? 'KOL' : node.type === 'project' ? 'Project' : 'Exchange'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="xi-listview__tier" style={{ color: tierColor }}>
                      {node.tier}
                    </span>
                  </td>
                  <td className="xi-listview__mono" style={{ textAlign: 'center' }}>{formatCount(node.followers)}</td>
                  <td className="xi-listview__mono" style={{ textAlign: 'center' }}>{formatCount(mentions)}</td>
                  <td className="xi-listview__mono" style={{ textAlign: 'center' }}>{connections}</td>
                  <td>
                    <div className="xi-listview__bar-wrap">
                      <div
                        className="xi-listview__bar"
                        style={{ width: `${barWidth}%`, background: barColor }}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Row count footer */}
      <div className="xi-listview__footer">
        <span className="xi-listview__page-info">{sortedNodes.length} rows</span>
      </div>
    </div>
  )
}
