/**
 * TradeSourceIcon - the app a swap was placed through (Codex `tradeSource`),
 * as an 18px rounded-square tile of the platform's own logo: GMGN's frog, Axiom's
 * mark, the Phantom ghost, the BNB diamond. Logos live in
 * `public/trade-sources/<id>.png` (64px, cut from each platform's own site
 * icon). A source Codex names that we have no logo for, or an image that
 * fails to load, falls back to a brand-coloured monogram so the slot never
 * goes blank. Sits LEFT of the maker address on the tape (desktop + mobile)
 * and on the Holders row. Hover shows "via Phantom".
 *
 * Absence means "no identifying signal", never "direct" - callers render
 * nothing when the source is null.
 */
import React, { useState } from 'react'
import './TradeSourceIcon.css'

const LOGO_DIR = '/trade-sources/'

// key = Codex tradeSource.id with non-alphanumerics stripped (see `norm`).
// `logo` is the file under public/trade-sources; `bg`/`fg`/`mark` draw the
// monogram fallback in the brand's own colour.
const BRANDS = {
  gmgn: { name: 'GMGN', logo: 'gmgn', bg: '#7CE05A', fg: '#0B2A0B', mark: 'G' },
  fomo: { name: 'Fomo', logo: 'fomo', bg: '#1B1B2F', fg: '#F5F5F7', mark: 'F' },
  uniswap: { name: 'Uniswap', logo: 'uniswap', bg: '#FF007A', fg: '#FFFFFF', mark: 'U' },
  binancewallet: { name: 'Binance Wallet', logo: 'binance-wallet', bg: '#F0B90B', fg: '#1A1206', mark: 'B' },
  trustwallet: { name: 'Trust Wallet', logo: 'trust-wallet', bg: '#0500FF', fg: '#FFFFFF', mark: 'T' },
  aveai: { name: 'Ave.ai', logo: 'ave-ai', bg: '#6C5CE7', fg: '#FFFFFF', mark: 'A' },
  axiom: { name: 'Axiom', logo: 'axiom', bg: '#0B0B0D', fg: '#F5F5F7', mark: 'A', ring: 'rgba(245,245,247,0.28)' },
  metamask: { name: 'MetaMask', logo: 'metamask', bg: '#F6851B', fg: '#FFFFFF', mark: 'M' },
  pancakeswap: { name: 'PancakeSwap', logo: 'pancakeswap', bg: '#1FC7D4', fg: '#0B2A2E', mark: 'P' },
  phantom: { name: 'Phantom', logo: 'phantom', bg: '#AB9FF2', fg: '#1F1B3A', mark: 'P' },
  kyberswap: { name: 'KyberSwap', logo: 'kyberswap', bg: '#31CB9E', fg: '#052E16', mark: 'K' },
  bitgetwallet: { name: 'Bitget Wallet', logo: 'bitget-wallet', bg: '#00F0FF', fg: '#0B2A2E', mark: 'B' },
  rabby: { name: 'Rabby', logo: 'rabby', bg: '#8697FF', fg: '#0F172A', mark: 'R' },
  maestro: { name: 'Maestro', logo: 'maestro', bg: '#7C3AED', fg: '#FFFFFF', mark: 'M' },
  bloom: { name: 'Bloom', logo: 'bloom', bg: '#0B0B0D', fg: '#F5F5F7', mark: 'B', ring: 'rgba(245,245,247,0.28)' },
  backpackwallet: { name: 'Backpack', logo: 'backpack-wallet', bg: '#E33E3F', fg: '#FFFFFF', mark: 'B' },
  backpack: { name: 'Backpack', logo: 'backpack-wallet', bg: '#E33E3F', fg: '#FFFFFF', mark: 'B' },
  trojan: { name: 'Trojan', logo: 'trojan', bg: '#0B0B0D', fg: '#F5F5F7', mark: 'T', ring: 'rgba(245,245,247,0.28)' },
  photon: { name: 'Photon', logo: 'photon', bg: '#25C2FF', fg: '#0B2A2E', mark: 'P' },
  bullx: { name: 'BullX', logo: 'bullx', bg: '#22C55E', fg: '#052E16', mark: 'BX' },
  // Codex id is `terminal-padre`, displayName "Terminal (formerly Padre)".
  terminalpadre: { name: 'Terminal', logo: 'terminal', bg: '#0B0B0D', fg: '#F5F5F7', mark: 'T', ring: 'rgba(245,245,247,0.28)' },
  terminal: { name: 'Terminal', logo: 'terminal', bg: '#0B0B0D', fg: '#F5F5F7', mark: 'T', ring: 'rgba(245,245,247,0.28)' },
  padre: { name: 'Terminal', logo: 'terminal', bg: '#0B0B0D', fg: '#F5F5F7', mark: 'T', ring: 'rgba(245,245,247,0.28)' },
  jupiter: { name: 'Jupiter', logo: 'jupiter', bg: '#C7F284', fg: '#0B2A0B', mark: 'J' },
  raydium: { name: 'Raydium', logo: 'raydium', bg: '#C200FB', fg: '#FFFFFF', mark: 'R' },
  bonkbot: { name: 'BonkBot', logo: 'bonkbot', bg: '#FF7A1A', fg: '#FFFFFF', mark: 'BB' },
  bananagun: { name: 'Banana Gun', logo: 'bananagun', bg: '#FFE135', fg: '#1A1206', mark: 'BG' },
  dexscreener: { name: 'DexScreener', logo: 'dexscreener', bg: '#1F2937', fg: '#F5F5F7', mark: 'DS', ring: 'rgba(245,245,247,0.22)' },
  dextools: { name: 'DEXTools', logo: 'dextools', bg: '#0B7CFF', fg: '#FFFFFF', mark: 'DT' },
  coinbase: { name: 'Coinbase', logo: 'coinbase', bg: '#0052FF', fg: '#FFFFFF', mark: 'C' },
  coinbasewallet: { name: 'Coinbase Wallet', logo: 'coinbase', bg: '#0052FF', fg: '#FFFFFF', mark: 'C' },
  okx: { name: 'OKX', logo: 'okx', bg: '#0B0B0D', fg: '#F5F5F7', mark: 'OK', ring: 'rgba(245,245,247,0.28)' },
  okxwallet: { name: 'OKX Wallet', logo: 'okx', bg: '#0B0B0D', fg: '#F5F5F7', mark: 'OK', ring: 'rgba(245,245,247,0.28)' },
  solflare: { name: 'Solflare', logo: 'solflare', bg: '#FFEF46', fg: '#1A1206', mark: 'S' },
  pumpfun: { name: 'pump.fun', logo: 'pumpfun', bg: '#4ADE80', fg: '#052E16', mark: 'pf' },
  moonshot: { name: 'Moonshot', logo: 'moonshot', bg: '#6D5DF6', fg: '#FFFFFF', mark: 'Ms' },
  llamaswap: { name: 'LlamaSwap', logo: 'llamaswap', bg: '#1F67D2', fg: '#FFFFFF', mark: 'LS' },
}

const NEUTRAL = { bg: 'rgba(245, 245, 247, 0.1)', fg: 'rgba(245, 245, 247, 0.82)', ring: 'rgba(245, 245, 247, 0.14)' }

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function resolveTradeSourceBrand(source) {
  if (!source) return null
  const id = norm(source.id)
  const name = String(source.name || source.displayName || source.id || '').trim()
  const byId = BRANDS[id]
  if (byId) return { ...byId, name: byId.name || name }
  // Registry names sometimes carry a suffix ("Terminal (formerly Padre)");
  // match on the leading word before falling back to a neutral lettermark.
  const lead = norm(name.split(/[\s(]/)[0])
  if (lead && BRANDS[lead]) return { ...BRANDS[lead] }
  const clean = name.replace(/\s*\(.*?\)\s*/g, '').trim() || id || '?'
  return { ...NEUTRAL, name: clean, mark: clean.slice(0, 1).toUpperCase() }
}

// Every logo ships pre-rendered at the exact device sizes the tile is drawn
// at (18px css x 1/2/3 dpr) so the browser never resamples it - `sizes`
// carries the css slot so a 16px tile still picks the right one.
const LOGO_SIZES = [18, 36, 54]
const srcSetFor = (logo) => LOGO_SIZES.map((s) => `${LOGO_DIR}${logo}-${s}.png ${s}w`).join(', ')

export default function TradeSourceIcon({ source, className = '', size = 18 }) {
  const [broken, setBroken] = useState(false)
  const brand = resolveTradeSourceBrand(source)
  if (!brand) return null
  const showLogo = Boolean(brand.logo) && !broken
  const style = showLogo ? undefined : { '--tsrc-bg': brand.bg, '--tsrc-fg': brand.fg, ...(brand.ring ? { '--tsrc-ring': brand.ring } : null) }
  return (
    <span
      className={`tsrc${showLogo ? ' tsrc--logo' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      aria-label={`via ${brand.name}`}
    >
      {showLogo ? (
        <img
          className="tsrc-logo"
          src={`${LOGO_DIR}${brand.logo}-36.png`}
          srcSet={srcSetFor(brand.logo)}
          sizes={`${size}px`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="tsrc-mark">{brand.mark}</span>
      )}
      <span className="tsrc-tip" role="tooltip">via {brand.name}</span>
    </span>
  )
}
