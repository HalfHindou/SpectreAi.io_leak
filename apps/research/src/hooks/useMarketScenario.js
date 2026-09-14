/**
 * useMarketScenario — Fetches AI-generated market scenario from Haitam backend.
 *
 * Endpoint: /ext-api/market-scenario?cg_id=...&mode=fast
 * Returns: scenario_title, confidence, summary, bull/bear case, bias, risk_level,
 *          range_high/range_low.
 *
 * Transforms API response to match the shape expected by MarketScenarioSection
 * in rz-overview-tab.jsx: { label, color, confidence, trigger, bullCase, bearCase, keyLevels }.
 */
import { useState, useEffect, useCallback } from 'react'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import { getMarketScenario } from '@/services/researchApi'
import { getSpectreTokenProfile, getSpectreTokenTechnicals } from '@/services/spectreMarketApi'

const COINGECKO_ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_COINGECKO_ID).map(([symbol, id]) => [id, symbol])
)

const BIAS_COLORS = {
  bullish: '#10B981',
  bearish: '#EF4444',
  neutral: '#F59E0B',
}

function transformScenario(raw) {
  if (!raw?.market_scenario) return null
  const s = raw.market_scenario
  const fmtPrice = (v) => {
    if (v == null) return ''
    return v >= 1 ? `$${v.toLocaleString()}` : `$${v}`
  }

  // Defensive coercion: if any of these come back as a structured object
  // (the backend has shipped technical summaries as `{signal, *_signals}`),
  // stringify rather than letting React choke when the consumer renders the
  // value inside a <p>.
  const ensureText = (v) => {
    if (v == null) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'object' && v.signal) {
      const total = Number(v.total_signals) || 0
      const bull = Number(v.bullish_signals) || 0
      const bear = Number(v.bearish_signals) || 0
      const sig = String(v.signal).replace(/_/g, ' ').trim()
      const verdict = sig.charAt(0).toUpperCase() + sig.slice(1)
      return total > 0 ? `${verdict}. ${bull} bullish vs ${bear} bearish across ${total} indicators.` : `${verdict}.`
    }
    return String(v)
  }

  return {
    label: s.scenario_title || 'Market Scenario',
    color: BIAS_COLORS[s.bias] || BIAS_COLORS.neutral,
    confidence: s.confidence || 0,
    trigger: ensureText(s.summary),
    bullCase: ensureText(s.bull_case),
    bearCase: ensureText(s.bear_case),
    keyLevels: [
      s.range_low != null && { label: 'Support', price: fmtPrice(s.range_low) },
      s.range_high != null && { label: 'Resistance', price: fmtPrice(s.range_high) },
    ].filter(Boolean),
    bias: s.bias || 'neutral',
    riskLevel: s.risk_level || 'medium',
    source: 'ai',
  }
}

export default function useMarketScenario(cgId) {
  const [scenario, setScenario] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchScenario = useCallback(async () => {
    if (!cgId) return
    setLoading(prev => !prev ? true : prev)
    try {
      const symbol = COINGECKO_ID_TO_SYMBOL[String(cgId).toLowerCase()]
      if (symbol) {
        const [profile, technicals] = await Promise.all([
          getSpectreTokenProfile(symbol).catch(() => null),
          getSpectreTokenTechnicals(symbol).catch(() => null),
        ])
        if (profile) {
          const summary = technicals?.summary
          const signal = String(
            (typeof summary === 'string' ? summary : summary?.signal) ||
            technicals?.signal ||
            profile.technicals?.signal ||
            'neutral'
          ).toLowerCase()
          const bias = signal.includes('buy') || signal.includes('bull') ? 'bullish' : signal.includes('sell') || signal.includes('bear') ? 'bearish' : 'neutral'
          const price = Number(profile.price?.usd ?? 0)
          // `technicals.summary` can be a string OR an object
          // `{ signal, bullish_signals, bearish_signals, total_signals }`.
          // The mobile + desktop renderers print `scenario.trigger` directly
          // inside a <p>, so passing the object form throws
          // "Objects are not valid as a React child". Build a sentence from
          // the structured shape when we get the object.
          let triggerText = ''
          if (typeof summary === 'string') {
            triggerText = summary
          } else if (summary && typeof summary === 'object') {
            const total = Number(summary.total_signals) || 0
            const bull = Number(summary.bullish_signals) || 0
            const bear = Number(summary.bearish_signals) || 0
            const sig = String(summary.signal || signal).replace(/_/g, ' ').trim()
            const verdict = sig ? sig.charAt(0).toUpperCase() + sig.slice(1) : 'Mixed signals'
            triggerText = total > 0
              ? `${verdict}. ${bull} bullish vs ${bear} bearish across ${total} indicators.`
              : `${verdict}.`
          }
          triggerText = triggerText
            || profile.intelligence?.summary
            || 'Scenario is derived from Spectre profile, chart, and technical bridge data.'
          setScenario({
            label: `${profile.symbol || symbol} live market scenario`,
            color: BIAS_COLORS[bias] || BIAS_COLORS.neutral,
            confidence: Number(technicals?.confidence ?? profile.scores?.spectre ?? 55),
            trigger: triggerText,
            bullCase: bias === 'bearish' ? 'Bull case needs reclaim of short-term trend and volume confirmation.' : 'Bull case stays active while price structure and liquidity remain constructive.',
            bearCase: bias === 'bullish' ? 'Bear case activates on loss of trend support or funding stress.' : 'Bear case stays active until demand and breadth improve.',
            keyLevels: price ? [
              { label: 'Support', price: `$${(price * 0.94).toLocaleString()}` },
              { label: 'Resistance', price: `$${(price * 1.08).toLocaleString()}` },
            ] : [],
            bias,
            riskLevel: bias === 'neutral' ? 'medium' : 'elevated',
            source: 'spectre-market',
          })
          setError(null)
          return
        }
      }

      const data = await getMarketScenario(cgId)
      const transformed = transformScenario(data)
      if (transformed) {
        setScenario(transformed)
        setError(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [cgId])

  useEffect(() => {
    setScenario(null)
    setError(null)
    fetchScenario()
  }, [fetchScenario])

  return { scenario, loading, error }
}
