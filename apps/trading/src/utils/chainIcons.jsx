// Inline SVG chain icons - render instantly, no network request.
// Reused across the trading app (banner, deployer security, watchlist, etc).

const Eth = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 256 417" fill="none">
    <path d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z" fill="#343434" />
    <path d="M127.962 0L0 212.32l127.962 75.639V154.158z" fill="#8C8C8C" />
    <path d="M127.961 312.187l-1.575 1.92V414.6l1.575 4.6L256 236.587z" fill="#3C3C3B" />
    <path d="M127.962 419.2V312.187L0 236.587z" fill="#8C8C8C" />
    <path d="M127.961 287.958l127.96-75.637-127.96-58.162z" fill="#141414" />
    <path d="M0 212.32l127.96 75.639V154.159z" fill="#393939" />
  </svg>
)

const Sol = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 397 312" fill="none">
    <linearGradient id="ci-sol" x1="360" y1="11" x2="141" y2="330" gradientUnits="userSpaceOnUse">
      <stop stopColor="#00FFA3" />
      <stop offset="1" stopColor="#DC1FFF" />
    </linearGradient>
    <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#ci-sol)" />
    <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#ci-sol)" />
    <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#ci-sol)" />
  </svg>
)

const Base = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 111 111" fill="none">
    <circle cx="55.5" cy="55.5" r="55.5" fill="#0052FF" />
    <path d="M55.4 93.5c21 0 38-17 38-38s-17-38-38-38c-19.6 0-35.7 14.8-37.8 33.8h50.5v8.4H17.6c2.1 19 18.2 33.8 37.8 33.8z" fill="#fff" />
  </svg>
)

const Polygon = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 38 33" fill="none">
    <path d="M28.8 12.3c-.8-.5-1.8-.5-2.5 0l-5.8 3.4-3.9 2.2-5.7 3.4c-.8.5-1.8.5-2.5 0l-4.5-2.7c-.8-.5-1.3-1.3-1.3-2.2v-5.2c0-.9.4-1.8 1.3-2.2L8.3 6.3c.8-.5 1.8-.5 2.5 0l4.5 2.7c.8.5 1.3 1.3 1.3 2.2v3.4l3.9-2.3V8.9c0-.9-.4-1.8-1.3-2.2L12.5 2c-.8-.5-1.8-.5-2.5 0L3.1 6.7c-.8.5-1.3 1.3-1.3 2.2v9.5c0 .9.4 1.8 1.3 2.2l6.8 3.9c.8.5 1.8.5 2.5 0l5.7-3.3 3.9-2.3 5.7-3.3c.8-.5 1.8-.5 2.5 0l4.5 2.6c.8.5 1.3 1.3 1.3 2.2v5.2c0 .9-.4 1.8-1.3 2.2l-4.4 2.6c-.8.5-1.8.5-2.5 0l-4.5-2.6c-.8-.5-1.3-1.3-1.3-2.2v-3.3l-3.9 2.3v3.4c0 .9.4 1.8 1.3 2.2l6.8 3.9c.8.5 1.8.5 2.5 0l6.8-3.9c.8-.5 1.3-1.3 1.3-2.2v-9.5c0-.9-.4-1.8-1.3-2.2l-6.9-4.1z" fill="#8247E5" />
  </svg>
)

const Arbitrum = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#213147" />
    <path d="M22.8 10.6l-8.4 13.2 3.6 5.6 11.4-17.8-6.6-1zM28.2 25l-3 4.7 3.5 2.2 3.5-5.5L28.2 25z" fill="#28A0F0" />
    <path d="M14.4 23.8L11.8 28l4 2.4L18 26l-3.6-2.2zm13.8 1.2l-6.6-1-3 4.7 6.6 1 3-4.7z" fill="#fff" />
  </svg>
)

const Bsc = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
    <path d="M12.1 14.5L16 10.6l3.9 3.9 2.3-2.3L16 6l-6.2 6.2 2.3 2.3zm-6.1 1.5l2.3-2.3 2.3 2.3-2.3 2.3L6 16zm6.1 1.5L16 21.4l3.9-3.9 2.3 2.3L16 26l-6.2-6.2 2.3-2.3zM23.7 16l2.3-2.3 2.3 2.3-2.3 2.3L23.7 16zM18.3 16L16 13.7 13.7 16 16 18.3 18.3 16z" fill="#fff" />
  </svg>
)

const Avalanche = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="16" fill="#E84142" />
    <path d="M20.1 11.2c.5-.9 1.5-.9 2 0l3.5 6.1c.5.9 0 2-1 2h-7c-1 0-1.5-1.1-1-2l3.5-6.1z" fill="#fff" />
    <path d="M11.9 14.8c.5-.9 1.5-.9 2 0l3.5 6.1c.5.9 0 2-1 2h-7c-1 0-1.5-1.1-1-2l3.5-6.1z" fill="#fff" />
  </svg>
)

const Optimism = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="16" fill="#FF0420" />
    <circle cx="16" cy="16" r="6.4" stroke="#fff" strokeWidth="3" fill="none" />
  </svg>
)

const Robinhood = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="16" fill="#00C805" />
    <g transform="translate(5.5 5.5) scale(0.875)" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <path d="M16 8L2 22" />
      <path d="M17.5 15H9" />
    </g>
  </svg>
)

export function ChainIcon({ networkId, size = 12 }) {
  const id = Number(networkId)
  if (id === 1399811149) return <Sol size={size} />
  if (id === 8453) return <Base size={size} />
  if (id === 42161) return <Arbitrum size={size} />
  if (id === 137) return <Polygon size={size} />
  if (id === 56) return <Bsc size={size} />
  if (id === 43114) return <Avalanche size={size} />
  if (id === 10) return <Optimism size={size} />
  if (id === 4663) return <Robinhood size={size} />
  return <Eth size={size} />
}

// Brand accent colors per chain — used for chain-themed pills and badges
export function getChainAccent(networkId) {
  const id = Number(networkId)
  if (id === 1399811149) return '#9945FF'
  if (id === 8453)       return '#0052FF'
  if (id === 42161)      return '#28A0F0'
  if (id === 137)        return '#8247E5'
  if (id === 56)         return '#F3BA2F'
  if (id === 4663)       return '#00C805'
  return '#627EEA'
}
