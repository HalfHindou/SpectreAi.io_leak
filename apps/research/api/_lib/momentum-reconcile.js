/**
 * Momentum receipts reconciliation — serverless/prod mirror of
 * packages/server/lib/momentum-reconcile.js. TEMPORARY stopgap (2026-06-29).
 *
 * Alaa corrected ANSEM's momentum call to a $5.85M first-entry in the per-token
 * `momentum_entry`, but the momentum-RECEIPTS aggregate that Potential Gainers'
 * "Proof Timeline" reads wasn't backfilled. This injects the REAL call (live
 * ROI from DexScreener) so it surfaces in PG until the upstream catches up.
 * Remove CURATED_CALLS once /api/momentum/setups/receipts returns it natively.
 *
 * Uses global fetch (Node 18+ on Vercel). Never throws.
 */

const CURATED_CALLS = [
  {
    cg_id: 'the-black-bull',
    symbol: 'ANSEM',
    name: 'The Black Bull',
    image: 'https://coin-images.coingecko.com/coins/images/102174035/small/IMG_9497.jpeg?1782005339',
    contract: '9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump',
    signal_market_cap: 5847740,
    setup_rank: 2,
    entry_mentions: 189,
    first_seen_at: '2026-06-27T15:20:00.310448+00:00',
    fallback_current_market_cap: 106000000,
    // real callers from the upstream ledger — baked in because the true ANSEM
    // row sits at roi 0% (rank ~800), outside the top-400 window the tape fetches,
    // so the reconcile adds it fresh and would otherwise show no CALLERS.
    kols: [
      { screen_name: 'saracrypto_eth', name: 'sarah milady', avatar: 'https://pbs.twimg.com/profile_images/1797419043990700032/r9umtdCW_normal.jpg', followers: 249307 },
      { screen_name: 'fluffycrypt', name: 'Fluffy', avatar: 'https://pbs.twimg.com/profile_images/2034097401170903040/PfTjw4tq_normal.jpg', followers: 120400 },
      { screen_name: 'whalewatchalert', name: 'Whale Watch by Moby', avatar: 'https://pbs.twimg.com/profile_images/1897776430341083140/aY2MwRYH_normal.jpg', followers: 185000 },
    ],
  },
];

let _mcapCache = { ts: 0, map: {} };
const MCAP_TTL_MS = 90 * 1000;

// DexScreener full-supply marketCap (CoinGecko under-reports circulating supply
// for this token: ~$44M vs the chart's ~$110M). Cached 90s.
async function liveMcaps(calls) {
  if (Date.now() - _mcapCache.ts < MCAP_TTL_MS && Object.keys(_mcapCache.map).length) return _mcapCache.map;
  const map = {};
  await Promise.all(calls.filter((c) => c.contract).map(async (c) => {
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${c.contract}`, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) throw new Error(`ds ${r.status}`);
      const j = await r.json();
      // Highest-liquidity pair whose market cap is PLAUSIBLE. DexScreener
      // occasionally returns a broken marketCap/fdv (seen: $610B on a $5.85M
      // pump.fun token) that sailed straight through as a 10,000,000% ROI.
      // Clamp to a sane ceiling (20x the known scale, floor $5B) and skip bad
      // pairs; if none are plausible, leave it unset → fallback mcap is used.
      const ceiling = Math.max(5e9, (Number(c.fallback_current_market_cap) || 0) * 20);
      const pairs = (j.pairs || []).slice().sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0));
      let mc = 0;
      for (const p of pairs) {
        // prefer the larger PLAUSIBLE of marketCap / fdv — for full-supply
        // pump.fun tokens DexScreener's `marketCap` under-reports circulating
        // (~$41M), while `fdv` is the true full-supply chart figure (~$110M).
        // The ceiling rejects the glitched value.
        const cand = [Number(p.marketCap) || 0, Number(p.fdv) || 0].filter((v) => v > 0 && v < ceiling);
        if (cand.length) { mc = Math.max(...cand); break; }
      }
      if (mc > 0) map[c.cg_id] = mc;
    } catch (err) { /* fallback used */ }
  }));
  if (Object.keys(map).length) _mcapCache = { ts: Date.now(), map };
  return Object.keys(map).length ? map : _mcapCache.map;
}

function fmtMcap(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function buildReceipt(call, liveMcap, bucket) {
  const cur = Number(liveMcap) > 0 ? Number(liveMcap) : call.fallback_current_market_cap;
  const ret = call.signal_market_cap > 0 ? ((cur - call.signal_market_cap) / call.signal_market_cap) * 100 : 0;
  const dateStr = call.first_seen_at.slice(0, 10);
  return {
    model: 'first_ever',
    bucket,
    date: dateStr,
    first_seen_at: call.first_seen_at,
    cg_id: call.cg_id,
    token: { cg_id: call.cg_id, symbol: call.symbol, name: call.name, image_small: call.image, image_url: call.image },
    setup_rank: call.setup_rank,
    source_rank: call.setup_rank,
    setup_score: null,
    stage: 'aged',
    signal_market_cap: call.signal_market_cap,
    current_market_cap: cur,
    return_since_signal_pct: ret,
    returns_after_first_seen: {
      return_since_signal_pct: ret,
      peak_return_since_signal_pct: ret,
      human_return_pct: ret,
    },
    is_aged: true,
    proof_copy: `Surfaced in Potential Gainers Top ${call.setup_rank <= 10 ? 10 : 20} at ${fmtMcap(call.signal_market_cap)} on ${dateStr}`,
    metrics_used: {},
    identity: {},
    _reconciled: true,
  };
}

// X Dash track-record (BIGGEST CALLS + THE TAPE) — separate Hetzner pipeline
// that never got ANSEM. Inject it as a real call.
// Correct an existing upstream row (preserve image/kols/name, override the
// broken entry/ROI) or add a fresh one. The upstream backfilled ANSEM with the
// wrong $90.9M top-tick entry (ROI 0%, rank 326), so add-if-missing wasn't enough.
function applyCuratedToCall(original, call, liveMcap) {
  const last = Number(liveMcap) > 0 ? Number(liveMcap) : call.fallback_current_market_cap;
  const roi = call.signal_market_cap > 0 ? ((last - call.signal_market_cap) / call.signal_market_cap) * 100 : 0;
  const mult = call.signal_market_cap > 0 ? last / call.signal_market_cap : 1;
  const base = original || {};
  const imgLarge = (call.image || '').replace('/small/', '/large/');
  return {
    ...base,
    asset: call.cg_id, symbol: call.symbol, name: base.name || call.name,
    image: base.image || imgLarge || call.image, image_small: base.image_small || call.image,
    coingecko_id: call.cg_id,
    entry_market_cap: call.signal_market_cap, entry_date: call.first_seen_at,
    entry_rank: call.setup_rank, entry_mentions: base.entry_mentions || call.entry_mentions || 0,
    last_market_cap: last, last_seen_at: new Date().toISOString(),
    peak_market_cap: Math.max(last, Number(base.peak_market_cap) || 0),
    peak_at: base.peak_at || new Date().toISOString(),
    roi_pct: roi, peak_roi_pct: Math.max(roi, Number(base.peak_roi_pct) || 0),
    multiple: mult, peak_multiple: Math.max(mult, Number(base.peak_multiple) || 0),
    days_tracked: Math.max(1, Math.round((Date.now() - new Date(call.first_seen_at).getTime()) / 86400000)),
    // status must be one of the tones the tape/HoF understand (moon|up|down) so
    // the arc colours + the Up/Down/Moon filter work; 'runner' rendered as a grey
    // 'flat' tone. gave_back MUST be a boolean — a numeric 0 renders as a literal
    // "0" in the JSX `{gave_back && <…>}` (e.g. the "+2177%0" glyph).
    staying_power: Number(base.staying_power) || 60,
    status: mult >= 5 ? 'moon' : mult >= 1 ? 'up' : 'down', gave_back: false,
    dead: false, dead_kind: null, underwater: false, dca: Boolean(base.dca),
    kols: (Array.isArray(base.kols) && base.kols.length) ? base.kols : (Array.isArray(call.kols) ? call.kols : []), _reconciled: true,
  };
}

// The `summary` (2×/5×/10× hits, BEST, BEST PEAK, hit-rate, distribution) is
// computed server-side by the data-api in SQL over the RAW momentum_origin
// table — where ANSEM still sits at its wrong late $90.9M entry (~1× ROI). So
// injecting the corrected ANSEM into `calls`/`hall_of_fame` (above) without
// touching `summary` makes the ribbon CONTRADICT the Biggest Calls cards:
// "BEST 13.25× / 10× HITS 2 / BEST PEAK 25.23×" underneath a +3729% (38.29×)
// ANSEM card. Fold each corrected call's multiple into the summary so the
// aggregate matches the tape. Delta-based (we can't recompute the full ledger
// from the 400-row sample), never throws.
function reconcileSummary(summary, applied) {
  if (!summary || typeof summary !== 'object' || !Array.isArray(applied) || !applied.length) return summary;
  const s = { ...summary };
  const calls = Number(s.calls) || 0;
  let x2 = Number(s.x2) || 0;
  let x5 = Number(s.x5) || 0;
  let x10 = Number(s.x10) || 0;
  let up = Number(s.up) || 0;
  let best = Number(s.best_multiple) || 0;
  let bestPeak = Number(s.best_peak_multiple) || 0;
  // PEAK-based hit tiers (how many calls ever REACHED Nx). The curated call's
  // raw ledger row has a broken ~1× peak (late entry), so its corrected peak is
  // a genuinely new peak-hit the aggregate never counted.
  let px2 = Number(s.peak_x2) || 0;
  let px3 = Number(s.peak_x3) || 0;
  let px5 = Number(s.peak_x5) || 0;
  let px10 = Number(s.peak_x10) || 0;

  for (const a of applied) {
    const nm = Number(a.mult);
    const pm = Number(a.peakMult);
    const om = a.oldMult != null && Number.isFinite(Number(a.oldMult)) ? Number(a.oldMult) : null;
    // the call's OLD peak multiple (raw ledger), so we only count NEW peak tiers
    const opm = a.oldPeakMult != null && Number.isFinite(Number(a.oldPeakMult)) ? Number(a.oldPeakMult) : null;
    if (Number.isFinite(nm)) {
      best = Math.max(best, nm);
      // Count only the tiers the corrected multiple NEWLY clears. When the old
      // mult is known (the call was in the sample) don't re-count a tier it
      // already cleared. When it's unknown (call sat outside the fetched
      // window) the curated stopgap is correcting a late/inflated entry, so the
      // old recorded mult was sub-2× — every cleared tier is genuinely new.
      const crossed = (thr) => nm >= thr && !(om != null && om >= thr);
      if (crossed(2)) x2 += 1;
      if (crossed(5)) x5 += 1;
      if (crossed(10)) x10 += 1;
      // Only move the hit-rate when we KNOW the row flipped loser→winner.
      // On the add-path (om unknown) the full-ledger summary already tallies
      // this asset's raw ~1× row as a winner — bumping `up` would double-count.
      if (om != null && om < 1 && nm >= 1) up += 1;
    }
    if (Number.isFinite(pm)) {
      bestPeak = Math.max(bestPeak, pm);
      const peakCrossed = (thr) => pm >= thr && !(opm != null && opm >= thr);
      if (peakCrossed(2)) px2 += 1;
      if (peakCrossed(3)) px3 += 1;
      if (peakCrossed(5)) px5 += 1;
      if (peakCrossed(10)) px10 += 1;
    }
  }

  s.x2 = x2;
  s.x5 = x5;
  s.x10 = x10;
  s.peak_x2 = px2;
  s.peak_x3 = px3;
  s.peak_x5 = px5;
  s.peak_x10 = px10;
  s.up = up;
  s.best_multiple = Math.round(best * 100) / 100;
  s.best_peak_multiple = Math.round(bestPeak * 100) / 100;
  if (calls > 0) s.hit_rate = Math.round((up / calls) * 1000) / 10;

  // Keep the distribution band's tier chips (2–5×, 5×+) + moonshot tail bar
  // consistent with the bumped ribbon counts so the two don't disagree.
  if (s.distribution && typeof s.distribution === 'object') {
    const d = { ...s.distribution };
    d.below = Math.max(0, calls - up);
    d.flat = Math.max(0, up - x2);
    d.mid = Math.max(0, x2 - x5);
    d.high = x5;
    if (Array.isArray(d.bins) && d.bins.length) {
      const bins = d.bins.slice();
      const top = bins.length - 1; // +700% cap bucket — where a moonshot lands
      for (const a of applied) { if (Number(a.mult) >= 1) bins[top] = (Number(bins[top]) || 0) + 1; }
      d.bins = bins;
    }
    s.distribution = d;
  }
  return s;
}

export async function reconcileTrackRecord(payload) {
  try {
    const data = payload && payload.data;
    if (!data || !Array.isArray(data.calls)) return payload;
    const map = await liveMcaps(CURATED_CALLS);
    const byCg = new Map(CURATED_CALLS.map((c) => [c.cg_id.toLowerCase(), c]));
    let changed = 0;
    const applied = []; // per-curated-call deltas for the summary reconcile
    const track = (orig, curated) => {
      const e = orig && Number(orig.entry_market_cap) > 0 ? Number(orig.entry_market_cap) : null;
      const om = e && orig.last_market_cap != null ? Number(orig.last_market_cap) / e : null;
      const opm = e && orig.peak_market_cap != null ? Number(orig.peak_market_cap) / e : null;
      applied.push({
        mult: Number(curated.multiple), peakMult: Number(curated.peak_multiple),
        oldMult: om, oldPeakMult: opm,
      });
      return curated;
    };
    let calls = data.calls.map((c) => {
      const cg = String((c && (c.coingecko_id || c.asset)) || '').toLowerCase();
      const cur = byCg.get(cg);
      if (!cur) return c;
      byCg.delete(cg);
      changed += 1;
      return track(c, applyCuratedToCall(c, cur, map[cur.cg_id]));
    });
    for (const cur of byCg.values()) {
      calls.push(track(null, applyCuratedToCall(null, cur, map[cur.cg_id])));
      changed += 1;
    }
    if (!changed) return payload;
    calls = calls
      .sort((a, b) => (Number(b.roi_pct) || -Infinity) - (Number(a.roi_pct) || -Infinity))
      .map((c, i) => ({ ...c, rank: i + 1 }));
    const hof = calls.slice(0, 3).map((c, i) => ({ ...c, rank: i + 1 }));
    const summary = reconcileSummary(data.summary, applied);
    // the signal-lane block is summary-shaped and the curated calls all clear
    // the signal gate (ANSEM: 189 entry mentions, rank 2) — mirror the deltas
    // so BEST/HIT tiers agree across the population toggle.
    if (summary && data.summary && data.summary.signals) {
      summary.signals = reconcileSummary(data.summary.signals, applied);
    }
    return { ...payload, data: { ...data, summary, calls, hall_of_fame: hof, count: calls.length, _reconciled: changed } };
  } catch (err) {
    console.warn('[track-record-reconcile] failed:', err.message);
    return payload;
  }
}

export async function reconcileReceipts(data, opts = {}) {
  try {
    if (!data || typeof data !== 'object') return data;
    const bucket = opts.bucket === 'top20' ? 'top20' : 'top10';
    const list = Array.isArray(data.receipts) ? data.receipts : [];
    const have = new Set(
      list.map((r) => String((r && r.token && r.token.cg_id) || (r && r.cg_id) || '').toLowerCase()).filter(Boolean),
    );
    const missing = CURATED_CALLS.filter((c) => !have.has(c.cg_id.toLowerCase()));
    if (!missing.length) return data;
    const map = await liveMcaps(CURATED_CALLS);
    const add = missing.map((c) => buildReceipt(c, map[c.cg_id], bucket));
    const merged = [...list, ...add].sort((a, b) => {
      const ra = Number(a && a.returns_after_first_seen && a.returns_after_first_seen.human_return_pct);
      const rb = Number(b && b.returns_after_first_seen && b.returns_after_first_seen.human_return_pct);
      return (Number.isFinite(rb) ? rb : -Infinity) - (Number.isFinite(ra) ? ra : -Infinity);
    });
    return { ...data, receipts: merged, count: merged.length, _reconciled: add.length };
  } catch (err) {
    console.warn('[momentum-reconcile] failed:', err.message);
    return data;
  }
}

// Known bad-data tokens: the upstream collector froze a wrong CONSTANT market
// cap for them, so they surface as phantom "fresh" Potential Gainers signals
// with a garbage entry (e.g. ANSEM / the-black-bull stuck at $90.9M — its real
// $5.85M call is represented via CURATED_CALLS in the reconciled receipts). Strip
// them from the live signal board so they don't dupe + mislead. Remove an asset
// here once the upstream mcap is fixed.
const GLITCHED_ASSETS = new Set(['the-black-bull']);

export function stripGlitchedSignals(data) {
  try {
    if (!data || !Array.isArray(data.tokens)) return data;
    const kept = data.tokens.filter((r) => {
      const cg = String((r && r.token && (r.token.cg_id || r.token.symbol)) || '').toLowerCase();
      return !GLITCHED_ASSETS.has(cg);
    });
    if (kept.length === data.tokens.length) return data;
    return { ...data, tokens: kept, count: kept.length };
  } catch (_e) {
    return data;
  }
}

// Re-base Potential Gainers "Biggest Calls" to the TRUE first-social-catch entry
// (momentum_origin, via the track-record) instead of PG's later "clean setup"
// flag. A runner Spectre spotted at $1.17M that ran to $21M is a +1,716% call —
// but PG flagged it at $9.5M and read +46%. This shows the honest, real magnitude
// of the run from where we ACTUALLY first caught it, and injects the top runners
// PG's late/selective flag missed entirely, so the main runners are always in.
// `tr` = the (raw) /v1/social/track-record?sort=peak payload { data: { calls } }.
// the-black-bull is excluded (its raw origin is the $90.9M glitch) — it stays as
// its curated receipt from reconcileReceipts.
export function rebaseReceiptsToOrigin(data, tr) {
  try {
    const calls = tr && tr.data && Array.isArray(tr.data.calls) ? tr.data.calls : null;
    if (!data || !Array.isArray(data.receipts) || !calls || !calls.length) return data;
    const origin = new Map();
    for (const c of calls) {
      const cg = String(c.coingecko_id || c.asset || '').toLowerCase();
      if (!cg || GLITCHED_ASSETS.has(cg)) continue;
      if (!(Number(c.entry_market_cap) > 0)) continue;
      origin.set(cg, c);
    }
    const cgOf = (r) => String((r && (r.cg_id || (r.token && r.token.cg_id))) || '').toLowerCase();
    const rafOf = (o) => ({
      return_since_signal_pct: Number(o.roi_pct),
      peak_return_since_signal_pct: Number(o.peak_roi_pct),
      human_return_pct: Number(o.roi_pct),
    });
    // 1. re-base existing receipts to their true origin entry + peak
    const rebased = data.receipts.map((r) => {
      const o = origin.get(cgOf(r));
      if (!o) return r;
      return {
        ...r,
        signal_market_cap: Number(o.entry_market_cap),
        current_market_cap: Number(o.last_market_cap),
        first_seen_at: o.entry_date || r.first_seen_at,
        return_since_signal_pct: Number(o.roi_pct),
        returns_after_first_seen: { ...(r.returns_after_first_seen || {}), ...rafOf(o) },
        token: {
          ...(r.token || {}), cg_id: cgOf(r),
          symbol: (r.token && r.token.symbol) || o.symbol,
          name: (r.token && r.token.name) || o.name,
          image_small: (r.token && r.token.image_small) || o.image_small || o.image,
          image_url: (r.token && r.token.image_url) || o.image || o.image_small,
        },
        _origin_rebased: true,
      };
    });
    // 2. inject the top runners PG never flagged (real runners, >=2x at peak)
    const have = new Set(rebased.map(cgOf));
    const additions = [];
    for (const c of calls) {
      const cg = String(c.coingecko_id || c.asset || '').toLowerCase();
      if (!cg || have.has(cg) || GLITCHED_ASSETS.has(cg)) continue;
      if (!(Number(c.entry_market_cap) > 0) || !(Number(c.peak_roi_pct) >= 100)) continue;
      have.add(cg);
      additions.push({
        cg_id: cg,
        token: { cg_id: cg, symbol: c.symbol, name: c.name || c.symbol, image_small: c.image_small || c.image, image_url: c.image || c.image_small },
        signal_market_cap: Number(c.entry_market_cap),
        current_market_cap: Number(c.last_market_cap),
        first_seen_at: c.entry_date || null,
        return_since_signal_pct: Number(c.roi_pct),
        returns_after_first_seen: rafOf(c),
        model: 'first_ever', stage: 'aged', is_aged: true, _origin_added: true,
      });
    }
    const peakOf = (r) => {
      const raf = r && r.returns_after_first_seen;
      const p = raf ? Number(raf.peak_return_since_signal_pct) : NaN;
      const n = raf ? Number(raf.return_since_signal_pct) : NaN;
      return Math.max(Number.isFinite(p) ? p : -Infinity, Number.isFinite(n) ? n : -Infinity);
    };
    const merged = [...rebased, ...additions].sort((a, b) => peakOf(b) - peakOf(a));
    return { ...data, receipts: merged, count: merged.length };
  } catch (e) {
    console.warn('[rebase-receipts] failed:', e.message);
    return data;
  }
}
