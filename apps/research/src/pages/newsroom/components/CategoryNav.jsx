/**
 * CategoryNav - Tab-style category navigation (CoinDesk-style underline tabs, not pills).
 */
const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'bitcoin', label: 'Bitcoin' },
  { key: 'ethereum', label: 'Ethereum' },
  { key: 'defi', label: 'DeFi' },
  { key: 'regulation', label: 'Regulation' },
  { key: 'exchange', label: 'Exchange' },
  { key: 'layer1', label: 'Layer 1' },
  { key: 'layer2', label: 'Layer 2' },
  { key: 'nft', label: 'NFT' },
  { key: 'ai', label: 'AI' },
  { key: 'macro', label: 'Macro' },
]

export default function CategoryNav({ active, onChange }) {
  return (
    <nav className="nr-nav">
      {CATEGORIES.map(cat => (
        <button
          key={cat.key}
          className={`nr-nav__tab${active === cat.key ? ' nr-nav__tab--active' : ''}`}
          onClick={() => onChange(cat.key)}
        >
          {cat.label}
        </button>
      ))}
    </nav>
  )
}
