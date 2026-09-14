/**
 * useInsight - fetches AI-generated insight for a metric.
 * Only fires when `enabled` is true (tooltip is open).
 * Caches responses per metric+value+token combination.
 * AbortController cancels in-flight requests on unmount or re-fire.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { getCachedInsight, setCachedInsight, buildCacheKey } from './insightCache';
import { getMetricInfo } from './insightTypes';

export default function useInsight({
  metricType,
  metricValue,
  metricLabel,
  tokenSymbol,
  sector,
  timeframe,
  additionalContext,
  enabled = false,
}) {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const fetchInsight = useCallback(async () => {
    if (!metricType || metricValue == null) return;

    const cacheKey = buildCacheKey({ metricType, metricValue, tokenSymbol, sector });
    const cached = getCachedInsight(cacheKey);
    if (cached) {
      setInsight(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Try Spectre Data API first (real backtested patterns, no LLM)
      let insight = null;
      try {
        const params = new URLSearchParams({ metric_key: metricType });
        if (metricValue != null) params.set('value', String(metricValue));
        if (tokenSymbol) params.set('asset', tokenSymbol);
        const dataRes = await fetch(`/data-api/v1/metrics/insight?${params}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (dataRes.ok) {
          const dataJson = await dataRes.json();
          if (dataJson.data && dataJson.data.sampleSize > 0) {
            insight = {
              label: metricLabel || metricType,
              title: dataJson.data.patternText?.split('.')[0] || `${metricType} Pattern`,
              body: dataJson.data.patternText || '',
              historical: dataJson.data.hitRate != null
                ? `Hit rate: ${dataJson.data.hitRate}% across ${dataJson.data.sampleSize} occurrences. Avg 7d return: ${dataJson.data.avgReturn7d > 0 ? '+' : ''}${dataJson.data.avgReturn7d?.toFixed(1)}%. Confidence: ${dataJson.data.confidence}.`
                : null,
              actions: dataJson.data.actions || [],
            };
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        // Data API unavailable, fall through to Groq
      }

      // Fallback to Groq LLM if data API returned nothing
      if (!insight) {
        const res = await fetch('/api/insight', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metricType,
            metricValue,
            metricLabel,
            context: { tokenSymbol, sector, timeframe, additionalContext },
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.insight) insight = data.insight;
      }

      if (insight) {
        const info = getMetricInfo(metricType);
        setCachedInsight(cacheKey, insight, info.cacheTTL);
        setInsight(insight);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [metricType, metricValue, metricLabel, tokenSymbol, sector, timeframe, additionalContext]);

  useEffect(() => {
    if (enabled) fetchInsight();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [enabled, fetchInsight]);

  return { insight, loading, error, refetch: fetchInsight };
}
