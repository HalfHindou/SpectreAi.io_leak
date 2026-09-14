/**
 * LiquidityPanel — DexScreener-style pool card for the token's PRIMARY pool.
 *
 * Real data via getPairInfo (/api/token/pair-info dev, /api/codex?action=pair-info
 * prod): exchange, pair, pooled base/quote reserves, total liquidity USD, pair
 * address, created-at. Codex exposes only the top pair per token (multi-pool
 * listing is not available — noted in the UI, not faked). Fetches on mount, so
 * it runs only when the Liquidity tab is active (DataTabs mounts it there).
 * Renders on mobile AND desktop. Prefix: lq-.
 *
 * LOCKED LIQUIDITY (Codex liquidityLocksV2, via getLiquidityLocks): how much of
 * the primary pool's LP is locked, split permanent / vesting / free, with the
 * holder that locks it (burned, UNCX, Team Finance, Doppler, the pair itself)
 * and the next unlock. Read from current on-chain state - an expired lock stops
 * counting the moment it unlocks. Every other pool of the token is listed
 * underneath with its own locked %. Shares are of each pool's OWN LP supply;
 * LP units differ per pool, so nothing is summed across pools.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Copy, Lock, Flame } from 'lucide-react'
import { getPairInfo, getLiquidityLocks, formatPrice } from '../../services/codexApi'
import './LiquidityPanel.css'

// Human names for Codex LiquidityLockProtocol values.
const LOCK_PROTOCOL_NAME = {
  BURN: 'Burned',
  UNCX_V2: 'UNCX v2',
  UNCX_V3: 'UNCX v3',
  TEAM_FINANCE: 'Team Finance',
  PINKSALE: 'PinkSale',
  DOPPLER: 'Doppler',
  BASECAMP_V1: 'Basecamp',
  BITBOND: 'Bitbond',
  METEORA_DAMM_V2: 'Meteora DAMM v2',
  METAPLEX_GENESIS: 'Metaplex Genesis',
  O1_EXCHANGE: 'o1.exchange',
  PONS_V2: 'Pons v2',
  LAUNCH_FAIR: 'Launchfair',
  BAGS: 'Bags',
}

const isBurn = (h) => h?.protocol === 'BURN' || String(h?.entityId || '').startsWith('burn:')

const holderName = (h) => {
  if (isBurn(h)) return 'Burned'
  if (h.name && h.name !== 'PAIR') return h.name
  if (h.name === 'PAIR') return 'Pair contract'
  if (h.protocol && LOCK_PROTOCOL_NAME[h.protocol]) return LOCK_PROTOCOL_NAME[h.protocol]
  return 'Locker'
}

const fmtPct = (p) => {
  const n = Number(p)
  if (!Number.isFinite(n)) return '—'
  if (n >= 99.995) return '100%'
  if (n >= 10) return `${n.toFixed(1)}%`
  if (n >= 0.1) return `${n.toFixed(2)}%`
  return n > 0 ? '<0.1%' : '0%'
}

// Unlock timing, from a unix-seconds timestamp. Anything beyond ~30 years is
// a "forever" lock in practice (UNCX ships 2092 dates) - say so instead of
// printing a date nobody will be around for.
const fmtUnlock = (sec) => {
  if (!sec) return null
  const ms = sec * 1000
  const diff = ms - Date.now()
  if (diff <= 0) return 'unlockable now'
  const days = diff / 86400000
  if (days > 365 * 30) return `locked until ${new Date(ms).getUTCFullYear()}`
  if (days >= 365) return `unlocks in ${(days / 365).toFixed(1)}y`
  if (days >= 60) return `unlocks in ${Math.round(days / 30)}mo`
  if (days >= 2) return `unlocks in ${Math.round(days)}d`
  return `unlocks in ${Math.max(1, Math.round(diff / 3600000))}h`
}

const fmtUsd = (usd) => {
  const n = Number(usd)
  if (!Number.isFinite(n) || n === 0) return '$0'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

const fmtNum = (n) => {
  n = Number(n)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

const fmtAge = (ts) => {
  if (!ts) return null
  const ms = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts)
  const diff = Math.max(0, Date.now() - ms)
  const d = Math.floor(diff / 86400000)
  if (d >= 1) return `${d}d`
  const h = Math.floor(diff / 3600000)
  if (h >= 1) return `${h}h`
  return `${Math.max(1, Math.floor(diff / 60000))}m`
}

const truncAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')

// The locked-liquidity block for ONE pool. `pool` is a normalized
// liquidityLocksV2 item (see getLiquidityLocks). Renders nothing when null.
function LockBlock({ pool, others }) {
  if (!pool) return null
  const locked = Math.max(0, Math.min(100, pool.lockedPct))
  // Split the locked bar into permanent vs vesting when Codex reports both;
  // burned LP shows as "locked" without a permanentLocked share on some
  // chains, so the remainder ("other locked") keeps the bar honest.
  const perm = Math.min(locked, pool.permanentPct)
  const vest = Math.min(locked - perm, pool.vestedPct)
  const otherLocked = Math.max(0, locked - perm - vest)
  const holders = pool.holders.filter((h) => h.sharePct >= 0.05).slice(0, 6)
  const next = pool.nextReleaseAt ? fmtUnlock(pool.nextReleaseAt) : null
  const tone = locked >= 90 ? 'is-safe' : locked >= 50 ? 'is-mid' : 'is-low'
  return (
    <div className={`lq-lock ${tone}`}>
      <div className="lq-lock-head">
        <span className="lq-lock-label">
          <Lock size={11} strokeWidth={2.25} aria-hidden="true" />
          Locked liquidity
        </span>
        <span className="lq-lock-pct">{fmtPct(locked)}</span>
      </div>

      <div className="lq-lock-bar" role="img" aria-label={`${fmtPct(locked)} of this pool's liquidity is locked`}>
        {perm > 0 && <span className="lq-lock-seg lq-lock-seg--perm" style={{ width: `${perm}%` }} title={`Permanently locked ${fmtPct(perm)}`} />}
        {otherLocked > 0 && <span className="lq-lock-seg lq-lock-seg--locked" style={{ width: `${otherLocked}%` }} title={`Locked ${fmtPct(otherLocked)}`} />}
        {vest > 0 && <span className="lq-lock-seg lq-lock-seg--vest" style={{ width: `${vest}%` }} title={`Vesting ${fmtPct(vest)}`} />}
      </div>

      {holders.length > 0 ? (
        <div className="lq-lock-holders">
          {holders.map((h, i) => {
            const burn = isBurn(h)
            const when = h.permanent || burn ? 'permanent' : (fmtUnlock(h.unlockAt) || 'no unlock date')
            return (
              <div className="lq-lock-holder" key={`${h.entityId || h.name || h.protocol || 'h'}-${i}`}>
                <span className="lq-lock-who">
                  {burn
                    ? <Flame size={11} strokeWidth={2.25} aria-hidden="true" className="lq-lock-ico lq-lock-ico--burn" />
                    : <Lock size={11} strokeWidth={2.25} aria-hidden="true" className="lq-lock-ico" />}
                  {holderName(h)}
                  {h.protocol && !burn && h.name && h.name !== 'PAIR' && LOCK_PROTOCOL_NAME[h.protocol] && LOCK_PROTOCOL_NAME[h.protocol] !== h.name && (
                    <span className="lq-lock-proto">{LOCK_PROTOCOL_NAME[h.protocol]}</span>
                  )}
                </span>
                <span className="lq-lock-share">{fmtPct(h.sharePct)}</span>
                <span className={`lq-lock-when${h.permanent || burn ? ' is-perm' : ''}`}>{when}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="lq-lock-none">
          {locked > 0 ? 'Locked, holder not attributed.' : 'Nothing locked - LP can be pulled at any time.'}
        </div>
      )}

      {next && locked > 0 && (
        <div className="lq-lock-next">Next release: {next.replace(/^unlocks /, '')}</div>
      )}

      <OtherPools others={others} />
    </div>
  )
}

// Every other pool of the token. Locked pools get their own chip; unlocked
// ones (CLMM / Orca positions are NFTs and never read as "locked") collapse
// into one count so the strip is not a row of identical 0% chips.
function OtherPools({ others }) {
  if (!others?.length) return null
  const locked = others.filter((p) => p.lockedPct > 0).slice(0, 6)
  const unlockedCount = others.length - others.filter((p) => p.lockedPct > 0).length
  return (
    <div className="lq-lock-others">
      <span className="lq-lock-others-label">Other pools</span>
      {locked.map((p) => (
        <span className="lq-lock-other" key={p.pairAddress} title={p.pairAddress}>
          <span className="lq-lock-other-proto">{p.protocol || 'Pool'}</span>
          <span className={`lq-lock-other-pct ${p.lockedPct >= 90 ? 'is-safe' : p.lockedPct >= 50 ? 'is-mid' : 'is-low'}`}>{fmtPct(p.lockedPct)}</span>
        </span>
      ))}
      {unlockedCount > 0 && (
        <span className="lq-lock-other lq-lock-other--muted" title="Pools with no lock record">
          {unlockedCount} unlocked
        </span>
      )}
    </div>
  )
}

export default function LiquidityPanel({ token, marketCap = 0, tokenPrice = 0, onCopy, explorerUrl }) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // Lock state is independent of the pair card: it paints when it lands and
  // never blocks the reserves above it. null = not loaded yet.
  const [locks, setLocks] = useState(null)

  useEffect(() => {
    let cancelled = false
    const addr = token?.address
    if (!addr) { setLoading(false); setError(true); return }
    setLoading(true); setError(false)
    getPairInfo(addr, token?.networkId || 1)
      .then((res) => {
        if (cancelled) return
        setInfo(res || null)
        setError(!res)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [token?.address, token?.networkId])

  // Locks wait for the pair card to resolve so the primary pool's address can
  // ride along (see getLiquidityLocks: the token-level list is paged at 25).
  // A pair-info failure still asks without it, so the other-pools strip can
  // paint on its own.
  const pairForLocks = loading ? undefined : (info?.pairAddress || '')
  useEffect(() => {
    let cancelled = false
    const addr = token?.address
    setLocks(null)
    if (!addr || pairForLocks === undefined) return
    getLiquidityLocks(addr, token?.networkId || 1, pairForLocks)
      .then((res) => { if (!cancelled) setLocks(res || { pools: [], error: 'failed' }) })
      .catch(() => { if (!cancelled) setLocks({ pools: [], error: 'failed' }) })
    return () => { cancelled = true }
  }, [token?.address, token?.networkId, pairForLocks])

  // The lock item for the PRIMARY pool (the pair card above), plus every other
  // pool with any liquidity for the "other pools" strip. EVM pair addresses are
  // case-insensitive; Solana base58 is not, so only fold the 0x form.
  const { primaryLock, otherLocks } = useMemo(() => {
    const pools = (locks?.pools || []).filter((p) => p.hasLiquidity)
    const want = info?.pairAddress ? String(info.pairAddress) : ''
    const norm = (a) => (String(a).startsWith('0x') ? String(a).toLowerCase() : String(a))
    const primary = want ? pools.find((p) => norm(p.pairAddress) === norm(want)) || null : null
    const others = pools.filter((p) => p !== primary).sort((a, b) => b.lockedPct - a.lockedPct)
    return { primaryLock: primary, otherLocks: others }
  }, [locks, info?.pairAddress])

  if (loading) {
    return (
      <div className="lq">
        <div className="lq-card lq-card--skel" aria-hidden="true">
          <span className="lq-skel lq-skel--head" />
          <span className="lq-skel lq-skel--big" />
          <span className="lq-skel lq-skel--row" />
          <span className="lq-skel lq-skel--row" />
        </div>
      </div>
    )
  }

  if (error || !info) {
    return (
      <div className="lq">
        <div className="lq-empty">
          <p>Liquidity data unavailable.</p>
          <span>No indexed pool for this token.</span>
        </div>
      </div>
    )
  }

  const baseSym = info.token?.symbol || token?.symbol || 'TOKEN'
  const quoteSym = info.quote?.symbol || 'QUOTE'
  const dexName = info.exchange?.name || 'DEX'
  const age = fmtAge(info.createdAt)
  const liq = Number(info.liquidity) || 0
  const liqMcapPct = marketCap > 0 && liq > 0 ? (liq / marketCap) * 100 : null

  return (
    <div className="lq" role="region" aria-label="Liquidity">
      <div className="lq-note">Primary pool</div>

      <div className="lq-card">
        {/* header — exchange + pair */}
        <div className="lq-head">
          <div className="lq-dex">
            {info.exchange?.iconUrl
              ? <img className="lq-dex-ico" src={info.exchange.iconUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              : <span className="lq-dex-ico lq-dex-ico--fallback" aria-hidden="true" />}
            <span className="lq-dex-name">{dexName}</span>
          </div>
          <div className="lq-pair">
            <span className="lq-pair-sym">{baseSym}<span className="lq-pair-slash">/</span>{quoteSym}</span>
            {age && <span className="lq-pair-age">{age} old</span>}
          </div>
        </div>

        {/* total liquidity */}
        <div className="lq-total">
          <span className="lq-total-label">Total liquidity</span>
          <span className="lq-total-value">{fmtUsd(liq)}</span>
        </div>

        {/* locked liquidity - primary pool, from current on-chain lock state */}
        {locks === null ? (
          <div className="lq-lock lq-lock--skel" aria-hidden="true">
            <span className="lq-skel lq-skel--head" />
            <span className="lq-skel lq-skel--bar" />
            <span className="lq-skel lq-skel--row" />
          </div>
        ) : primaryLock ? (
          <LockBlock pool={primaryLock} others={otherLocks} />
        ) : (
          <div className="lq-lock lq-lock--empty">
            <span className="lq-lock-label">
              <Lock size={11} strokeWidth={2.25} aria-hidden="true" />
              Locked liquidity
            </span>
            <span className="lq-lock-none">
              {locks.error === 'plan_gated'
                ? 'Lock data needs a Codex Growth plan.'
                : locks.error
                  ? 'Lock data unavailable right now.'
                  : otherLocks.length > 0
                    ? 'No lock record for this pool.'
                    : 'No lock record indexed for this token.'}
            </span>
            <OtherPools others={otherLocks} />
          </div>
        )}

        {/* pooled reserves */}
        <div className="lq-reserves">
          <div className="lq-reserve">
            <span className="lq-reserve-label">Pooled {baseSym}</span>
            <span className="lq-reserve-value">{fmtNum(info.pooledToken)}</span>
          </div>
          <div className="lq-reserve">
            <span className="lq-reserve-label">Pooled {quoteSym}</span>
            <span className="lq-reserve-value">{fmtNum(info.pooledQuote)}</span>
          </div>
        </div>

        {/* quick stats */}
        <div className="lq-stats">
          <div className="lq-stat">
            <span className="lq-stat-label">Price</span>
            <span className="lq-stat-value">{tokenPrice > 0 ? formatPrice(tokenPrice) : '—'}</span>
          </div>
          <div className="lq-stat">
            <span className="lq-stat-label">Market cap</span>
            <span className="lq-stat-value">{marketCap > 0 ? fmtUsd(marketCap) : '—'}</span>
          </div>
          <div className="lq-stat">
            <span className="lq-stat-label">Liq / MCap</span>
            <span className="lq-stat-value">{liqMcapPct != null ? `${liqMcapPct.toFixed(1)}%` : '—'}</span>
          </div>
        </div>

        {/* pair address */}
        {info.pairAddress && (
          <div className="lq-addr-row">
            <span className="lq-addr-label">Pair</span>
            <span className="lq-addr">{truncAddr(info.pairAddress)}</span>
            <button type="button" className="lq-addr-btn" aria-label="Copy pair address" onClick={() => onCopy?.(info.pairAddress)}>
              <Copy size={13} strokeWidth={2} aria-hidden="true" />
            </button>
            {explorerUrl && (
              <a className="lq-addr-btn" href={explorerUrl(info.pairAddress)} target="_blank" rel="noopener noreferrer" aria-label="View pair on explorer">
                <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
              </a>
            )}
          </div>
        )}

        {info.exchange?.tradeUrl && (
          <a className="lq-trade" href={info.exchange.tradeUrl} target="_blank" rel="noopener noreferrer">
            Open on {dexName}
            <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  )
}
