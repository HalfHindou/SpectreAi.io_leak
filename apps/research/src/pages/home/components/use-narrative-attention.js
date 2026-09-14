/**
 * use-narrative-attention — what the crowd is actually talking about.
 *
 * The Sectors tab used to read CoinGecko categories, which (a) had been frozen
 * on 13 May since 13 May and (b) answer "what did price do", not "where is
 * attention". This reads the X Dash narrative feed instead: real mention
 * volume, real accounts, real per-token velocity, updated hourly.
 *
 * ACCELERATION is the number the panel is built around, and it is derived, not
 * given: the feed exposes a 24h window and a 7d window, so the prior daily
 * average is (7d - 24h) / 6 and today's run-rate against it is
 * `mentions24 / priorDaily`. Above 1 the narrative is pulling more attention
 * than it was; below 1 it is bleeding. When the 7d window is missing or is not
 * larger than the 24h window (a brand-new narrative), accel is null and the UI
 * says "new" rather than inventing a multiplier.
 *
 * 🪤 THE 24h WINDOW CAN BE EMPTY UPSTREAM. Measured 2026-08-31: the box answers
 * `?timeframe=24h` with `narrative_count: 0` and `tokens_with_external_mentions_24h: 0`
 * while `?timeframe=7d` returns 9 narratives — every `*_24h` counter inside the
 * narrative aggregation is zeroed, and only `7d` is a supported timeframe value
 * (48h/3d/30d all echo back as "24h" with nothing in them). That is the X Dash
 * window trap, filed for Alaa. Rather than paint an empty tab, the hook falls
 * back to the 7d window and REPORTS which window it is showing, so the UI can
 * say "last 7 days" instead of lying about 24 hours. In that mode there is no
 * second window to divide by, so acceleration and per-token velocity are null
 * (the feed's own velocity_ratio is derived from the same zeroed counters, so
 * it is 0.0 for everything and must not be shown as a real reading).
 */
import { useEffect, useMemo, useState } from 'react'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import { getSpectrePricesBySymbols } from '@/services/spectreMarketApi'

const OPTS = { ttlMs: 5 * 60 * 1000 }
const P24 = { timeframe: '24h' }
const P7D = { timeframe: '7d' }

function leadersOf(item, win) {
  const tokens = Array.isArray(item?.top_tokens) ? item.top_tokens : []
  const wide = win === '7d'
  return tokens
    .map((t) => {
      const tok = t?.token || {}
      const sym = String(tok.symbol || '').trim().toUpperCase()
      if (!sym) return null
      const chain = tok.chain || null
      return {
        symbol: sym,
        name: tok.name || sym,
        cgId: tok.cg_id || null,
        image: typeof tok.image === 'string' && tok.image.startsWith('http') ? tok.image : null,
        // velocity_ratio is the token's own 24h mentions over its prior daily
        // average — the same idea as the narrative accel, one level down. In
        // the 7d fallback it is computed off the zeroed 24h counters, so it
        // reads 0.0 for every name and is dropped rather than shown.
        velocity: !wide && Number.isFinite(t?.metrics?.velocity_ratio) ? t.metrics.velocity_ratio : null,
        // Same reason the counters are read from the window we are actually
        // showing: in 7d mode the *_24h fields are all zero.
        mentions24: Number(wide ? t?.metrics?.external_mentions : t?.metrics?.external_mentions_24h) || 0,
        authors24: Number(wide ? t?.metrics?.unique_external_authors : t?.metrics?.unique_external_authors_24h) || 0,
        promoShare: Number.isFinite(t?.quality?.promo_share_24h) ? t.quality.promo_share_24h : null,
        // Drill-down fields: the narrative card only needs art + velocity, but
        // opening a narrative has to answer "which names, how big, who is
        // posting them" without a second round trip.
        marketCap: Number(tok.market_cap) || null,
        chain,
        address: (chain && tok.platforms && tok.platforms[chain]) || null,
        authors: (Array.isArray(t?.top_authors) ? t.top_authors : [])
          .slice(0, 3)
          .map((a) => ({
            handle: String(a?.screen_name || '').replace(/^@/, ''),
            name: a?.name || '',
            avatar: typeof a?.avatar_image_url === 'string' && a.avatar_image_url.startsWith('http') ? a.avatar_image_url : null,
            followers: Number(a?.followers_count) || 0,
            mentions: Number(a?.mention_count) || 0,
          }))
          .filter((a) => a.handle),
      }
    })
    .filter(Boolean)
    // 🪤 The feed can carry the same ticker twice inside one narrative (two PEPE
    // entries under Frogs — different chains, same symbol). Keeping both drew
    // the coin twice in the stack and collided on the React key, so the first
    // occurrence (highest velocity after the sort) wins.
    .sort((a, b) => (wide ? b.mentions24 - a.mentions24 : (b.velocity ?? 0) - (a.velocity ?? 0)))
    .filter((t, i, all) => all.findIndex((o) => o.symbol === t.symbol) === i)
}

export default function useNarrativeAttention({ enabled = true } = {}) {
  const day = useXDashSurface(enabled ? '/api/xdash/narratives' : null, P24, { ...OPTS, enabled })
  const week = useXDashSurface(enabled ? '/api/xdash/narratives' : null, P7D, { ...OPTS, enabled })

  const { win, narratives } = useMemo(() => {
    const dayItems = Array.isArray(day.data?.items) ? day.data.items : []
    const weekItems = Array.isArray(week.data?.items) ? week.data.items : []
    // Only fall back once the 24h request has genuinely settled — an empty
    // answer that is merely still in flight must not flip the panel to 7d and
    // then flip it back a moment later.
    const daySettled = day.data != null || !!day.error
    const wide = daySettled && dayItems.length === 0 && weekItems.length > 0
    const items = wide ? weekItems : dayItems
    if (items.length === 0) return { win: '24h', narratives: [] }

    // In 7d mode there is no second window to divide by, so no acceleration.
    const weekBy = wide ? null : new Map(weekItems.map((i) => [i.id || i.label, i]))

    const list = items
      .map((i) => {
        const mentions = Number(i.mention_count) || 0
        const w = weekBy ? weekBy.get(i.id || i.label) : null
        const mentions7d = Number(w?.mention_count) || 0
        const priorDaily = mentions7d > mentions ? (mentions7d - mentions) / 6 : null
        const accel = priorDaily && priorDaily > 0 ? mentions / priorDaily : null
        return {
          id: i.id || i.label,
          label: i.label || i.id,
          description: i.description || '',
          mentions24: mentions,
          priorDaily: priorDaily ? Math.round(priorDaily) : null,
          accel,
          share: Number(i.mention_share) || 0,
          authors: Number(i.author_count_sum) || 0,
          tokenCount: Number(i.token_count) || 0,
          freshShare: Number(i.fresh_token_share) || 0,
          cleanSignal: Number(i.average_clean_signal) || 0,
          leaderShare: Number(i.leader_token_share) || 0,
          leaders: leadersOf(i, wide ? '7d' : '24h'),
        }
      })
      .sort((a, b) => b.mentions24 - a.mentions24)

    return { win: wide ? '7d' : '24h', narratives: list }
  }, [day.data, day.error, week.data])

  // The narrative feed only carries token art for a minority of its leaders
  // (1 of 26 in a live sample), so the stack fell back to initials — which is
  // what "no logos" looked like. One symbol-keyed price call fills in both the
  // image AND the 24h move, so a leader can show what the crowd is doing to it
  // and what price did, side by side.
  const leaderSymbols = useMemo(() => {
    const set = new Set()
    // Every leader, not just the three in the stack: opening a narrative shows
    // all of its names with a price beside the mention count, and the call is
    // chunked server-side anyway.
    for (const n of narratives) for (const l of n.leaders) set.add(l.symbol)
    return [...set].slice(0, 60).sort()
  }, [narratives])

  // 🪤 Keyed on the joined STRING, not the array. `leaderSymbols` gets a new
  // identity every time the feed object changes (the 7d window landing after
  // the 24h one is enough), which re-ran this effect, cancelled the in-flight
  // price call, and then hit the "already asked for this key" guard on the way
  // back in — so the prices and the coin art never arrived at all. Whether it
  // worked came down to which response won the race.
  const [meta, setMeta] = useState({})
  const leaderKey = useMemo(() => leaderSymbols.join(','), [leaderSymbols])
  useEffect(() => {
    if (!leaderKey) return undefined
    let cancelled = false
    getSpectrePricesBySymbols(leaderKey.split(','))
      .then((rows) => {
        if (cancelled || !rows) return
        const next = {}
        for (const [sym, row] of Object.entries(rows)) {
          next[sym] = { image: row?.image || null, change24: Number.isFinite(row?.change24) ? row.change24 : null }
        }
        setMeta(next)
      })
      .catch(() => { /* art is a nice-to-have; initials still render */ })
    return () => { cancelled = true }
  }, [leaderKey])

  const enriched = useMemo(() => {
    if (!narratives.length) return narratives
    return narratives.map((n) => ({
      ...n,
      leaders: n.leaders.map((l) => ({
        ...l,
        image: l.image || meta[l.symbol]?.image || null,
        change24: meta[l.symbol]?.change24 ?? null,
      })),
    }))
  }, [narratives, meta])

  const summary = useMemo(() => {
    if (narratives.length === 0) return null
    const rated = narratives.filter((n) => n.accel != null)
    const gaining = rated.filter((n) => n.accel >= 1).length
    const totalMentions = narratives.reduce((s, n) => s + n.mentions24, 0)
    const totalAuthors = narratives.reduce((s, n) => s + n.authors, 0)
    const top = narratives[0]
    // One narrative holding a third of the tape is a different market from nine
    // splitting it evenly, so the headline is concentration, not a count.
    const bias = !rated.length ? 'neutral'
      : gaining === 0 ? 'bearish'
      : gaining >= rated.length / 2 ? 'bullish'
      : top && top.accel != null && top.accel >= 1 ? 'bullish' : 'bearish'
    return {
      gaining,
      rated: rated.length,
      total: narratives.length,
      totalMentions,
      totalAuthors,
      topShare: top ? top.share : 0,
      topLabel: top ? top.label : '',
      bias,
      window: win,
      // Every one of these readings is a statement about acceleration, so with
      // nothing rated there is no honest headline to print — null, and the
      // chip is dropped rather than defaulting to "cooling".
      label: !rated.length ? null
        : gaining === 0 ? 'Cooling across the board'
        : gaining >= rated.length / 2 ? 'Broad interest'
        : `Consolidating into ${top?.label || 'one narrative'}`,
    }
  }, [narratives, win])

  return {
    narratives: enriched,
    summary,
    // Which window the rows above actually describe — '24h' normally, '7d' when
    // the box has nothing for the last day (see the trap note at the top).
    window: win,
    loading: (day.loading && !day.data) || (week.loading && !week.data),
    error: day.error || null,
  }
}
