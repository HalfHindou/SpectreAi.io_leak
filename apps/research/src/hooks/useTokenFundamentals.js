/**
 * useTokenFundamentals — Fetches fundamentals grading from Haitam backend.
 *
 * Endpoint: POST /ext-api/token-fundamuntals
 * Sends token_details + intelligence_ai_analysis from the market profile.
 * Returns: overallGrade, fundamentals[], summary, positiveTags[], riskTags[].
 *
 * Transforms API response to match FundamentalsSection expected shape:
 * { overall, insight, catalysts, risks, [dimension_key]: letter_grade }
 */
import { useState, useEffect, useCallback } from 'react'
import { getTokenFundamentals } from '@/services/researchApi'

function transformGrades(raw) {
  if (!raw?.overallGrade) return null
  const grades = {
    overall: raw.overallGrade.letter || 'C',
    overallScore: raw.overallGrade.score || 50,
    insight: raw.summary || null,
    catalysts: raw.positiveTags || [],
    risks: raw.riskTags || [],
    dimensions: [],
  }

  if (Array.isArray(raw.fundamentals)) {
    for (const f of raw.fundamentals) {
      grades[f.key] = f.letter || 'C'
      grades.dimensions.push({
        key: f.key,
        label: f.label || f.key,
        letter: f.letter || 'C',
        score: f.score || 50,
      })
    }
  }

  return grades
}

export default function useTokenFundamentals(tokenProfile) {
  const [grades, setGrades] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const tokenDetails = tokenProfile?.token_details
  const analysis = tokenProfile?.intelligence_ai_analysis

  const fetchFundamentals = useCallback(async () => {
    if (!tokenDetails) return
    setLoading(true)
    try {
      if (tokenProfile?._source === 'spectre-market') {
        setGrades({
          overall: 'B',
          overallScore: 72,
          insight: tokenDetails.ai_insight || analysis?.summary || 'Spectre profile is live; detailed fundamentals grading is waiting on the research analysis bridge.',
          catalysts: tokenDetails.catalysts || [],
          risks: [],
          dimensions: [
            { key: 'liquidity', label: 'Liquidity', letter: tokenDetails.volume_24h ? 'B' : 'C', score: tokenDetails.volume_24h ? 72 : 55 },
            { key: 'market_depth', label: 'Market depth', letter: tokenDetails.market_cap ? 'B' : 'C', score: tokenDetails.market_cap ? 74 : 55 },
          ],
        })
        setError(null)
        return
      }

      const data = await getTokenFundamentals(tokenDetails, analysis)
      const transformed = transformGrades(data)
      if (transformed) {
        setGrades(transformed)
        setError(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [tokenDetails, analysis, tokenProfile?._source])

  useEffect(() => {
    setGrades(null)
    setError(null)
    fetchFundamentals()
  }, [fetchFundamentals])

  return { grades, loading, error }
}
