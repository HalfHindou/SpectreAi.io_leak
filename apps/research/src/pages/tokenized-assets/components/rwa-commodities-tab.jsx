import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import RwaInteractiveChart from './rwa-interactive-chart'
import RwaHorizontalBars from './rwa-horizontal-bars'
import {
  KpiCard,
  SlicerControl,
  TimeframePills,
  AIAnalysisCard,
  HeroSplit,
  MarketShareTable,
  RwaEmptyState,
} from './shared'
import { TA_CATEGORICAL, TA_MATERIAL_COLORS as TYPE_COLOR } from './shared/ta-tokens'
import { isCommodityProtocol, weightedChange, hexToRgba } from './rwa-shared'
import VaultStack from './creatives/VaultStack'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import './commodities.css'

/* Issuer categories that belong on the Commodities tab. These come from
   /api/rwa/issuers (Spectre data API) — the tab previously only consumed
   DefiLlama-derived `protocols` which clusters all metal/carbon products as
   a single "Commodities" sector. */
const COMMODITY_ISSUER_CATEGORIES = new Set([
  'commodities',
  'industrial-metals',
  'carbon-credits',
  'agricultural-commodities',
  'commodity-baskets',
])

/* Material-type slicer pills. Filtered at render time to those present in
   data (live OR pending) so the user never clicks an empty filter. */
const ALL_TYPE_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'gold', label: 'Gold' },
  { id: 'silver', label: 'Silver' },
  { id: 'platinum', label: 'Platinum' },
  { id: 'palladium', label: 'Palladium' },
  { id: 'carbon-credits', label: 'Carbon Credits' },
  { id: 'industrial-metals', label: 'Industrial Metals' },
  { id: 'petroleum', label: 'Petroleum' },
  { id: 'agricultural', label: 'Agricultural' },
  { id: 'baskets', label: 'Baskets' },
  { id: 'unclassified', label: 'Unclassified' },
]

/* ── Commodity material-type inference ──
   Order of precedence:
     1. Issuer subcategory (authoritative — set by migration 106)
     2. Issuer category (carbon-credits, industrial-metals, etc.)
     3. Keyword heuristic on name (legacy DefiLlama rows). Wide net so
        nothing falls through to "Unclassified".
*/
function inferCommodityType(item) {
  const sub = (item?.subcategory || '').toLowerCase()
  if (sub === 'gold') return 'Gold'
  if (sub === 'silver') return 'Silver'
  if (sub === 'platinum') return 'Platinum'
  if (sub === 'palladium') return 'Palladium'
  if (sub === 'carbon') return 'Carbon Credits'
  if (sub === 'petroleum') return 'Petroleum'
  if (sub === 'copper' || sub === 'lithium') return 'Industrial Metals'
  if (sub === 'agricultural') return 'Agricultural'
  if (sub === 'baskets') return 'Baskets'

  const cat = (item?.category || '').toLowerCase()
  if (cat === 'carbon-credits') return 'Carbon Credits'
  if (cat === 'industrial-metals') {
    const n = (item?.name || '').toLowerCase()
    if (n.includes('silver') || n.includes('kag') || n.includes('xag')) return 'Silver'
    if (n.includes('copper')) return 'Industrial Metals'
    if (n.includes('lithium')) return 'Industrial Metals'
    return 'Industrial Metals'
  }
  if (cat === 'agricultural-commodities') return 'Agricultural'
  if (cat === 'commodity-baskets') return 'Baskets'

  // commodities or unknown → keyword heuristic. Order matters: Carbon first
  // (some carbon names contain "gold"-adjacent words), then specific metals,
  // then gold (broadest), then issuer brand-name fallbacks.
  const n = (item?.name || '').toLowerCase()
  if (n.includes('carbon') || n.includes('mco2') || n.includes('bct') || n.includes('nct') ||
      n.includes('ubo') || n.includes('co2') || n.includes('toucan') || n.includes('klima') ||
      n.includes('moss') || n.includes('cana')) return 'Carbon Credits'
  if (n.includes('platinum') || n.includes('xpt') || n.includes('txpt')) return 'Platinum'
  if (n.includes('palladium') || n.includes('xpd') || n.includes('txpd')) return 'Palladium'
  if (n.includes('silver') || n.includes('agx') || n.includes('xag') ||
      (n.includes('kag') && !n.includes('kagi'))) return 'Silver'
  if (n.includes('petroleum') || n.includes(' oil') || n.startsWith('oil ') || n.includes('petro')) return 'Petroleum'
  if (n.includes('copper')) return 'Industrial Metals'
  if (n.includes('lithium')) return 'Industrial Metals'
  if (n.includes('agricultur') || n.includes('soy') || n.includes('coffee') ||
      n.includes('crsoy') || n.includes('agro')) return 'Agricultural'
  // Gold is the broadest catch-all; issuer brand names also classified here.
  if (n.includes('gold') || n.includes('paxg') || n.includes('xaut') || n.includes('kau') ||
      n.includes('vnxau') || n.includes('tgold') || n.includes('dgx') || n.includes('aux') ||
      n.includes('meld') || n.includes('kinesis') || n.includes('aurus') || n.includes('comtech') ||
      n.includes('cache') || n.includes('asa.') || n.includes('digix')) return 'Gold'
  // Generic "commodity" mentions without a specific material → Industrial Metals
  // (closest neutral bucket; we prefer this over "Other" so segments stay tidy).
  if (n.includes('commodity') || n.includes('metal')) return 'Industrial Metals'
  return 'Unclassified'
}

/* ── Dedup key for legacy DefiLlama rows vs issuer-direct rows ──
   Returns a normalized fingerprint that matches a DefiLlama protocol against
   an issuer-direct row even when names differ ("Tether Gold" vs
   "Tether Gold (XAUt)"). We strip parens, ticker suffixes, and common
   suffix words. */
function commodityFingerprint(p) {
  if (!p) return ''
  const raw = String(p.name || '').toLowerCase()
  return raw
    .replace(/\([^)]*\)/g, '')          // drop "(XAUt)", "(PAXG)" etc.
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(token|tokenized|gold|silver|carbon|tonne|credit|credits|finance|protocol|usd|inc|llc|ag|ltd)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ── Palette per material type. Anchored to physical-asset visual cues. ── */
// Material colours now live in shared/ta-tokens.js (TA_MATERIAL_COLORS),
// imported above as TYPE_COLOR — single source for the JS chart + CSS pills.

/* Map type-pill id (kebab) → display label (matches inferCommodityType output). */
const TYPE_ID_TO_LABEL = {
  gold: 'Gold',
  silver: 'Silver',
  platinum: 'Platinum',
  palladium: 'Palladium',
  'carbon-credits': 'Carbon Credits',
  'industrial-metals': 'Industrial Metals',
  petroleum: 'Petroleum',
  agricultural: 'Agricultural',
  baskets: 'Baskets',
  unclassified: 'Unclassified',
}

/* Threshold below which "Unclassified" is dropped entirely from the Vault
   Composition + type pills. Below $1M it's noise — there's no meaningful
   data-quality signal to surface. */
const UNCLASSIFIED_MIN_USD = 1_000_000

/* Identify whether an issuer row is a pending-oracle placeholder. */
function isPendingIssuer(i) {
  // Source 'pending_oracle' is set by the worker when the adapter is
  // pending_oracle.js. Slug suffix '-pending' is the back-up signal in case
  // the snapshot hasn't refreshed since the migration.
  if (!i) return false
  if (i.source === 'pending_oracle') return true
  if (typeof i.slug === 'string' && i.slug.endsWith('-pending')) return true
  return false
}

/* ══════════════════════════════════════════
   RwaCommoditiesTab
   ══════════════════════════════════════════ */

export default function RwaCommoditiesTab({
  protocols,
  tvlHistory,
  breakdownHistory,
  loading,
  dayMode,
  onAssetOpen,
}) {
  const { t, i18n } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const formatValue = (v) => (v == null || v === 0 ? '--' : fmtLargeShort(v))
  const [slicer, setSlicer] = useState({ type: 'all', metric: 'tvl', grouping: 'issuer' })
  const [tf, setTf] = useState('1Y')
  const [typeFilter, setTypeFilter] = useState(null) // from widget-click

  /* ── Issuer-direct feed from Spectre data API ── */
  const [issuerRows, setIssuerRows] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/rwa/issuers')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        // The API returns { data: { issuers: [...] } }; older callers read
        // d.issuers (always undefined) so the tab silently fell back to the
        // DefiLlama feed (gold-clustered) and never showed silver/platinum,
        // which live here under category `industrial-metals` (subcategory silver).
        const arr = Array.isArray(d?.data?.issuers) ? d.data.issuers
          : Array.isArray(d?.issuers) ? d.issuers
          : Array.isArray(d?.data) ? d.data
          : null
        setIssuerRows(arr)
      })
      .catch(() => { if (!cancelled) setIssuerRows(null) })
    return () => { cancelled = true }
  }, [])

  /* ── Build the unified commodity universe (live + pending) ──
     1. Legacy DefiLlama-derived protocols filtered by isCommodityProtocol.
     2. Issuer-direct rows whose category is in COMMODITY_ISSUER_CATEGORIES.
     3. De-dup by name fingerprint AND slug AND CG ID (issuer-direct wins).
        We keep issuer-direct rows even when their adapter is currently in
        an error state (aum_usd null) so we can still suppress the duplicate
        DefiLlama row — preventing the "Tether Gold appears twice" bug that
        was leaking ~$416M into the Vault Composition's Other bucket.
     Live and pending rows are kept in the same array; downstream code reads
     the `pending` flag to render them differently (muted bars, no league row).
  */
  const commodityProtocols = useMemo(() => {
    const legacy = (protocols || []).filter(isCommodityProtocol)

    if (!issuerRows || issuerRows.length === 0) return legacy

    // ALL issuer-direct rows in commodity categories — including rows whose
    // adapter is currently failing. We need them in the dedup-fingerprint set
    // even if they don't appear as live rows.
    const issuerCommoditiesAll = issuerRows
      .filter((i) => COMMODITY_ISSUER_CATEGORIES.has(i.category))

    // Live + pending rows that surface in the UI.
    const issuerCommodities = issuerCommoditiesAll
      .filter((i) => Number.isFinite(i.aum_usd) || isPendingIssuer(i))
      .map((i) => ({
        name: i.name,
        slug: i.slug,
        tvl: Number.isFinite(i.aum_usd) ? i.aum_usd : 0,
        category: i.category,           // authoritative
        subcategory: i.subcategory || null,
        chain: i.chain,
        chains: i.chain ? [i.chain] : [],
        change_7d: null,
        change_30d: null,
        pending: isPendingIssuer(i),
        _source: i.source || 'issuer_direct',
      }))

    // Build the dedup key set from ALL issuer-direct rows (even null-aum).
    const seenFingerprints = new Set()
    const seenSlugs = new Set()
    const seenCgIds = new Set()
    for (const i of issuerCommoditiesAll) {
      const fp = commodityFingerprint(i)
      if (fp) seenFingerprints.add(fp)
      if (i.slug) seenSlugs.add(String(i.slug).toLowerCase())
      if (i.coingecko_id) seenCgIds.add(String(i.coingecko_id).toLowerCase())
    }

    const dedupedLegacy = legacy.filter((p) => {
      const fp = commodityFingerprint(p)
      if (fp && seenFingerprints.has(fp)) return false
      const slug = (p.slug || '').toLowerCase()
      if (slug && seenSlugs.has(slug)) return false
      const cg = (p.coingecko_id || p.cgId || '').toLowerCase()
      if (cg && seenCgIds.has(cg)) return false
      // Final exact-name fallback (preserves prior behavior).
      const lname = (p.name || '').toLowerCase()
      for (const i of issuerCommoditiesAll) {
        if ((i.name || '').toLowerCase() === lname) return false
      }
      return true
    })
    return [...issuerCommodities, ...dedupedLegacy]
  }, [protocols, issuerRows])

  /* Live-only universe (drives KPIs, charts, league table). Pending rows
     surface only in the type-pills + "Split by Type" bars + legend. */
  const liveProtocols = useMemo(
    () => commodityProtocols.filter((p) => !p.pending),
    [commodityProtocols]
  )
  const pendingProtocols = useMemo(
    () => commodityProtocols.filter((p) => p.pending),
    [commodityProtocols]
  )

  /* ── Dynamic type pills ──
     Render a pill for any material type that has either non-zero AUM OR a
     pending row. This is what answers "where's oil?" — petroleum gets a
     pill because the pending row exists, even though aum=0. */
  const presentTypes = useMemo(() => {
    const set = new Set()
    for (const p of liveProtocols) {
      if ((p.tvl || 0) > 0) set.add(inferCommodityType(p))
    }
    for (const p of pendingProtocols) set.add(inferCommodityType(p))
    return set
  }, [liveProtocols, pendingProtocols])

  const SLICER_AXES = useMemo(() => {
    const baseAxes = {
      metric: [
        { id: 'tvl', label: t('tokenizedAssets.tabs.commodities.slicer.metric.tvl', 'TVL') },
        { id: 'issuance', label: t('tokenizedAssets.tabs.commodities.slicer.metric.issuance', 'Issuance') },
        { id: 'volume', label: t('tokenizedAssets.tabs.commodities.slicer.metric.volume', 'Volume') },
      ],
      grouping: [
        { id: 'issuer', label: t('tokenizedAssets.tabs.commodities.slicer.grouping.issuer', 'Issuer') },
        { id: 'chain', label: t('tokenizedAssets.tabs.commodities.slicer.grouping.chain', 'Chain') },
        { id: 'custodian', label: t('tokenizedAssets.tabs.commodities.slicer.grouping.custodian', 'Custodian') },
      ],
    }
    const labelById = {
      all: t('tokenizedAssets.tabs.commodities.types.all', 'All'),
      gold: t('tokenizedAssets.tabs.commodities.types.gold', 'Gold'),
      silver: t('tokenizedAssets.tabs.commodities.types.silver', 'Silver'),
      platinum: t('tokenizedAssets.tabs.commodities.types.platinum', 'Platinum'),
      palladium: t('tokenizedAssets.tabs.commodities.types.palladium', 'Palladium'),
      'carbon-credits': t('tokenizedAssets.tabs.commodities.types.carbonCredits', 'Carbon Credits'),
      'industrial-metals': t('tokenizedAssets.tabs.commodities.types.industrialMetals', 'Industrial Metals'),
      petroleum: t('tokenizedAssets.tabs.commodities.types.petroleum', 'Petroleum'),
      agricultural: t('tokenizedAssets.tabs.commodities.types.agricultural', 'Agricultural'),
      baskets: t('tokenizedAssets.tabs.commodities.types.baskets', 'Baskets'),
      unclassified: t('tokenizedAssets.tabs.commodities.types.unclassified', 'Unclassified'),
    }
    const types = ALL_TYPE_OPTIONS
      .filter((opt) => opt.id === 'all' || presentTypes.has(TYPE_ID_TO_LABEL[opt.id]))
      .map((opt) => ({ id: opt.id, label: labelById[opt.id] || opt.label }))
    return { ...baseAxes, type: types }
  }, [presentTypes, t])

  /* ── Apply slicer + widget type filter ── */
  const effectiveType = typeFilter || (slicer.type === 'all' ? null : TYPE_ID_TO_LABEL[slicer.type] || null)
  const filteredProtocols = useMemo(() => {
    if (!effectiveType) return liveProtocols
    return liveProtocols.filter((p) => inferCommodityType(p) === effectiveType)
  }, [liveProtocols, effectiveType])

  /* ── KPIs (live AUM only) ── */
  const kpis = useMemo(() => {
    const totalTvl = liveProtocols.reduce((s, p) => s + (p.tvl || 0), 0)
    const goldTvl = liveProtocols
      .filter((p) => inferCommodityType(p) === 'Gold')
      .reduce((s, p) => s + (p.tvl || 0), 0)
    const goldDominance = totalTvl > 0 ? (goldTvl / totalTvl) * 100 : 0
    const productsCount = liveProtocols.length
    const change30d = weightedChange(liveProtocols, 'change_30d')

    let spark = []
    if (tvlHistory?.series?.length) {
      spark = tvlHistory.series.slice(-30).map(pt => pt.Commodities || 0)
    }

    return [
      { label: t('tokenizedAssets.tabs.commodities.kpis.totalTvl', 'Total Commodities TVL'), value: totalTvl, format: 'currency', delta: change30d, spark },
      { label: t('tokenizedAssets.tabs.commodities.kpis.goldDominance', 'Gold Dominance'), value: `${goldDominance.toFixed(1)}%`, format: 'raw' },
      { label: t('tokenizedAssets.tabs.commodities.kpis.productsCount', 'Products Count'), value: productsCount, format: 'count' },
      { label: t('tokenizedAssets.tabs.commodities.kpis.change30d', '30D Change'), value: change30d, format: 'raw', delta: null },
    ]
  }, [liveProtocols, tvlHistory, t])

  /* ── Stacked area chart from /api/rwa/breakdown/history ──
     Sums commodity-family categories (commodities, industrial-metals,
     carbon-credits, agricultural-commodities, commodity-baskets) per day.
     Each material type becomes a stacked band so the chart visibly shows
     gold/silver/carbon evolving over time, not a single Commodities line.

     Data shape from /v1/rwa/breakdown/history:
       { categories: ['commodities','industrial-metals',…],
         series:    [ { date: <unix>, commodities: 1.2e9, … }, … ] } */
  const chartData = useMemo(() => {
    const empty = { series: [], categories: [], colors: {} }

    if (breakdownHistory?.series?.length) {
      const targetMap = {
        'commodities': null,           // mixed gold+silver+platinum, classify per-issuer
        'industrial-metals': 'Industrial Metals',
        'carbon-credits': 'Carbon Credits',
        'agricultural-commodities': 'Agricultural',
        'commodity-baskets': 'Baskets',
      }
      // Without a per-issuer history endpoint we can't split the
      // 'commodities' bucket into Gold / Silver / Platinum / Palladium, but
      // we DO know from the live issuer feed which materials currently exist
      // there. Use today's live composition to apportion each historical
      // commodities-bucket value across its sub-types.
      const liveCommoditiesByType = {}
      let liveCommoditiesTotal = 0
      for (const p of liveProtocols) {
        if (p.category !== 'commodities') continue
        const t = inferCommodityType(p)
        if (!t || t === 'Other') continue
        liveCommoditiesByType[t] = (liveCommoditiesByType[t] || 0) + (p.tvl || 0)
        liveCommoditiesTotal += (p.tvl || 0)
      }
      const splitCommodities = Object.keys(liveCommoditiesByType)
      const splitWeights = {}
      if (liveCommoditiesTotal > 0 && splitCommodities.length > 0) {
        for (const t of splitCommodities) {
          splitWeights[t] = liveCommoditiesByType[t] / liveCommoditiesTotal
        }
      } else {
        // Fallback: lump it all into Gold (XAUT/PAXG dominance is ~95%).
        splitCommodities.push('Gold')
        splitWeights['Gold'] = 1
      }

      const allTypes = new Set([
        ...splitCommodities,
        ...Object.values(targetMap).filter(Boolean),
      ])

      const series = breakdownHistory.series.map((pt) => {
        const out = { date: pt.date }
        for (const t of allTypes) out[t] = 0
        // Map every breakdown category into its target type.
        for (const [cat, target] of Object.entries(targetMap)) {
          const val = Number(pt[cat] || 0)
          if (!val) continue
          if (target) {
            out[target] = (out[target] || 0) + val
          } else {
            // Apportion across split materials by today's live weights.
            for (const t of splitCommodities) {
              out[t] = (out[t] || 0) + val * (splitWeights[t] || 0)
            }
          }
        }
        return out
      })

      // Order categories by latest value DESC so the largest sits at the
      // bottom of the stack (recharts/RwaInteractiveChart default).
      const last = series[series.length - 1] || {}
      const categories = Array.from(allTypes).sort((a, b) => (last[b] || 0) - (last[a] || 0))
      const colors = {}
      categories.forEach((c) => { colors[c] = TYPE_COLOR[c] || TA_CATEGORICAL[0] })

      // Drop categories that are flat-zero across the entire series.
      const nonZero = categories.filter((c) => series.some((p) => (p[c] || 0) > 0))
      if (nonZero.length === 0) return empty
      return { series, categories: nonZero, colors }
    }

    // Fallback path: legacy tvlHistory protocolSeries (pre-Phase 2 chart).
    if (!tvlHistory?.protocolSeries) return empty
    const commodityProtos = Object.entries(tvlHistory.protocolSeries)
      .filter(([, v]) => v.category === 'Commodities')
    if (!commodityProtos.length) {
      if (!tvlHistory?.series?.length) return empty
      return {
        series: tvlHistory.series.map(p => ({ date: p.date, Commodities: p.Commodities || 0 })),
        categories: ['Commodities'],
        colors: { Commodities: TYPE_COLOR.Gold },
      }
    }
    const typeBuckets = {}
    for (const [, proto] of commodityProtos) {
      const type = inferCommodityType(proto)
      if (!typeBuckets[type]) typeBuckets[type] = []
      typeBuckets[type].push(proto)
    }
    const categories = Object.keys(typeBuckets).sort((a, b) => {
      const totA = typeBuckets[a].reduce((s, p) => s + (p.currentTvl || 0), 0)
      const totB = typeBuckets[b].reduce((s, p) => s + (p.currentTvl || 0), 0)
      return totB - totA
    })
    const colors = {}
    categories.forEach((c) => { colors[c] = TYPE_COLOR[c] || TA_CATEGORICAL[0] })
    const dateMap = {}
    for (const [type, protos] of Object.entries(typeBuckets)) {
      for (const proto of protos) {
        const sd = [...proto.data].sort((a, b) => a.date - b.date)
        for (const pt of sd) {
          const dayKey = Math.floor(pt.date / 86400) * 86400
          if (!dateMap[dayKey]) dateMap[dayKey] = { date: dayKey }
          dateMap[dayKey][type] = (dateMap[dayKey][type] || 0) + pt.tvl
        }
      }
    }
    let series = Object.values(dateMap).sort((a, b) => a.date - b.date)
    const last = {}
    series = series.map(pt => {
      const filled = { date: pt.date }
      for (const c of categories) {
        if (pt[c] != null) last[c] = pt[c]
        filled[c] = pt[c] ?? last[c] ?? 0
      }
      return filled
    })
    return { series, categories, colors }
  }, [breakdownHistory, tvlHistory, liveProtocols])

  /* ── Split by material type (live + pending) ──
     Live rows contribute their AUM; pending rows contribute 0 but still
     render a muted slice/bar so the user sees "Petroleum: pending".
     "Unclassified" is dropped entirely below UNCLASSIFIED_MIN_USD ($1M) to
     prevent low-grade DefiLlama dust from polluting the composition bar. */
  const typeSplit = useMemo(() => {
    const m = {}
    for (const p of commodityProtocols) {
      const t = inferCommodityType(p)
      if (!m[t]) m[t] = { value: 0, pending: false, products: 0 }
      m[t].value += (p.tvl || 0)
      if (p.pending) m[t].pending = true
      // Pending-only types stay flagged pending until a live product appears.
      if (!p.pending) m[t].pending = m[t].pending && false
      m[t].products += 1
    }
    // Drop sub-threshold Unclassified noise.
    if (m['Unclassified'] && m['Unclassified'].value < UNCLASSIFIED_MIN_USD) {
      delete m['Unclassified']
    }
    return Object.entries(m)
      .map(([label, slot]) => ({
        label,
        // Unclassified gets a more honest display label so it's clear this
        // is a data-quality flag, not a real material type.
        displayLabel: label === 'Unclassified'
          ? t('tokenizedAssets.tabs.commodities.unclassifiedAuditPending', 'Unclassified (audit pending)')
          : label,
        value: slot.value,
        // pending=true means EVERY product in this bucket is pending, i.e.
        // there is no live AUM yet. (Mixed buckets where live + pending
        // coexist still report value > 0 and pending=false.)
        pending: slot.value === 0 && slot.pending,
        products: slot.products,
        color: TYPE_COLOR[label] || TYPE_COLOR.Unclassified,
      }))
      .sort((a, b) => {
        // Live first (by AUM desc), then pending alphabetical.
        if (a.pending && !b.pending) return 1
        if (!a.pending && b.pending) return -1
        if (a.pending && b.pending) return a.label.localeCompare(b.label, i18n.language)
        return b.value - a.value
      })
  }, [commodityProtocols, i18n.language, t])

  /* ── Chain breakdown (live only) ── */
  const chainBars = useMemo(() => {
    const m = {}
    for (const p of liveProtocols) {
      const chains = Array.isArray(p.chains) && p.chains.length ? p.chains : (p.chain ? [p.chain] : ['Unknown'])
      const c = chains[0] || 'Unknown'
      m[c] = (m[c] || 0) + (p.tvl || 0)
    }
    return Object.entries(m)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((c, i) => ({ ...c, color: TA_CATEGORICAL[i % TA_CATEGORICAL.length] }))
  }, [liveProtocols])

  /* ── League rows (live only) ── */
  const leagueRows = useMemo(() => {
    if (!filteredProtocols.length) return []
    return [...filteredProtocols]
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .map((p, i) => ({
        rank: i + 1,
        name: p.name,
        slug: p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-'),
        logo: `https://icons.llama.fi/protocols/${p.slug || (p.name || '').toLowerCase().replace(/\s+/g, '-')}`,
        commodityType: inferCommodityType(p),
        tvl: p.tvl || 0,
        change_7d: p.change_7d ?? null,
        change_30d: p.change_30d ?? null,
        chains: Array.isArray(p.chains) ? p.chains.filter(Boolean).join(', ') : (p.chain || '--'),
      }))
  }, [filteredProtocols])

  const LEAGUE_COLUMNS = useMemo(() => [
    {
      key: 'rank',
      label: t('tokenizedAssets.table.rank', '#'),
      width: '44px',
      align: 'left',
      sortable: false,
      render: (v) => <span className="mono ta-table-rank">{v}</span>,
    },
    {
      key: 'name',
      label: t('tokenizedAssets.tabs.commodities.table.product', 'Product'),
      sortable: false,
      render: (_v, row) => (
        <div className="ta-table-logo-cell">
          <img
            className="ta-table-logo"
            src={row.logo}
            alt=""
            loading="lazy"
            onError={e => {
              e.target.style.display = 'none'
              const fb = e.target.nextSibling
              if (fb) fb.style.display = 'inline-flex'
            }}
          />
          <span
            className="ta-table-logo-fb"
            style={{ display: 'none', background: TA_CATEGORICAL[row.rank % TA_CATEGORICAL.length] }}
          >
            {(row.name || '?')[0]}
          </span>
          <div className="ta-table-name">
            <span className="ta-table-name-primary">{row.name}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'commodityType',
      label: t('tokenizedAssets.table.type', 'Type'),
      sortable: false,
      render: (v) => (
        <span className={`ta-commodity-pill ta-commodity-pill-${(v || 'other').toLowerCase().replace(/\s+/g, '-')}`}>{v}</span>
      ),
    },
    { key: 'tvl', label: t('tokenizedAssets.table.tvl', 'TVL'), align: 'right', format: 'currency' },
    { key: 'change_7d', label: t('tokenizedAssets.table.change7d', '7D'), align: 'right', format: 'delta', deltaLabel: '7D' },
    { key: 'change_30d', label: t('tokenizedAssets.table.change30d', '30D'), align: 'right', format: 'delta', deltaLabel: '30D' },
    {
      key: 'chains',
      label: t('tokenizedAssets.table.chains', 'Chains'),
      align: 'left',
      sortable: false,
      render: (v) => <span className="ta-table-chains">{v || '--'}</span>,
    },
  ], [t])

  const handleRowClick = useCallback((row) => {
    const slug = row.slug || (row.name || '').toLowerCase().replace(/\s+/g, '-')
    onAssetOpen?.(slug)
  }, [onAssetOpen])

  /* ── Vault Composition single-stacked-bar widget ──
     One horizontal bar with every type as a stacked segment. Pending types
     get a muted striped fill so they render but don't compete with live AUM. */
  const totalCommodityTvl = typeSplit.reduce((s, t) => s + t.value, 0)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  // Each stack segment gets a min-flex so even Silver at 0.026% renders as a
  // visible filled slice. Pending types get a fixed 4-unit flex (enough to
  // see the diagonal stripes and the label).
  const stackSegments = useMemo(() => {
    const segs = []
    for (const t of typeSplit) {
      if (t.pending) {
        // Pending segment: small fixed flex so it's always visible.
        segs.push({ ...t, flex: 4, pct: 0 })
      } else if (t.value > 0) {
        const pct = totalCommodityTvl > 0 ? (t.value / totalCommodityTvl) * 100 : 0
        // Live segments: scale by share, but force a minimum visible flex
        // (3 units ≈ ~3% wide) so sub-1% bars don't disappear.
        segs.push({ ...t, flex: Math.max(pct, 3), pct })
      }
    }
    return segs
  }, [typeSplit, totalCommodityTvl])

  /* ── Per-metal cards ──
     Every material type in typeSplit becomes its own distinct card — even
     when its share is a fraction of a percent or it has no live AUM yet.
     This is what kills the "single gold bar" look: Silver, Oil/Petroleum,
     Platinum, Palladium and Unclassified are ALWAYS surfaced as their own
     row, never folded into gold. `leader` flags the dominant live metal so
     the gold-dominates story reads at a glance. */
  const metalCards = useMemo(() => {
    let leaderLabel = null
    let leaderVal = -1
    for (const seg of typeSplit) {
      if (!seg.pending && seg.value > leaderVal) { leaderVal = seg.value; leaderLabel = seg.label }
    }
    return typeSplit.map((seg) => ({
      ...seg,
      pct: totalCommodityTvl > 0 ? (seg.value / totalCommodityTvl) * 100 : 0,
      leader: !seg.pending && seg.label === leaderLabel && seg.value > 0,
      audit: seg.label === 'Unclassified',
    }))
  }, [typeSplit, totalCommodityTvl])

  // Dominant-metal narrative: how much of the live vault one metal holds.
  const dominantMetal = useMemo(() => {
    const live = metalCards.filter((m) => !m.pending && m.value > 0)
    if (!live.length) return null
    return live.reduce((a, b) => (b.value > a.value ? b : a))
  }, [metalCards])

  return (
    <div className="ta-tab-content rwa-tab-content">
      {/* 1. KPI strip */}
      <div className="ta-kpi-strip">
        {kpis.map((k, i) => (
          <KpiCard
            key={k.label}
            hero={i === 0}
            label={k.label}
            value={k.format === 'raw' && typeof k.value === 'number' && k.value != null
              ? `${k.value >= 0 ? '+' : ''}${k.value.toFixed(2)}%`
              : k.value}
            format={k.format === 'raw' ? 'raw' : k.format}
            delta={k.delta}
            deltaLabel="30D"
            spark={k.spark}
            loading={loading && !k.value}
          />
        ))}
      </div>

      {/* 2. AI Analysis */}
      <AIAnalysisCard topic="commodities" />

      {/* 3. Hero split — stacked area chart / Vault Stack creative */}
      <HeroSplit
        chart={(
          <div className="ta-hero">
            <div className="ta-hero-controls">
              <SlicerControl
                type={slicer.type}
                metric={slicer.metric}
                grouping={slicer.grouping}
                onChange={setSlicer}
                axes={SLICER_AXES}
                labels={{
                  type: t('tokenizedAssets.slicer.type', 'Type'),
                  metric: t('tokenizedAssets.slicer.metric', 'Metric'),
                  grouping: t('tokenizedAssets.slicer.grouping', 'Grouping'),
                }}
              />
              <TimeframePills value={tf} onChange={setTf} />
            </div>
            {(slicer.type !== 'all' || typeFilter) && chartData.categories.length > 1 && (
              <span className="ta-estimated-note">{t('tokenizedAssets.tabs.commodities.stackSplitNote', 'Stack split derived from issuer-direct material types')}</span>
            )}
            <RwaInteractiveChart
              title={t('tokenizedAssets.tabs.commodities.chartTitle', 'Tokenized Commodities TVL')}
              series={chartData.series}
              categories={chartData.categories}
              colors={chartData.colors}
              loading={loading || (!breakdownHistory && !tvlHistory)}
              height={isMobile ? 220 : 280}
              defaultTimeframe={tf}
              showModeToggle={false}
            />
          </div>
        )}
        creative={<VaultStack items={typeSplit.filter((t) => !t.pending && t.value > 0)} loading={loading} />}
      />

      {/* 4. Two-up — type split + chain breakdown */}
      <div className="ta-two-up">
        <RwaHorizontalBars
          title={t('tokenizedAssets.tabs.commodities.splitByType', 'Split by Type')}
          subtitle={pendingProtocols.length
            ? t('tokenizedAssets.tabs.commodities.liveAndPending', '{{live}} live + {{pending}} pending', { live: liveProtocols.length, pending: pendingProtocols.length })
            : t('tokenizedAssets.tabs.commodities.liveCount', '{{live}} live', { live: liveProtocols.length })}
          items={typeSplit}
          maxItems={10}
          minBarPct={1.5}
        />
        <RwaHorizontalBars
          title={t('tokenizedAssets.tabs.commodities.chainBreakdown', 'Chain Breakdown')}
          subtitle={t('tokenizedAssets.tabs.commodities.byTvl', 'by TVL')}
          items={chainBars}
          maxItems={10}
        />
      </div>

      {/* 5. Full league table (live products only) */}
      <div className="ta-section">
        <div className="ta-section-head">
          <h3 className="ta-section-title">
            {t('tokenizedAssets.tabs.commodities.commodityProducts', 'Commodity Products')}
            {typeFilter && (
              <button
                type="button"
                className="ta-filter-chip"
                onClick={() => setTypeFilter(null)}
                title={t('tokenizedAssets.tabs.commodities.clearTypeFilter', 'Clear type filter')}
              >
                {typeFilter} ×
              </button>
            )}
          </h3>
          <span className="ta-section-count">{filteredProtocols.length}</span>
        </div>
        <MarketShareTable
          columns={LEAGUE_COLUMNS.filter((c) => (c.key === 'change_7d' || c.key === 'change_30d') ? leagueRows.some((r) => r[c.key] != null) : true)}
          rows={leagueRows}
          loading={loading}
          onRowClick={handleRowClick}
          virtualizeAfter={25}
          defaultSort={{ key: 'tvl', dir: 'desc' }}
        />
      </div>

      {/* 6. Vault Composition — rich per-metal breakdown.
            Header (with the gold-dominates note) + full-width stacked
            comparison bar + a distinct card per material type. Every
            sub-type (Silver / Oil / Platinum / Palladium / Unclassified)
            ALWAYS gets its own card, even at a fraction of a percent. */}
      <div className="ta-glass-card tac-vault">
        <div className="tac-vault__head">
          <div className="tac-vault__titles">
            <h3 className="tac-vault__title">{t('tokenizedAssets.tabs.commodities.vaultComposition', 'Vault Composition by Type')}</h3>
            <span className="tac-vault__hint">{t('tokenizedAssets.tabs.commodities.vaultClickHint', 'Click a metal to filter the products table above')}</span>
          </div>
          <div className="tac-vault__total">
            <span className="tac-vault__total-val mono">{formatValue(totalCommodityTvl)}</span>
            <span className="tac-vault__total-lbl">{t('tokenizedAssets.tabs.commodities.vaultTotalLabel', 'Total vault AUM')}</span>
          </div>
        </div>

        {/* Gold-dominates context note — always shown when a leader exists. */}
        {!loading && dominantMetal && dominantMetal.label === 'Gold' && dominantMetal.pct >= 50 && (
          <div className="tac-note" role="note">
            <span className="tac-note__dot" aria-hidden />
            <span className="tac-note__text">
              {t(
                'tokenizedAssets.tabs.commodities.goldDominatesNote',
                'Gold dominates the tokenized commodity market today',
              )}
              {' — '}
              <strong>
                <span className="mono">{dominantMetal.pct.toFixed(1)}%</span>
              </strong>
              {' '}
              {t(
                'tokenizedAssets.tabs.commodities.goldDominatesTail',
                'of vault AUM. Silver, platinum and oil are tracked here as distinct line items even while their tokenized supply stays small.',
              )}
            </span>
          </div>
        )}

        {loading ? (
          <>
            <div className="tac-skel-bar" />
            <div className="tac-skel-grid">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="tac-skel-card" />)}
            </div>
          </>
        ) : !stackSegments.length ? (
          <RwaEmptyState
            framed={false}
            title={t('tokenizedAssets.tabs.commodities.vaultEmptyTitle', 'No tokenized vault yet')}
            copy={t('tokenizedAssets.tabs.commodities.vaultEmptyCopy', 'No live commodity products are reporting AUM right now. Material-type breakdown will appear here as issuers come online.')}
          />
        ) : (
          <>
            {/* Full-width stacked comparison bar */}
            <div className="tac-bar-wrap">
              <div className="tac-bar" role="list" aria-label={t('tokenizedAssets.tabs.commodities.vaultComposition', 'Vault Composition by Type')}>
                {stackSegments.map((seg) => {
                  const active = typeFilter === seg.label
                  const labelText = seg.displayLabel || seg.label
                  const showLabel = seg.pending
                    ? labelText
                    : (seg.pct >= 8 ? `${labelText} · ${seg.pct.toFixed(0)}%` : labelText)
                  return (
                    <button
                      type="button"
                      key={seg.label}
                      role="listitem"
                      className={`tac-seg ta-tip-host${active ? ' is-active' : ''}${seg.pending ? ' tac-seg--pending' : ''}`}
                      style={{
                        flex: seg.flex,
                        background: seg.pending
                          ? undefined
                          : `linear-gradient(180deg, ${hexToRgba(seg.color, 1)} 0%, ${hexToRgba(seg.color, 0.78)} 100%)`,
                        opacity: typeFilter && !active ? 0.4 : 1,
                      }}
                      onClick={() => setTypeFilter(active ? null : seg.label)}
                      data-tip={
                        seg.pending
                          ? t('tokenizedAssets.tabs.commodities.pendingTitle', '{{label}} · pending — no live tokenized issuer yet', { label: seg.label })
                          : t('tokenizedAssets.tabs.commodities.liveTitle', '{{label}} · {{value}} · {{pct}}%', { label: seg.label, value: formatValue(seg.value), pct: seg.pct.toFixed(2) })
                      }
                    >
                      <span className="tac-seg__label">{showLabel}</span>
                    </button>
                  )
                })}
              </div>
              <div className="tac-bar-axis">
                <span>{t('tokenizedAssets.tabs.commodities.vaultBarHint', 'Share of tokenized vault — minimum width applied so small metals stay visible')}</span>
                <span className="mono">{metalCards.length} {t('tokenizedAssets.tabs.commodities.materials', 'materials')}</span>
              </div>
            </div>

            {/* Per-metal cards — one distinct card per sub-type */}
            <div className="tac-grid">
              {metalCards.map((m) => {
                const active = typeFilter === m.label
                const dim = Boolean(typeFilter) && !active
                const labelText = m.displayLabel || m.label
                return (
                  <button
                    type="button"
                    key={m.label}
                    className={`tac-metal${active ? ' is-active' : ''}${dim ? ' is-dim' : ''}${m.pending ? ' tac-metal--pending' : ''}`}
                    style={{ '--tac-accent': m.color }}
                    onClick={m.pending ? undefined : () => setTypeFilter(active ? null : m.label)}
                    aria-pressed={active}
                    title={
                      m.pending
                        ? t('tokenizedAssets.tabs.commodities.noLiveProduct', 'No live tokenized product yet — pending oracle')
                        : t('tokenizedAssets.tabs.commodities.liveTitle', '{{label}} · {{value}} · {{pct}}%', { label: m.label, value: formatValue(m.value), pct: m.pct.toFixed(2) })
                    }
                  >
                    <div className="tac-metal__top">
                      <span className="tac-metal__dot" aria-hidden />
                      <span className="tac-metal__name">{m.label}</span>
                      {m.leader && (
                        <span className="tac-metal__badge tac-metal__badge--lead">
                          {t('tokenizedAssets.tabs.commodities.leadBadge', 'Dominant')}
                        </span>
                      )}
                      {m.pending && (
                        <span className="tac-metal__badge tac-metal__badge--pending">
                          {t('tokenizedAssets.tabs.commodities.pending', 'pending')}
                        </span>
                      )}
                      {!m.pending && !m.leader && m.audit && (
                        <span className="tac-metal__badge tac-metal__badge--audit">
                          {t('tokenizedAssets.tabs.commodities.auditBadge', 'audit')}
                        </span>
                      )}
                    </div>

                    <div className="tac-metal__figures">
                      <span className="tac-metal__pct">{m.pending ? '—' : `${m.pct < 0.1 && m.pct > 0 ? m.pct.toFixed(2) : m.pct.toFixed(1)}%`}</span>
                      <span className="tac-metal__val">{m.pending ? t('tokenizedAssets.tabs.commodities.noLiveAum', 'no live AUM') : formatValue(m.value)}</span>
                    </div>

                    <div className="tac-metal__track" aria-hidden>
                      <div
                        className="tac-metal__track-fill"
                        style={{ width: m.pending ? '100%' : `${Math.max(m.pct, m.value > 0 ? 2 : 0)}%` }}
                      />
                    </div>

                    <div className="tac-metal__foot">
                      <span className="tac-metal__products">
                        <span className="mono">{m.products}</span>{' '}
                        {m.products === 1
                          ? t('tokenizedAssets.tabs.commodities.product', 'product')
                          : t('tokenizedAssets.tabs.commodities.products', 'products')}
                      </span>
                      {labelText !== m.label && (
                        <span className="tac-metal__state">{t('tokenizedAssets.tabs.commodities.auditPending', 'audit pending')}</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
