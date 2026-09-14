import { useMemo } from 'react'

/**
 * Pure-function hook. Derives rule-based alpha insights from the X Dash
 * intel response. No fetching. No effects. Returns a deduplicated list of
 * insight objects shaped:
 *
 *   { id, severity, label, value, hint, icon }
 *
 *   severity: 'hot' | 'warm' | 'cool' | 'info'
 *
 * Field reference (from real X Dash API):
 *   metrics.mentions_24h, metrics.total_mentions
 *   metrics.velocity_ratio                  — 24h vs prior daily avg
 *   metrics.novelty_ratio                   — share of fresh mentions
 *   metrics.unique_external_authors_24h
 *   metrics.external_weighted_engagement_24h
 *   metrics.external_weighted_prev_daily_avg
 *   metrics.self_share_24h                  — % of mentions from project
 *   quality.clean_signal_score              — 0..1
 *   quality.cashtag_signal_share            — 0..1
 *   quality.unique_author_share_24h         — 0..1
 *   quality.has_recent_external_signal      — bool
 *   state.scheduler.tier                    — 'hot' | 'warm' | 'cool'
 *   top_authors[]                           — KOLs with follower_count
 */
export default function useAlphaSignals({ tokenIntel, peers, onChainStats }) {
  return useMemo(() => {
    const out = []
    if (!tokenIntel) return out

    const metrics = tokenIntel.metrics || tokenIntel.token?.metrics || {}
    const quality = tokenIntel.quality || tokenIntel.token?.quality || {}
    const state = tokenIntel.state || tokenIntel.token?.state || {}

    const mentions24h = num(metrics.mentions_24h)
    const totalMentions = num(metrics.total_mentions)
    const externalMentions24h = num(metrics.external_mentions_24h)
    const externalPrevAvg = num(metrics.external_mentions_prev_daily_avg)
    const velocityRatio = num(metrics.velocity_ratio)
    const noveltyRatio = num(metrics.novelty_ratio)
    const uniqueAuthors24h = num(metrics.unique_external_authors_24h)
    const engagement24h = num(metrics.external_weighted_engagement_24h)
    const engagementPrevAvg = num(metrics.external_weighted_prev_daily_avg)
    const selfShare24h = num(metrics.self_share_24h) // 0..1

    const cleanSignal = num(quality.clean_signal_score)
    const uniqueAuthorShare = num(quality.unique_author_share_24h)
    const hasRecent = !!quality.has_recent_external_signal
    const tier = state?.scheduler?.tier || null

    // 1. Mention velocity spike — vs prior daily avg
    if (velocityRatio >= 2 && externalMentions24h > 0) {
      const pct = Math.round((velocityRatio - 1) * 100)
      out.push({
        id: 'velocity-spike',
        severity: 'hot',
        label: 'Mention velocity spike',
        value: `+${pct}%`,
        hint: `${externalMentions24h} external mentions in 24h vs ${externalPrevAvg.toFixed(1)}/day baseline.`,
        icon: 'flame',
      })
    } else if (velocityRatio >= 1.3 && externalMentions24h > 0) {
      out.push({
        id: 'velocity-warming',
        severity: 'warm',
        label: 'Chatter accelerating',
        value: `${velocityRatio.toFixed(2)}x`,
        hint: 'External mentions trending above the prior 7-day baseline.',
        icon: 'trending-up',
      })
    }

    // 2. Engagement surge — weighted engagement vs prior avg
    if (engagement24h > 0 && engagementPrevAvg > 0) {
      const ratio = engagement24h / engagementPrevAvg
      if (ratio >= 2.5) {
        const pct = Math.round((ratio - 1) * 100)
        out.push({
          id: 'engagement-surge',
          severity: 'hot',
          label: 'Engagement surging',
          value: `+${pct}%`,
          hint: 'Weighted engagement is well above the rolling baseline.',
          icon: 'zap',
        })
      }
    }

    // 3. High signal quality — clean, on-topic, diverse authors
    if (cleanSignal >= 0.6 && uniqueAuthorShare >= 0.5) {
      out.push({
        id: 'high-quality-signal',
        severity: 'warm',
        label: 'High-quality chatter',
        value: `${Math.round(cleanSignal * 100)}%`,
        hint: 'Mentions are on-topic, diverse, and not promo-driven.',
        icon: 'shield-check',
      })
    } else if (cleanSignal > 0 && cleanSignal < 0.25) {
      out.push({
        id: 'low-quality-signal',
        severity: 'cool',
        label: 'Noisy chatter',
        value: `${Math.round(cleanSignal * 100)}%`,
        hint: 'A lot of mentions are promo, duplicate, or off-topic.',
        icon: 'shield',
      })
    }

    // 4. Self-driven (project mostly talking about itself)
    if (selfShare24h >= 0.6 && mentions24h > 0) {
      out.push({
        id: 'self-driven',
        severity: 'cool',
        label: 'Mostly self-mentions',
        value: `${Math.round(selfShare24h * 100)}%`,
        hint: 'The project drives most of the chatter — limited organic reach.',
        icon: 'user',
      })
    }

    // 5. Diverse author base
    if (uniqueAuthors24h >= 5 && uniqueAuthorShare >= 0.7) {
      out.push({
        id: 'broad-attention',
        severity: 'warm',
        label: 'Broad KOL attention',
        value: `${uniqueAuthors24h} authors`,
        hint: 'Many distinct accounts mentioning, low repetition.',
        icon: 'users',
      })
    }

    // 6. Silent token
    if (mentions24h === 0 && totalMentions === 0) {
      out.push({
        id: 'silent',
        severity: 'cool',
        label: 'No chatter detected',
        value: '0',
        hint: 'X has not noticed this token yet — could be early or could be ignored.',
        icon: 'eye-off',
      })
    } else if (externalMentions24h === 0 && totalMentions > 0) {
      out.push({
        id: 'fading',
        severity: 'cool',
        label: 'Quiet 24h',
        value: '0 ext.',
        hint: 'No external mentions in the last 24h despite prior coverage.',
        icon: 'eye-off',
      })
    }

    // 7. Scheduler tier (X Dash classifies tokens hot/warm/cool internally)
    if (tier === 'hot' && mentions24h > 0) {
      out.push({
        id: 'tier-hot',
        severity: 'hot',
        label: 'X Dash priority: HOT',
        value: 'tier-1',
        hint: 'X Dash auto-tier model has flagged this token as a priority watch.',
        icon: 'flame',
      })
    }

    // 8. High novelty (lots of fresh content, not recycled)
    if (noveltyRatio >= 1.2 && externalMentions24h >= 2) {
      out.push({
        id: 'fresh-content',
        severity: 'warm',
        label: 'Fresh narrative forming',
        value: `${noveltyRatio.toFixed(1)}x`,
        hint: 'New angles emerging, not just recycled content.',
        icon: 'sparkle',
      })
    }

    // 9. Mentions vs price divergence — needs onChainStats
    if (onChainStats && externalMentions24h > 0 && velocityRatio >= 1.8) {
      const priceChange = num(onChainStats.priceChange24h)
      const volChange = num(onChainStats.volumeChange24h)
      if (Math.abs(priceChange) < 3 && Math.abs(volChange) < 10) {
        out.push({
          id: 'mention-price-divergence',
          severity: 'hot',
          label: 'Mentions up, price flat',
          value: 'Front-run window',
          hint: 'X chatter is rising while on-chain price has not moved yet — possible early signal.',
          icon: 'zap',
        })
      }
    }

    // 10. Recent external signal flag
    if (hasRecent && externalMentions24h === 0) {
      out.push({
        id: 'recent-external',
        severity: 'info',
        label: 'External coverage logged',
        value: 'recent',
        hint: 'External KOL coverage detected within the last few cycles.',
        icon: 'broadcast',
      })
    }

    // Sort by severity priority then dedupe by id
    const order = { hot: 0, warm: 1, cool: 2, info: 3 }
    out.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
    const seen = new Set()
    return out.filter((s) => {
      if (seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })
  }, [tokenIntel, peers, onChainStats])
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}
