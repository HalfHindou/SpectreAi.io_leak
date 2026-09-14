/**
 * RzProjectSnapshot — high-density chain + token facts in one card.
 *
 *   chain · contract · decimals · total supply · circulating
 *   FDV / MCap · 24h vol · LP reserve · age · deployer · audits / risk flags
 *
 * Pulls from `dossier` (the existing useDossierProject result) and
 * `activeTokenInfo` so it has what it needs without new endpoints.
 *
 * Glass card, mono numbers, no left-side accent bar, day-mode counterpart.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SectionShell from './rz-pro-sections/section-shell'
import './rz-project-snapshot.css'

function fmtCompact(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`
  if (Math.abs(v) >= 1e9)  return `${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6)  return `${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e3)  return `${(v / 1e3).toFixed(1)}K`
  return Math.round(v).toLocaleString()
}
function fmtUsd(n) { const s = fmtCompact(n); return s === '—' ? '—' : `$${s}` }

function shortAddr(addr) {
  if (!addr) return '—'
  const s = String(addr)
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s
}

function fmtAge(iso) {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const days = (Date.now() - ms) / 86_400_000
  if (days < 1) return `${Math.round(days * 24)}h`
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${(days / 365).toFixed(1)}y`
}

function isMeaningful(v) {
  if (v == null) return false
  if (typeof v === 'string') return v !== '—' && v.trim() !== ''
  return true
}
const Stat = React.memo(({ label, value, sub, mono = true }) => {
  if (!isMeaningful(value)) return null
  return (
    <div className="rz-snap-stat">
      <span className="rz-snap-stat-label">{label}</span>
      <span className={`rz-snap-stat-val${mono ? ' mono' : ''}`}>{value}</span>
      {sub && <span className="rz-snap-stat-sub mono">{sub}</span>}
    </div>
  )
})

const RzProjectSnapshot = React.memo(({ dossier, activeTokenInfo, td, sym }) => {
  const { t } = useTranslation()
  const chain = dossier?.chain || activeTokenInfo?.networkLabel || activeTokenInfo?.chain || td?.chain || null
  const contract = activeTokenInfo?.address || dossier?.contracts?.[0]?.address || null
  const decimals = activeTokenInfo?.decimals ?? dossier?.tokenomics?.decimals ?? null
  const total = td?.totalSupply ?? dossier?.tokenomics?.total_supply ?? dossier?.maxSupply ?? null
  const circ = td?.circulatingSupply ?? dossier?.tokenomics?.circulating ?? null
  const fdv = td?.fdv ?? dossier?.tokenomics?.fdv ?? null
  const mcap = td?.marketCap ?? null
  const vol24 = td?.volume24h ?? dossier?.dexPairs?.[0]?.volume24h ?? null
  const lp = dossier?.dexPairs?.[0]?.liquidityUsd ?? null
  const age = dossier?.launchDate || activeTokenInfo?.pairCreatedAt || null
  const deployer = dossier?.contracts?.[0]?.deployer || dossier?.deployer || null
  const audits = Array.isArray(dossier?.audits) ? dossier.audits : []
  const riskScore = dossier?.riskComposite?.score ?? null
  const trustScore = dossier?.trustScore ?? null
  const trustTotal = dossier?.trustTotal ?? null

  const circPct = useMemo(() => {
    if (!Number.isFinite(Number(total)) || !Number.isFinite(Number(circ)) || Number(total) === 0) return null
    return (Number(circ) / Number(total)) * 100
  }, [total, circ])

  const explorerUrl = useMemo(() => {
    if (!contract || !chain) return null
    const c = String(chain).toLowerCase()
    if (c.includes('ethereum') || c === 'eth') return `https://etherscan.io/token/${contract}`
    if (c.includes('solana') || c === 'sol') return `https://solscan.io/token/${contract}`
    if (c.includes('bsc')) return `https://bscscan.com/token/${contract}`
    if (c.includes('base')) return `https://basescan.org/token/${contract}`
    if (c.includes('arbitrum')) return `https://arbiscan.io/token/${contract}`
    return null
  }, [contract, chain])

  return (
    <SectionShell
      id="proj-snapshot"
      label={t('researchPro.projectSnapshot.rzprojectsnapshot.label', "PROJECT · SNAPSHOT")}
      title={`${sym || 'Token'} chain facts`}
      subtitle={t('researchPro.projectSnapshot.rzprojectsnapshot.subtitle', "Hard on-chain identity + supply + liquidity + risk")}
      collapsible
    >
      <div className="rz-snap-grid">
        <Stat label={t('researchPro.projectSnapshot.rzprojectsnapshot.label2', "Chain")} value={chain || '—'} mono={false} />
        <Stat
          label={t('researchPro.projectSnapshot.rzprojectsnapshot.label3', "Contract")}
          value={
            contract
              ? <span className="rz-snap-addr">
                  {explorerUrl
                    ? <a href={explorerUrl} target="_blank" rel="noopener noreferrer">{shortAddr(contract)}</a>
                    : shortAddr(contract)}
                </span>
              : '—'
          }
        />
        <Stat label={t('researchPro.projectSnapshot.rzprojectsnapshot.label4', "Decimals")} value={decimals != null ? String(decimals) : '—'} />
        <Stat label={t('researchPro.projectSnapshot.rzprojectsnapshot.label5', "Age")} value={fmtAge(age)} sub={age ? new Date(age).toISOString().slice(0, 10) : null} />
        <Stat label={t('researchPro.projectSnapshot.rzprojectsnapshot.label6', "Total supply")} value={fmtCompact(total)} sub={circPct != null ? `${circPct.toFixed(1)}% circulating` : null} />
        <Stat label={t('researchPro.projectSnapshot.rzprojectsnapshot.label7', "Circulating")} value={fmtCompact(circ)} />
        <Stat label={t('researchPro.projectSnapshot.rzprojectsnapshot.label8', "FDV")} value={fmtUsd(fdv)} />
        <Stat label={t('researchPro.projectSnapshot.rzprojectsnapshot.label9', "Market cap")} value={fmtUsd(mcap)} />
        <Stat label={t('researchPro.projectSnapshot.rzprojectsnapshot.label10', "24h volume")} value={fmtUsd(vol24)} />
        <Stat label={t('researchPro.projectSnapshot.rzprojectsnapshot.label11', "LP reserves")} value={fmtUsd(lp)} />
        {deployer && (
          <Stat
            label={t('researchPro.projectSnapshot.rzprojectsnapshot.label12', "Deployer")}
            value={<span className="rz-snap-addr">{shortAddr(deployer)}</span>}
          />
        )}
        {trustScore != null && (
          <Stat
            label={t('researchPro.projectSnapshot.rzprojectsnapshot.label13', "Trust score")}
            value={`${trustScore}${trustTotal ? `/${trustTotal}` : ''}`}
            sub="sources contributing"
          />
        )}
        {riskScore != null && (
          <Stat label={t('researchPro.projectSnapshot.rzprojectsnapshot.label14', "Risk composite")} value={Number(riskScore).toFixed(1)} sub="0–10 lower=safer" />
        )}
        {audits.length > 0 && (
          <Stat
            label={t('researchPro.projectSnapshot.rzprojectsnapshot.label15', "Audits")}
            value={`${audits.length}`}
            sub={audits.slice(0, 2).map((a) => a.firm || a.name).filter(Boolean).join(', ') || null}
            mono={false}
          />
        )}
      </div>
    </SectionShell>
  )
})

RzProjectSnapshot.displayName = 'RzProjectSnapshot'
export default RzProjectSnapshot
