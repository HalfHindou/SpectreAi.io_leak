/**
 * WalletAvatar - the wallet's face: a deterministic sigil tile generated from
 * the address (see lib/walletAvatar.js), so a wallet that shows up on the
 * tape, in Holders and in Top Traders wears the same face everywhere. A
 * round pfp that opens the identity line, immediately LEFT of the address.
 *
 * `source` (optional) pins the platform the wallet trades through as a mini
 * tile on the tile's corner - the compact form for the mobile tape, where
 * there is no room for a separate slot.
 */
import React from 'react'
import { walletAvatarSrc } from '../lib/walletAvatar'
import TradeSourceIcon from './TradeSourceIcon'
import './WalletAvatar.css'

export default function WalletAvatar({ address, size = 20, source = null, className = '' }) {
  const src = walletAvatarSrc(address)
  if (!src) return null
  return (
    <span
      className={`wav${source?.id ? ' wav--src' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--wav-size': `${size}px` }}
    >
      <img className="wav-img" src={src} alt="" width={size} height={size} draggable={false} decoding="async" />
      {source?.id && <TradeSourceIcon source={source} size={10} className="wav-src" />}
    </span>
  )
}
