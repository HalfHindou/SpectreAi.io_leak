/**
 * Contract-address helpers shared by the desktop token panel and the mobile
 * Overview tab. Extracted from rz-token-panel.jsx so mobile doesn't have to
 * import the whole desktop panel for 40 lines of pure logic.
 */

/** Truncate a contract address to 0x1234…5678 form. */
export function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return ''
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// CoinGecko platform id -> short chain label for the contract list.
const CHAIN_LABELS = {
  'ethereum': 'ETH',
  'binance-smart-chain': 'BSC',
  'polygon-pos': 'POLYGON',
  'arbitrum-one': 'ARB',
  'optimistic-ethereum': 'OP',
  'base': 'BASE',
  'solana': 'SOL',
  'avalanche': 'AVAX',
  'fantom': 'FTM',
  'tron': 'TRON',
  'zksync': 'ZKSYNC',
  'sui': 'SUI',
  'aptos': 'APT',
}

export function chainLabel(platformId) {
  if (!platformId) return ''
  if (CHAIN_LABELS[platformId]) return CHAIN_LABELS[platformId]
  return platformId.replace(/-(pos|one|smart-chain|ethereum)$/i, '').replace(/[-_]/g, ' ').toUpperCase()
}

/**
 * Build a deduped list of {label, address} from the primary address + the
 * CoinGecko platforms map. Primary address goes first.
 */
export function buildContractEntries(primaryAddress, platforms) {
  const entries = []
  const seen = new Set()
  const push = (label, address) => {
    if (!address || typeof address !== 'string' || address.length < 6) return
    const key = address.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    entries.push({ label, address })
  }
  // Primary first - try to label it from the platforms map.
  if (primaryAddress) {
    let primaryLabel = 'Contract'
    if (platforms && typeof platforms === 'object') {
      for (const [pid, addr] of Object.entries(platforms)) {
        if (typeof addr === 'string' && addr.toLowerCase() === primaryAddress.toLowerCase()) {
          primaryLabel = chainLabel(pid)
          break
        }
      }
    }
    push(primaryLabel, primaryAddress)
  }
  if (platforms && typeof platforms === 'object') {
    for (const [pid, addr] of Object.entries(platforms)) {
      push(chainLabel(pid), addr)
    }
  }
  return entries
}
