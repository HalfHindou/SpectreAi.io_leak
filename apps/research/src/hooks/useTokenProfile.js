/**
 * useTokenProfile — Fetches enriched token market profile from Haitam backend.
 *
 * Endpoint: /ext-api/get-token-market-profile?cg_id=...
 * Returns: holders, liquidity structure, CEX/DEX split, key levels,
 *          AI insight, intelligence analysis (sentiment + F&G).
 *
 * Polls every 5 minutes. Keeps stale data on error.
 */
import { useState, useEffect, useCallback } from 'react'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getTokenMarketProfile } from '@/services/researchApi'
import { getSpectreTokenProfile, getSpectreTokenTechnicals } from '@/services/spectreMarketApi'

const COINGECKO_ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_COINGECKO_ID).map(([symbol, id]) => [id, symbol])
)

const VERDICT_BY_SIGNAL = {
  'strong buy': 'Strongly bullish setup',
  'buy': 'Bullish bias',
  'neutral': 'No clear directional edge',
  'hold': 'Range-bound, no clear edge',
  'sell': 'Bearish bias',
  'strong sell': 'Strongly bearish setup',
}

const GUIDANCE_BY_SIGNAL = {
  'strong buy': 'Momentum and trend align to the upside; favor continuation while support holds.',
  'buy': 'Trend leans long but conviction is moderate; confirm on a clean break above resistance.',
  'neutral': 'Wait for a decisive break of the current range before committing.',
  'hold': 'Wait for a decisive break of the current range before committing.',
  'sell': 'Trend leans short; watch for failed bounces into resistance.',
  'strong sell': 'Momentum and trend align to the downside; rallies likely to be sold.',
}

function buildTechnicalSentence(signal, summary) {
  const sig = String(signal || '').toLowerCase().replace(/_/g, ' ').trim()
  const total = Number(summary?.total_signals) || 0
  const bull = Number(summary?.bullish_signals) || 0
  const bear = Number(summary?.bearish_signals) || 0
  const neutral = Math.max(0, total - bull - bear)
  const verdict = VERDICT_BY_SIGNAL[sig] || (sig ? sig.charAt(0).toUpperCase() + sig.slice(1) : null)
  if (!verdict && !total) return null
  if (!total) return `${verdict}.`
  // Phrase the lean in its ACTUAL direction. The old string always said
  // "N% lean long", which produced "Strongly bearish setup — 31% lean long".
  const dominant = Math.max(bull, bear)
  const lean = bull === bear
    ? 'evenly split'
    : `${Math.round((dominant / total) * 100)}% lean ${bull > bear ? 'long' : 'short'}`
  const breakdown = `${bull} bullish vs ${bear} bearish${neutral ? ` (${neutral} neutral)` : ''} across ${total} signals — ${lean}.`
  const guidance = GUIDANCE_BY_SIGNAL[sig] || ''
  return [`${verdict || 'Mixed signals'}.`, breakdown, guidance].filter(Boolean).join(' ')
}

function mapSpectreProfileToResearchProfile(profile, technicals) {
  if (!profile) return null
  const market = profile.market || {}
  const price = profile.price || {}
  const intelligence = profile.intelligence || {}
  const technicalSummary = technicals?.summary || null
  const technicalSignal = typeof technicalSummary === 'string'
    ? technicalSummary
    : technicalSummary?.signal || technicals?.signal || profile.technicals?.signal || null
  const technicalSentence = typeof technicalSummary === 'string'
    ? technicalSummary
    : technicalSignal
      ? buildTechnicalSentence(technicalSignal, technicalSummary)
      : intelligence.summary || null
  return {
    token_details: {
      token_name: profile.name,
      ticker: profile.symbol,
      price: price.usd ?? profile.price_usd ?? null,
      market_cap: market.market_cap ?? null,
      volume_24h: market.volume_24h ?? null,
      key_levels: technicals?.key_levels || null,
      ai_insight: technicalSentence || intelligence.thesis || null,
      catalysts: Array.isArray(intelligence.recent_briefs) ? intelligence.recent_briefs : [],
    },
    intelligence_ai_analysis: {
      summary: intelligence.summary || technicalSentence || null,
      sentiment: profile.social?.sentiment_score ?? null,
      technical_signal: technicalSignal,
      source: 'spectre-market',
    },
    _source: 'spectre-market',
  }
}

export default function useTokenProfile(cgId) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchProfile = useCallback(async () => {
    if (!cgId) return
    setLoading(prev => !prev ? true : prev)
    try {
      const symbol = COINGECKO_ID_TO_SYMBOL[String(cgId).toLowerCase()]
      if (symbol) {
        const [spectreProfile, technicals] = await Promise.all([
          getSpectreTokenProfile(symbol).catch(() => null),
          getSpectreTokenTechnicals(symbol).catch(() => null),
        ])
        const mapped = mapSpectreProfileToResearchProfile(spectreProfile, technicals)
        if (mapped) {
          setProfile(mapped)
          setError(null)
          return
        }
      }

      const data = await getTokenMarketProfile(cgId)
      if (data) {
        setProfile(data)
        setError(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [cgId])

  useEffect(() => {
    setProfile(null)
    setError(null)
    fetchProfile()
  }, [fetchProfile])

  return { profile, loading, error }
}
