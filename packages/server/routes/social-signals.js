/**
 * Social Signals backend pipeline (D1-D6 of SOCIAL_INTELLIGENCE_SPEC.md).
 *
 * One in-process scheduler polls X-Dash bootstrap every 90s, maintains rolling
 * in-memory state (author-token history, co-mention edges, recent signals),
 * and serves six endpoints under /api/social-signals/*.
 *
 * Mounted via:  require('./routes/social-signals.js')(app)  in index.js
 */

const X_DASH_BASE = (
  process.env.DASHBOARD_API_BASE_URL ||
  process.env.X_DASH_BASE ||
  process.env.X_DASH_API_BASE ||
  'http://5.78.199.87:8092'
).replace(/\/+$/, '');

// XDASH_API_TOKEN first - the upstream rotated its key (old values 401).
const X_DASH_KEY =
  process.env.XDASH_API_TOKEN ||
  process.env.X_DASH_API_KEY ||
  process.env.DASHBOARD_API_KEY ||
  '';

// ── Tunables ────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 90 * 1000;
const ENDPOINT_CACHE_MS = 60 * 1000;
const SIGNAL_RING_SIZE = 200;
const AUTHOR_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const COMENTION_TTL_MS = 24 * 60 * 60 * 1000;          // 24 hours
const TICK_HISTORY_MAX = 32;                            // ~48 minutes of ticks
const KOL_FOLLOWER_THRESHOLD = 100_000;
const FIRST_MENTION_FOLLOWER_THRESHOLD = 50_000;
const WHALE_ALIGNMENT_MIN_KOLS = 3;
const VELOCITY_BREAKOUT_Z = 2.0;
const COHORT_EDGE_MIN_WEIGHT = 2;
const BOOTSTRAP_PAGES = 3;          // 200 * 3 = top 600 tokens per tick
const BOOTSTRAP_PER_PAGE = 200;

// ── State ───────────────────────────────────────────────────────────────────
const cache = new Map(); // endpoint cache
const recentSignals = []; // ring buffer of fired signals (most-recent-first push)
const authorTokenHistory = new Map(); // key: `${authorId||screen}:${asset}` -> {firstSeen, lastSeen, mentions}
const tokenAuthorsByTick = new Map(); // asset -> Set<authorKey> for previous tick (first-mention diff)
const coMentionEdges = new Map();     // key: `A|B` (alphabetical) -> {weight, lastSeen, assetA, assetB}
const tokenMetricHistory = new Map(); // asset -> [{ts, velocity, mentions, sentiment, mentions24h}]
const tokenMeta = new Map();          // asset -> { image, name, cgId }
let lastTick = { ts: 0, ok: false, error: null, tokensSeen: 0 };
const SCHEDULER_START = Date.now();
// New-voice signals require enough scheduler history to know "new" actually means
// new — without a baseline every author looks new on cold start. We need at least
// 6 hours of authorTokenHistory accumulating before this signal is meaningful.
const NEW_VOICE_WARMUP_MS = 6 * 60 * 60 * 1000;
function isWarm() { return Date.now() - SCHEDULER_START > NEW_VOICE_WARMUP_MS; }

// ── Helpers ─────────────────────────────────────────────────────────────────
function getCached(map, key, ttlMs) {
  const e = map.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) { map.delete(key); return null; }
  return e.data;
}
function setCached(map, key, data, ttlMs) {
  if (map.size >= 200) {
    const k = map.keys().next().value;
    if (k != null) map.delete(k);
  }
  map.set(key, { data, expires: Date.now() + ttlMs });
}

function pushSignal(sig) {
  sig.id = sig.id || `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  sig.ts = sig.ts || new Date().toISOString();
  recentSignals.unshift(sig);
  if (recentSignals.length > SIGNAL_RING_SIZE) recentSignals.length = SIGNAL_RING_SIZE;
}

function authorKey(a) {
  return a.author_rest_id || a.user_id || a.screen_name || a.handle || a.name || 'unknown';
}
function authorFollowers(a) {
  return a.followers_count || a.follower_count || a.followers || 0;
}
function authorHandle(a) {
  return a.screen_name || a.handle || a.name || 'unknown';
}

function zScore(value, series) {
  if (!series.length) return 0;
  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length;
  const std = Math.sqrt(variance);
  if (std < 1e-6) return 0;
  return (value - mean) / std;
}

function gradeSeverity(score) {
  if (score >= 80) return 'S';
  if (score >= 65) return 'A';
  if (score >= 45) return 'B';
  return 'C';
}

async function fetchBootstrapPage(page) {
  const url = `${X_DASH_BASE}/api/bootstrap?per_page=${BOOTSTRAP_PER_PAGE}&page=${page}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${X_DASH_KEY}`,
      'x-api-key': X_DASH_KEY,
      'X-Internal-Key': X_DASH_KEY,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`X-Dash bootstrap p${page} returned ${res.status}`);
  return res.json();
}

// ── Scheduler tick ──────────────────────────────────────────────────────────
async function tick() {
  try {
    const pages = await Promise.allSettled(
      Array.from({ length: BOOTSTRAP_PAGES }, (_, i) => fetchBootstrapPage(i + 1))
    );
    const items = [];
    for (const p of pages) {
      if (p.status !== 'fulfilled') continue;
      const data = p.value;
      if (Array.isArray(data.featured_majors)) items.push(...data.featured_majors);
      if (Array.isArray(data.tokens)) items.push(...data.tokens);
    }
    if (!items.length) {
      lastTick = { ts: Date.now(), ok: false, error: 'no_items', tokensSeen: 0 };
      return;
    }

    const now = Date.now();
    const newAuthorsByToken = new Map(); // asset -> [author]
    const sessionTokensInTick = new Set();

    for (const entry of items) {
      const tok = entry.token || {};
      const asset = tok.symbol || tok.cg_id;
      if (!asset) continue;
      sessionTokensInTick.add(asset);

      tokenMeta.set(asset, {
        symbol: tok.symbol || asset,
        cgId: tok.cg_id || null,
        name: tok.name || asset,
        image: tok.image_small || tok.image_url || tok.image_large || null,
        marketCap: tok.market_cap || 0,
        category: tok.primary_category || (Array.isArray(tok.tags) && tok.tags[0]) || null,
      });

      const m = entry.metrics || {};
      const q = entry.quality || {};
      const authors = Array.isArray(entry.top_authors) ? entry.top_authors : [];

      // Append metric history (cap)
      const hist = tokenMetricHistory.get(asset) || [];
      hist.push({
        ts: now,
        velocity: m.velocity_ratio || 0,
        mentions: m.total_mentions || 0,
        mentions24h: m.mentions_24h || 0,
        novelty: m.novelty_ratio || 0,
        cleanSignal: m.clean_signal_score || 0,
        externalAuthors: m.unique_external_authors_24h || m.unique_external_authors || 0,
        spam: q.spam_score || 0,
      });
      if (hist.length > TICK_HISTORY_MAX) hist.shift();
      tokenMetricHistory.set(asset, hist);

      // Author rolling history + first-mention detection
      const prevAuthors = tokenAuthorsByTick.get(asset) || new Set();
      const currAuthors = new Set();
      const newKolsThisTick = [];
      for (const a of authors) {
        const k = authorKey(a);
        currAuthors.add(k);
        const histKey = `${k}:${asset}`;
        const prior = authorTokenHistory.get(histKey);
        const followers = authorFollowers(a);
        if (!prior) {
          authorTokenHistory.set(histKey, {
            firstSeen: now,
            lastSeen: now,
            mentions: a.mention_count || 1,
            handle: authorHandle(a),
            followers,
            avatar: a.avatar_image_url || null,
          });
          if (!prevAuthors.has(k) && followers >= FIRST_MENTION_FOLLOWER_THRESHOLD) {
            newKolsThisTick.push({ ...a, _firstSeen: true });
          }
        } else {
          prior.lastSeen = now;
          prior.mentions = Math.max(prior.mentions, a.mention_count || prior.mentions);
          if (followers > prior.followers) prior.followers = followers;
        }
      }
      tokenAuthorsByTick.set(asset, currAuthors);
      if (newKolsThisTick.length) newAuthorsByToken.set(asset, newKolsThisTick);

      // Co-mention edges: authors common to multiple tokens form weighted edges
      // We accumulate later in a second pass keyed by author.
    }

    // Co-mention edges built from authors writing about multiple tokens this tick
    const authorToTokens = new Map();
    for (const entry of items) {
      const asset = entry.token?.symbol || entry.token?.cg_id;
      if (!asset) continue;
      const authors = Array.isArray(entry.top_authors) ? entry.top_authors : [];
      for (const a of authors) {
        const k = authorKey(a);
        if (!authorToTokens.has(k)) authorToTokens.set(k, new Set());
        authorToTokens.get(k).add(asset);
      }
    }
    for (const tokens of authorToTokens.values()) {
      const arr = Array.from(tokens);
      if (arr.length < 2) continue;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const [a, b] = [arr[i], arr[j]].sort();
          const key = `${a}|${b}`;
          const prev = coMentionEdges.get(key);
          if (prev) {
            prev.weight += 1;
            prev.lastSeen = now;
          } else {
            coMentionEdges.set(key, { weight: 1, lastSeen: now, assetA: a, assetB: b });
          }
        }
      }
    }

    // ── FIRE SIGNALS ──
    for (const entry of items) {
      const tok = entry.token || {};
      const asset = tok.symbol || tok.cg_id;
      if (!asset) continue;
      const meta = tokenMeta.get(asset);
      const authors = Array.isArray(entry.top_authors) ? entry.top_authors : [];
      const m = entry.metrics || {};
      const hist = tokenMetricHistory.get(asset) || [];

      // 1. WHALE-ALIGNMENT: ≥N authors with >100k followers in window
      const kols = authors.filter((a) => authorFollowers(a) >= KOL_FOLLOWER_THRESHOLD);
      const kolKeySet = new Set(kols.map(authorKey));
      if (kolKeySet.size >= WHALE_ALIGNMENT_MIN_KOLS) {
        const combinedFollowers = kols.reduce((s, a) => s + authorFollowers(a), 0);
        const score = Math.min(100, 50 + kolKeySet.size * 7 + Math.log10(combinedFollowers + 1) * 4);
        // Avoid spamming same signal — only fire if not in recent window
        const dupe = recentSignals.find(
          (s) => s.type === 'whale-alignment' && s.asset === asset && Date.now() - new Date(s.ts).getTime() < 30 * 60 * 1000
        );
        if (!dupe) {
          pushSignal({
            type: 'whale-alignment',
            asset,
            asset_image: meta?.image || null,
            severity: gradeSeverity(score),
            summary: `${kolKeySet.size} KOLs aligned (${Math.round(combinedFollowers / 1000)}K combined followers)`,
            evidence: {
              authors: kols.slice(0, 6).map((a) => ({
                handle: authorHandle(a),
                followers: authorFollowers(a),
                avatar: a.avatar_image_url || null,
              })),
              tweet_ids: [],
              metric_delta: { combined_followers: combinedFollowers, kol_count: kolKeySet.size },
            },
            lead_time_hint: '0-4h',
          });
        }
      }

      // 2. NEW-VOICE: high-follower author appearing in this token's mention list
      // for the first time in our 7-day tracking window. Suppressed during the
      // 6-hour warmup window because every author looks new on cold start.
      const newKols = newAuthorsByToken.get(asset) || [];
      const significantNew = newKols.filter((a) => authorFollowers(a) >= FIRST_MENTION_FOLLOWER_THRESHOLD);
      if (significantNew.length && isWarm()) {
        const top = significantNew.sort((a, b) => authorFollowers(b) - authorFollowers(a))[0];
        const followers = authorFollowers(top);
        const score = Math.min(100, 40 + Math.log10(followers + 1) * 8);
        pushSignal({
          type: 'new-voice',
          asset,
          asset_image: meta?.image || null,
          severity: gradeSeverity(score),
          summary: `@${authorHandle(top)} new voice on $${asset} in 7d window (${Math.round(followers / 1000)}K followers)`,
          evidence: {
            authors: significantNew.slice(0, 3).map((a) => ({
              handle: authorHandle(a),
              followers: authorFollowers(a),
              avatar: a.avatar_image_url || null,
            })),
            tweet_ids: [],
            metric_delta: { new_authors: significantNew.length, top_followers: followers },
          },
          lead_time_hint: '0-2h',
        });
      }

      // 3. VELOCITY-BREAKOUT: z-score of velocity_ratio against own history
      if (hist.length >= 6) {
        const series = hist.slice(0, -1).map((h) => h.velocity);
        const z = zScore(m.velocity_ratio || 0, series);
        if (z >= VELOCITY_BREAKOUT_Z && (m.velocity_ratio || 0) > 1.0) {
          const dupe = recentSignals.find(
            (s) => s.type === 'velocity-breakout' && s.asset === asset && Date.now() - new Date(s.ts).getTime() < 15 * 60 * 1000
          );
          if (!dupe) {
            const score = Math.min(100, 50 + z * 8);
            pushSignal({
              type: 'velocity-breakout',
              asset,
              asset_image: meta?.image || null,
              severity: gradeSeverity(score),
              summary: `velocity ${(m.velocity_ratio || 0).toFixed(2)}x (z=${z.toFixed(1)})`,
              evidence: {
                authors: [],
                tweet_ids: [],
                metric_delta: { velocity_ratio: m.velocity_ratio, z_score: z },
              },
              lead_time_hint: '0-2h',
            });
          }
        }
      }

      // 4. HANDOFF: mentions drop >40% AND clean_signal_score declining
      if (hist.length >= 4) {
        const recent = hist.slice(-2);
        const prior = hist.slice(0, -2);
        if (recent.length === 2 && prior.length >= 2) {
          const recentMentions = recent.reduce((s, h) => s + h.mentions24h, 0) / recent.length;
          const priorMentions = prior.reduce((s, h) => s + h.mentions24h, 0) / prior.length;
          const drop = priorMentions > 0 ? (priorMentions - recentMentions) / priorMentions : 0;
          const recentClean = recent.reduce((s, h) => s + h.cleanSignal, 0) / recent.length;
          const priorClean = prior.reduce((s, h) => s + h.cleanSignal, 0) / prior.length;
          if (drop > 0.4 && recentClean < priorClean - 0.1 && priorMentions > 50) {
            const dupe = recentSignals.find(
              (s) => s.type === 'handoff' && s.asset === asset && Date.now() - new Date(s.ts).getTime() < 60 * 60 * 1000
            );
            if (!dupe) {
              const score = Math.min(100, 40 + drop * 60);
              pushSignal({
                type: 'handoff',
                asset,
                asset_image: meta?.image || null,
                severity: gradeSeverity(score),
                summary: `mentions -${Math.round(drop * 100)}%, signal ${priorClean.toFixed(2)}→${recentClean.toFixed(2)}`,
                evidence: {
                  authors: [],
                  tweet_ids: [],
                  metric_delta: { mention_drop: drop, clean_delta: recentClean - priorClean },
                },
                lead_time_hint: 'exit window',
              });
            }
          }
        }
      }
    }

    // GC stale state
    for (const [k, v] of authorTokenHistory) {
      if (now - v.lastSeen > AUTHOR_HISTORY_TTL_MS) authorTokenHistory.delete(k);
    }
    for (const [k, v] of coMentionEdges) {
      if (now - v.lastSeen > COMENTION_TTL_MS) coMentionEdges.delete(k);
    }

    lastTick = { ts: now, ok: true, error: null, tokensSeen: items.length };
  } catch (err) {
    lastTick = { ts: Date.now(), ok: false, error: err.message || String(err), tokensSeen: 0 };
    console.error('[social-signals] tick failed:', err.message);
  }
}

// ── Endpoint computations ───────────────────────────────────────────────────
function computeFrontrunScore(asset) {
  const hist = tokenMetricHistory.get(asset);
  if (!hist || hist.length === 0) {
    return { score: 0, factors: {}, missing: true };
  }
  const last = hist[hist.length - 1];
  const series = hist.slice(0, -1).map((h) => h.velocity);
  const velocityZ = zScore(last.velocity, series);

  // Author follower aggregate from current top_authors recorded in history map
  let kolAvgFollowers = 0;
  let kolCount = 0;
  for (const [k, v] of authorTokenHistory) {
    if (k.endsWith(`:${asset}`) && v.followers >= KOL_FOLLOWER_THRESHOLD) {
      kolAvgFollowers += v.followers;
      kolCount += 1;
    }
  }
  if (kolCount) kolAvgFollowers /= kolCount;

  // Co-mention growth: edges touching this asset
  let comentionWeight = 0;
  for (const [, edge] of coMentionEdges) {
    if (edge.assetA === asset || edge.assetB === asset) comentionWeight += edge.weight;
  }

  const factors = {
    velocity_z: { value: Number(velocityZ.toFixed(2)), weight: 0.30 },
    clean_signal: { value: Number((last.cleanSignal || 0).toFixed(3)), weight: 0.20 },
    kol_count: { value: kolCount, weight: 0.20 },
    kol_avg_followers: { value: Math.round(kolAvgFollowers), weight: 0.10 },
    comention_weight: { value: comentionWeight, weight: 0.10 },
    novelty: { value: Number((last.novelty || 0).toFixed(2)), weight: 0.10 },
  };

  // Normalize each contributor to 0-100 then weighted blend
  const normalized = {
    velocity_z: Math.max(0, Math.min(100, 50 + velocityZ * 15)),
    clean_signal: Math.max(0, Math.min(100, (last.cleanSignal || 0) * 100)),
    kol_count: Math.min(100, kolCount * 12),
    kol_avg_followers: Math.min(100, Math.log10(kolAvgFollowers + 1) * 14),
    comention_weight: Math.min(100, comentionWeight * 4),
    novelty: Math.min(100, (last.novelty || 0) * 50),
  };
  let score = 0;
  for (const k of Object.keys(factors)) {
    score += normalized[k] * factors[k].weight;
  }
  return { score: Math.round(score), factors, normalized, missing: false };
}

function computeWhaleAlignment() {
  // For each token, count distinct KOL authors with last_seen within 4h
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  const byAsset = new Map(); // asset -> [{handle, followers, lastSeen, avatar}]
  for (const [k, v] of authorTokenHistory) {
    if (v.lastSeen < cutoff) continue;
    if (v.followers < KOL_FOLLOWER_THRESHOLD) continue;
    const idx = k.lastIndexOf(':');
    const asset = k.slice(idx + 1);
    if (!byAsset.has(asset)) byAsset.set(asset, []);
    byAsset.get(asset).push({
      handle: v.handle,
      followers: v.followers,
      lastSeen: new Date(v.lastSeen).toISOString(),
      avatar: v.avatar,
    });
  }
  const out = [];
  for (const [asset, authors] of byAsset) {
    if (authors.length < WHALE_ALIGNMENT_MIN_KOLS) continue;
    authors.sort((a, b) => b.followers - a.followers);
    const combinedReach = authors.reduce((s, a) => s + a.followers, 0);
    const timestamps = authors.map((a) => new Date(a.lastSeen).getTime());
    const timeSpreadMin = Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 60000);
    const meta = tokenMeta.get(asset);
    out.push({
      asset,
      asset_image: meta?.image || null,
      asset_name: meta?.name || asset,
      kol_count: authors.length,
      combined_reach: combinedReach,
      time_spread_minutes: timeSpreadMin,
      authors: authors.slice(0, 8),
    });
  }
  out.sort((a, b) => b.combined_reach - a.combined_reach);
  return out;
}

function computeHandoff() {
  const out = [];
  for (const [asset, hist] of tokenMetricHistory) {
    if (hist.length < 4) continue;
    const recent = hist.slice(-2);
    const prior = hist.slice(0, -2);
    const recentMentions = recent.reduce((s, h) => s + h.mentions24h, 0) / recent.length;
    const priorMentions = prior.reduce((s, h) => s + h.mentions24h, 0) / prior.length;
    if (priorMentions < 30) continue;
    const drop = (priorMentions - recentMentions) / priorMentions;
    if (drop < 0.25) continue;
    const recentClean = recent.reduce((s, h) => s + h.cleanSignal, 0) / recent.length;
    const priorClean = prior.reduce((s, h) => s + h.cleanSignal, 0) / prior.length;
    const meta = tokenMeta.get(asset);
    out.push({
      asset,
      asset_name: meta?.name || asset,
      asset_image: meta?.image || null,
      mention_drop_pct: Math.round(drop * 100),
      clean_signal_delta: Number((recentClean - priorClean).toFixed(3)),
      prior_mentions: Math.round(priorMentions),
      recent_mentions: Math.round(recentMentions),
      severity: drop > 0.5 && recentClean < priorClean ? 'high' : 'moderate',
    });
  }
  out.sort((a, b) => b.mention_drop_pct - a.mention_drop_pct);
  return out.slice(0, 30);
}

function computeNarrativeCohorts() {
  // Greedy clustering: seed with heaviest edge, absorb adjacent assets above threshold.
  const edges = Array.from(coMentionEdges.values())
    .filter((e) => e.weight >= COHORT_EDGE_MIN_WEIGHT)
    .sort((a, b) => b.weight - a.weight);

  const assetToCluster = new Map();
  const clusters = [];
  for (const e of edges) {
    const ca = assetToCluster.get(e.assetA);
    const cb = assetToCluster.get(e.assetB);
    if (ca == null && cb == null) {
      const cluster = { id: clusters.length, assets: new Set([e.assetA, e.assetB]), weight: e.weight };
      clusters.push(cluster);
      assetToCluster.set(e.assetA, cluster);
      assetToCluster.set(e.assetB, cluster);
    } else if (ca && !cb) {
      ca.assets.add(e.assetB);
      ca.weight += e.weight;
      assetToCluster.set(e.assetB, ca);
    } else if (!ca && cb) {
      cb.assets.add(e.assetA);
      cb.weight += e.weight;
      assetToCluster.set(e.assetA, cb);
    } else if (ca && cb && ca !== cb) {
      // Merge cb into ca
      for (const a of cb.assets) {
        ca.assets.add(a);
        assetToCluster.set(a, ca);
      }
      ca.weight += cb.weight;
      cb.assets.clear();
    }
  }

  const out = [];
  for (const c of clusters) {
    if (c.assets.size < 2) continue;
    // Label by dominant category from member metas
    const catCount = new Map();
    const members = [];
    for (const asset of c.assets) {
      const meta = tokenMeta.get(asset);
      if (meta?.category) catCount.set(meta.category, (catCount.get(meta.category) || 0) + 1);
      members.push({
        asset,
        asset_name: meta?.name || asset,
        asset_image: meta?.image || null,
      });
    }
    let label = 'mixed';
    let max = 0;
    for (const [k, v] of catCount) {
      if (v > max) { max = v; label = k; }
    }
    out.push({
      id: `cohort_${c.id}`,
      label,
      size: c.assets.size,
      total_weight: c.weight,
      members: members.slice(0, 12),
    });
  }
  out.sort((a, b) => b.total_weight - a.total_weight);
  return out.slice(0, 20);
}

function computeFirstMentionRadar() {
  // For each asset count: authors with firstSeen in last 24h, total authors in last 7d.
  const now = Date.now();
  const window24 = 24 * 60 * 60 * 1000;
  const window7d = 7 * 24 * 60 * 60 * 1000;
  const stats = new Map(); // asset -> {newAuthors, totalAuthors, newKolAuthors, samples}
  for (const [k, v] of authorTokenHistory) {
    const idx = k.lastIndexOf(':');
    const asset = k.slice(idx + 1);
    if (now - v.lastSeen > window7d) continue;
    const s = stats.get(asset) || { newAuthors: 0, totalAuthors: 0, newKolAuthors: 0, samples: [] };
    s.totalAuthors += 1;
    if (now - v.firstSeen <= window24) {
      s.newAuthors += 1;
      if (v.followers >= FIRST_MENTION_FOLLOWER_THRESHOLD) {
        s.newKolAuthors += 1;
        if (s.samples.length < 4) s.samples.push({ handle: v.handle, followers: v.followers });
      }
    }
    stats.set(asset, s);
  }
  const out = [];
  for (const [asset, s] of stats) {
    if (s.totalAuthors < 2) continue;
    if (s.newAuthors === 0) continue;
    const ratio = s.newAuthors / s.totalAuthors;
    const meta = tokenMeta.get(asset);
    out.push({
      asset,
      asset_name: meta?.name || asset,
      asset_image: meta?.image || null,
      market_cap: meta?.marketCap || 0,
      new_authors_24h: s.newAuthors,
      total_authors_7d: s.totalAuthors,
      new_kol_authors_24h: s.newKolAuthors,
      ratio: Number(ratio.toFixed(3)),
      sample_authors: s.samples,
      score: Math.round(ratio * 60 + s.newKolAuthors * 8),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 40);
}

// ── Express registration ────────────────────────────────────────────────────
const DEV_LITE = process.env.SPECTRE_DEV_LITE === '1';
let onDemandTickInflight = null;
function ensureFreshTick() {
  if (Date.now() - lastTick.ts < POLL_INTERVAL_MS) return Promise.resolve();
  if (!onDemandTickInflight) {
    onDemandTickInflight = tick()
      .catch((e) => console.error('[social-signals] tick error', e))
      .finally(() => { onDemandTickInflight = null; });
  }
  return onDemandTickInflight;
}

function registerSocialSignals(app) {
  if (DEV_LITE) {
    // DEV-LITE: no 90s background xdash fan-out. Refresh on demand instead -
    // the first social-signals request waits for one tick so the ring has
    // data, later requests serve the ring and refresh in the background.
    app.use('/api/social-signals', (req, res, next) => {
      if (lastTick.ts === 0) { ensureFreshTick().then(() => next(), () => next()); return; }
      ensureFreshTick();
      next();
    });
  } else {
    // Kick off the scheduler. First tick fires immediately so endpoints have data within ~5s.
    const startScheduler = () => {
      tick().catch((e) => console.error('[social-signals] initial tick error', e));
      setInterval(() => {
        tick().catch((e) => console.error('[social-signals] tick error', e));
      }, POLL_INTERVAL_MS).unref?.();
    };
    // Defer slightly so it doesn't block server boot
    setTimeout(startScheduler, 500);
  }

  app.get('/api/social-signals/feed', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, SIGNAL_RING_SIZE);
      const cacheKey = `feed:${limit}`;
      const cached = getCached(cache, cacheKey, ENDPOINT_CACHE_MS);
      if (cached) return res.json(cached);
      const data = recentSignals.slice(0, limit);
      const payload = {
        data,
        meta: {
          total: recentSignals.length,
          last_tick: lastTick,
          generated_at: new Date().toISOString(),
        },
      };
      setCached(cache, cacheKey, payload, ENDPOINT_CACHE_MS);
      res.json(payload);
    } catch (err) {
      res.json({ data: [], meta: { error: err.message } });
    }
  });

  app.get('/api/social-signals/frontrun-score/:asset', (req, res) => {
    try {
      const asset = String(req.params.asset || '').toUpperCase();
      const cacheKey = `frontrun:${asset}`;
      const cached = getCached(cache, cacheKey, ENDPOINT_CACHE_MS);
      if (cached) return res.json(cached);
      const result = computeFrontrunScore(asset);
      const payload = {
        data: {
          asset,
          score: result.score,
          severity: gradeSeverity(result.score),
          factors: result.factors,
          normalized: result.normalized,
        },
        meta: {
          missing: result.missing,
          last_tick: lastTick,
          generated_at: new Date().toISOString(),
        },
      };
      setCached(cache, cacheKey, payload, ENDPOINT_CACHE_MS);
      res.json(payload);
    } catch (err) {
      res.json({ data: { asset: req.params.asset, score: 0, factors: {} }, meta: { error: err.message } });
    }
  });

  app.get('/api/social-signals/whale-alignment', (req, res) => {
    try {
      const cacheKey = 'whale-align';
      const cached = getCached(cache, cacheKey, ENDPOINT_CACHE_MS);
      if (cached) return res.json(cached);
      const data = computeWhaleAlignment();
      const payload = {
        data,
        meta: {
          window_hours: 4,
          min_kols: WHALE_ALIGNMENT_MIN_KOLS,
          follower_threshold: KOL_FOLLOWER_THRESHOLD,
          last_tick: lastTick,
          generated_at: new Date().toISOString(),
        },
      };
      setCached(cache, cacheKey, payload, ENDPOINT_CACHE_MS);
      res.json(payload);
    } catch (err) {
      res.json({ data: [], meta: { error: err.message } });
    }
  });

  app.get('/api/social-signals/handoff', (req, res) => {
    try {
      const cacheKey = 'handoff';
      const cached = getCached(cache, cacheKey, ENDPOINT_CACHE_MS);
      if (cached) return res.json(cached);
      const data = computeHandoff();
      const payload = {
        data,
        meta: {
          last_tick: lastTick,
          generated_at: new Date().toISOString(),
        },
      };
      setCached(cache, cacheKey, payload, ENDPOINT_CACHE_MS);
      res.json(payload);
    } catch (err) {
      res.json({ data: [], meta: { error: err.message } });
    }
  });

  app.get('/api/social-signals/narrative-cohorts', (req, res) => {
    try {
      const cacheKey = 'cohorts';
      const cached = getCached(cache, cacheKey, ENDPOINT_CACHE_MS);
      if (cached) return res.json(cached);
      const data = computeNarrativeCohorts();
      const payload = {
        data,
        meta: {
          edge_min_weight: COHORT_EDGE_MIN_WEIGHT,
          edge_count: coMentionEdges.size,
          last_tick: lastTick,
          generated_at: new Date().toISOString(),
        },
      };
      setCached(cache, cacheKey, payload, ENDPOINT_CACHE_MS);
      res.json(payload);
    } catch (err) {
      res.json({ data: [], meta: { error: err.message } });
    }
  });

  // Renamed conceptually to "new-voice radar" but keeps the URL for compat.
  // Returns tokens whose author roster gained meaningful new entrants in the last
  // 24h relative to their 7d author universe. Suppresses results until the
  // scheduler warmup completes (so we don't surface cold-start noise).
  app.get('/api/social-signals/first-mention-radar', (req, res) => {
    try {
      if (!isWarm()) {
        return res.json({
          data: [],
          meta: {
            warmup: true,
            warmup_ms_remaining: Math.max(0, NEW_VOICE_WARMUP_MS - (Date.now() - SCHEDULER_START)),
            note: 'New-voice radar calibrating. Author baselines need 6h to stabilize; signals here would be unreliable cold-start noise.',
          },
        });
      }
      const cacheKey = 'first-mention';
      const cached = getCached(cache, cacheKey, ENDPOINT_CACHE_MS);
      if (cached) return res.json(cached);
      const data = computeFirstMentionRadar();
      const payload = {
        data,
        meta: {
          window_24h: true,
          history_window_7d: true,
          last_tick: lastTick,
          generated_at: new Date().toISOString(),
        },
      };
      setCached(cache, cacheKey, payload, ENDPOINT_CACHE_MS);
      res.json(payload);
    } catch (err) {
      res.json({ data: [], meta: { error: err.message } });
    }
  });
}

module.exports = registerSocialSignals;
