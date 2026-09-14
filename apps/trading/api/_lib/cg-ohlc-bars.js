/**
 * CoinGecko /ohlc(.range) → bars adapter — Tier 3.5 (charts-v2 Phase 1).
 *
 * Serves the census's class (b): CG-LISTED tokens with no chartable DEX pool
 * (CEX-only alts) — ~90% of the listed universe previously had ZERO intraday
 * path and fell through to an empty chart. Requires a paid CoinGecko key
 * (the /ohlc/range endpoints are paid-plan only; Lite = 500/min, 2M credits).
 *
 * Resolution support (CG limits, not ours):
 *   '30'                → /ohlc?days=2            (CG auto-granularity: 30m ≤2d)
 *   '60'                → /ohlc/range interval=hourly  (≤31d/call, paged ≤4)
 *   '240' / '720'       → hourly, aggregated client-side
 *   '1D' / 'D'          → /ohlc/range interval=daily   (≤180d/call, paged ≤6)
 *   '1W' / 'W' / '7D'   → daily, aggregated client-side
 *   '1' / '5' / '15'    → null (CG can't at this plan; chart offers ≥30m TFs)
 *
 * CG /ohlc carries NO volume. For DAILY (and weekly) bars we stitch volumes
 * from /market_chart/range total_volumes (24h-rolling sampled per point -
 * the right scale for a daily volume pane). Without this, any CG-served
 * stretch rendered an empty volume row - e.g. PALM 1D history before its GT
 * pool exists (Gleb 2026-06-12). Intraday stays v:0, honest: total_volumes
 * is a ROLLING 24h figure, so slicing it into hourly bars would fabricate.
 *
 * All failures return null so the bars cascade falls through to Codex.
 */

const CG_PRO_KEY = (process.env.COINGECKO_API_KEY || '').trim();
const CG_BASE = 'https://pro-api.coingecko.com/api/v3';

const DAY = 86_400;

async function cgJson(path) {
  const r = await fetch(`${CG_BASE}${path}`, {
    headers: { accept: 'application/json', 'x-cg-pro-api-key': CG_PRO_KEY },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  return r.json();
}

// CG OHLC rows: [ms, o, h, l, c] (no volume).
function toBar(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const t = Math.floor(row[0] / 1000);
  const o = +row[1]; const h = +row[2]; const l = +row[3]; const c = +row[4];
  if (!t || !Number.isFinite(o) || !Number.isFinite(c) || o <= 0 || c <= 0) return null;
  return { t, o, h, l, c, v: 0 };
}

function dedupeSortFilter(bars, fromSec, toSec) {
  const byT = new Map();
  for (const b of bars) if (b && b.t >= fromSec && b.t <= toSec) byT.set(b.t, b);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

// Group ASC bars into buckets of `groupSec` (o=first, h=max, l=min, c=last,
// v=sum so stitched daily volumes survive weekly aggregation).
function aggregate(bars, groupSec) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const bucket = Math.floor(b.t / groupSec) * groupSec;
    if (!cur || cur.t !== bucket) {
      if (cur) out.push(cur);
      cur = { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Drop tracked-pool/migration artifacts from CG history. CG sometimes follows
// a dying pool through a token migration: the price collapses >100x for a few
// days and snaps back the moment CG switches to the new pool (PALM Dec 19-27
// 2023: $0.094 -> $0.0004 for 9 days -> $0.125; both CG feeds carry it, so it
// can't be cross-checked away). Signature that real crashes don't have: a
// SHORT run displaced >8x from BOTH edges, with the pre/post price levels
// agreeing - a 200x round trip in days. Conservative: requires the full
// round-trip pattern, so genuine crashes (no recovery) and genuine pumps
// (level change persists) are untouched.
const ARTIFACT_JUMP = 8;        // x-fold close-to-close jump that opens/closes a run
const ARTIFACT_MAX_RUN = 21;    // bars - longer displacements are treated as real
const ARTIFACT_LEVEL_AGREE = 2.5; // pre/post level ratio that proves continuity
function dropMigrationArtifacts(bars, cgId) {
  if (!Array.isArray(bars) || bars.length < 12) return bars;
  const jumpAt = (a, b) => a > 0 && b > 0 && (a / b > ARTIFACT_JUMP || b / a > ARTIFACT_JUMP);
  const drop = new Set();
  for (let i = 1; i < bars.length; i++) {
    if (!jumpAt(bars[i - 1].c, bars[i].c)) continue;
    // run starts at i - find the opposite jump within MAX_RUN bars
    for (let j = i; j < Math.min(bars.length - 1, i + ARTIFACT_MAX_RUN); j++) {
      if (!jumpAt(bars[j].c, bars[j + 1].c)) continue;
      const pre = median(bars.slice(Math.max(0, i - 5), i).map((b) => b.c));
      const post = median(bars.slice(j + 1, j + 6).map((b) => b.c));
      if (!pre || !post) break;
      const levelRatio = Math.max(pre, post) / Math.min(pre, post);
      const runLevel = median(bars.slice(i, j + 1).map((b) => b.c));
      const displaced = runLevel > 0 && (Math.max(pre, runLevel) / Math.min(pre, runLevel)) > ARTIFACT_JUMP;
      if (levelRatio <= ARTIFACT_LEVEL_AGREE && displaced) {
        for (let k = i; k <= j; k++) drop.add(k);
        // The recovery bar often spans the artifact internally (opens at the
        // dead-pool level, closes at the real one) - drop it too in that case.
        const nb = bars[j + 1];
        if (nb && nb.o > 0 && nb.c > 0 && (nb.c / nb.o > ARTIFACT_JUMP || nb.o / nb.c > ARTIFACT_JUMP)) drop.add(j + 1);
        i = j + 1;
      }
      break;
    }
  }
  if (!drop.size) return bars;
  console.warn(`[cg-ohlc] ${cgId}: dropped ${drop.size} migration-artifact bars`);
  return bars.filter((_, idx) => !drop.has(idx));
}

// Daily volume map from /market_chart/range total_volumes ([[ms, usdVol]]).
// CG auto-granularity: daily points for spans >90d, hourly below - bucketing
// by day handles both (last point of the day wins = rolling-24h sampled at
// day end ≈ that day's volume). Returns Map<dayBucketSec, vol> or null.
async function fetchDailyVolumes(cgId, fromSec, toSec) {
  const j = await cgJson(
    `/coins/${encodeURIComponent(cgId)}/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}`,
  );
  const rows = j?.total_volumes;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const byDay = new Map();
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 2) continue;
    const t = Math.floor(r[0] / 1000 / DAY) * DAY;
    const v = +r[1];
    if (t > 0 && Number.isFinite(v) && v >= 0) byDay.set(t, v);
  }
  return byDay.size ? byDay : null;
}

// Page /ohlc/range backwards from toSec until fromSec, bounded by maxCalls.
async function fetchRange(cgId, interval, windowSec, fromSec, toSec, maxCalls) {
  const all = [];
  let to = toSec;
  for (let i = 0; i < maxCalls && to > fromSec; i++) {
    const from = Math.max(fromSec, to - windowSec);
    const j = await cgJson(
      `/coins/${encodeURIComponent(cgId)}/ohlc/range?vs_currency=usd&interval=${interval}&from=${from}&to=${to}`,
    );
    if (!Array.isArray(j) || j.length === 0) break;
    all.push(...j.map(toBar).filter(Boolean));
    const earliestMs = j[0]?.[0];
    if (!earliestMs || Math.floor(earliestMs / 1000) <= from + DAY) {
      if (from <= fromSec) break;
      to = from - 1;
    } else {
      break; // CG returned less history than requested — no point paging on
    }
  }
  return all;
}

/**
 * fetchCgOhlcBars(cgId, resolution, fromSec, toSec)
 * Returns [{t,o,h,l,c,v}] ASC or null. Never throws.
 */
export async function fetchCgOhlcBars(cgId, resolution, fromSec, toSec) {
  if (!CG_PRO_KEY || !cgId || fromSec == null || toSec == null || fromSec >= toSec) return null;
  const res = String(resolution);
  try {
    if (res === '1D' || res === 'D' || res === '1W' || res === 'W' || res === '7D') {
      const bars = await fetchRange(cgId, 'daily', 179 * DAY, fromSec, toSec, 6);
      let out = dropMigrationArtifacts(dedupeSortFilter(bars, fromSec, toSec), cgId);
      if (out.length) {
        // Stitch per-day volumes (CG /ohlc has none). Best-effort: a miss
        // leaves v:0 placeholders, never fails the bars.
        try {
          const vols = await fetchDailyVolumes(cgId, out[0].t, toSec);
          if (vols) {
            for (const b of out) {
              const v = vols.get(Math.floor(b.t / DAY) * DAY);
              if (v != null) b.v = v;
            }
          }
        } catch { /* volume stays 0 */ }
      }
      if (res === '1W' || res === 'W' || res === '7D') out = aggregate(out, 7 * DAY);
      return out.length ? out : null;
    }
    if (res === '60' || res === '240' || res === '720') {
      // Hourly range is capped at 31d per call; 4 pages ≈ 120 days of 1h.
      const cappedFrom = Math.max(fromSec, toSec - 120 * DAY);
      const bars = await fetchRange(cgId, 'hourly', 30 * DAY, cappedFrom, toSec, 4);
      let out = dropMigrationArtifacts(dedupeSortFilter(bars, cappedFrom, toSec), cgId);
      if (res === '240') out = aggregate(out, 4 * 3600);
      if (res === '720') out = aggregate(out, 12 * 3600);
      return out.length ? out : null;
    }
    if (res === '30') {
      // /ohlc auto-granularity serves 30m candles for days<=2.
      const j = await cgJson(`/coins/${encodeURIComponent(cgId)}/ohlc?vs_currency=usd&days=2`);
      if (!Array.isArray(j) || j.length === 0) return null;
      const out = dedupeSortFilter(j.map(toBar).filter(Boolean), fromSec, toSec);
      return out.length ? out : null;
    }
    return null; // 1m/5m/15m: not available for CEX-only listed alts on this plan
  } catch {
    return null;
  }
}
