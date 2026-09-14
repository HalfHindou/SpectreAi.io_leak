/**
 * RzHolderDistribution — top-N holders + concentration metric.
 *
 * Reads dossier.holderBreakdown.items (already populated by dossier-proxy
 * via blockscout / Spectre's onchain holder snapshot). Falls back to
 * dossier.onchainExplorer.topHolders when present.
 *
 * Layout: stacked horizontal bar split by holder %. Plus a concentration
 * line ("top10 = X%") and a labeled list of top wallets with explorer
 * links.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SectionShell from './rz-pro-sections/section-shell'
import './rz-holder-distribution.css'

function shortAddr(a) {
  if (!a) return '—'
  const s = String(a)
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s
}
function fmtPct(n) {
  if (!Number.isFinite(Number(n))) return '—'
  return `${Number(n).toFixed(2)}%`
}

const KIND_LABEL = {
  exchange: 'CEX',
  dex: 'DEX',
  burn: 'BURN',
  contract: 'CTRT',
  team: 'TEAM',
  treasury: 'TREASURY',
  vc: 'VC',
};

const RzHolderDistribution = React.memo(({ dossier, td, sym }) => {
  const { t } = useTranslation()
  const items = useMemo(() => {
    const fromBreakdown = dossier?.holderBreakdown?.items;
    if (Array.isArray(fromBreakdown) && fromBreakdown.length) return fromBreakdown;
    const fromOnchain = dossier?.onchainExplorer?.topHolders;
    if (Array.isArray(fromOnchain)) {
      const total = fromOnchain.reduce((a, h) => a + (Number(h.balance) || 0), 0) || 1;
      return fromOnchain.slice(0, 12).map((h, i) => ({
        rank: i + 1,
        address: h.address,
        pct: (Number(h.balance) / total) * 100,
        balance: Number(h.balance),
        kind: h.label || h.kind || null,
      }));
    }
    return [];
  }, [dossier]);

  // Hide entirely when no holder data — better than a placeholder card.
  if (!items.length) return null;

  const top10pct = items.slice(0, 10).reduce((a, h) => a + (Number(h.pct) || 0), 0);
  const top1 = items[0];
  const concentration = top10pct >= 50 ? 'high' : top10pct >= 25 ? 'medium' : 'low';

  return (
    <SectionShell
      id="proj-holders"
      label={t('researchPro.holderDistribution.rzholderdistribution.label', "PROJECT · HOLDERS")}
      title={t('researchPro.holderDistribution.rzholderdistribution.title', "Holder distribution")}
      subtitle={`Top-10 hold ${top10pct.toFixed(1)}% · concentration ${concentration}`}
      collapsible
    >
      <div className="rz-hd">
        {/* Stacked bar */}
        <div className="rz-hd-stack">
          {items.slice(0, 12).map((h, i) => {
            const w = Math.max(0.5, Math.min(100, Number(h.pct) || 0));
            const kind = (h.kind || h.label || 'wallet').toLowerCase();
            return (
              <div
                key={`${h.address || i}-${i}`}
                className={`rz-hd-stack-seg rz-hd-stack-seg--${kind.replace(/[^a-z]/g, '')}`}
                style={{ width: `${w}%` }}
                title={`${shortAddr(h.address)} — ${fmtPct(h.pct)}`}
              />
            );
          })}
          {top10pct < 100 && (
            <div className="rz-hd-stack-seg rz-hd-stack-seg--rest" style={{ width: `${Math.max(0, 100 - items.reduce((a, h) => a + (Number(h.pct) || 0), 0))}%` }} title={t('researchPro.holderDistribution.rzholderdistribution.title2', "rest")} />
          )}
        </div>

        {/* Top holders table */}
        <ul className="rz-hd-list">
          {items.slice(0, 10).map((h, i) => {
            const kind = (h.kind || h.label || '').toLowerCase().replace(/[^a-z]/g, '');
            return (
              <li key={`${h.address || i}-${i}`} className="rz-hd-row">
                <span className="rz-hd-rank mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="rz-hd-addr mono">{shortAddr(h.address)}</span>
                {kind && KIND_LABEL[kind] && (
                  <span className={`rz-hd-tag rz-hd-tag--${kind}`}>{KIND_LABEL[kind]}</span>
                )}
                <span className="rz-hd-pct mono">{fmtPct(h.pct)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionShell>
  );
});

RzHolderDistribution.displayName = 'RzHolderDistribution';
export default RzHolderDistribution;
