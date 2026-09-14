import { useState, useCallback, useRef } from 'react';

/**
 * SSE hook for Spectre Search.
 *
 * Connects to POST /api/search/query and processes the event stream:
 *   meta → data (N×) → citations_ready → text (N×) → related → done
 *
 * Returns a state object the UI renders from + a `run` function to trigger.
 *
 * Data events arrive BEFORE text — so the knowledge panel paints first,
 * then the LLM answer streams in. This is the "data-first paint" pattern.
 */

const INITIAL_STATE = {
  status: 'idle',       // idle | loading | streaming | done | error
  meta: null,           // { id, classification, assets, endpoints_planned, mode }
  slots: {},            // { price: {...}, technicals: {...}, institutional: {...}, ... }
  citations: [],        // [{ id, endpoint, label, latency_ms }]
  text: '',             // accumulated LLM answer text
  related: [],          // ["Is BTC overbought?", ...]
  done: null,           // { id, response_time_ms, endpoints_hit, tokens_used }
  error: null,          // error message string
};

export function useSearchStream() {
  const [state, setState] = useState(INITIAL_STATE);
  const abortRef = useRef(null);

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setState(INITIAL_STATE);
  }, []);

  const run = useCallback(async (query, { mode = 'quick', focus = 'all' } = {}) => {
    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...INITIAL_STATE,
      status: 'loading',
    });

    try {
      const res = await fetch('/api/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, mode, focus }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        setState((s) => ({ ...s, status: 'error', error: `HTTP ${res.status}: ${errBody.slice(0, 200)}` }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let accText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith('data: ')) continue;

          const raw = line.slice(6);

          if (currentEvent === 'text') {
            // Text events can be raw strings or JSON-encoded strings
            let textChunk;
            try {
              textChunk = JSON.parse(raw);
            } catch (_e) {
              textChunk = raw;
            }
            if (typeof textChunk === 'string') {
              accText += textChunk;
              setState((s) => ({ ...s, status: 'streaming', text: accText }));
            }
            continue;
          }

          // All other events are JSON objects
          let obj;
          try {
            obj = JSON.parse(raw);
          } catch (_e) {
            continue;
          }

          switch (currentEvent) {
            case 'meta':
              setState((s) => ({ ...s, status: 'loading', meta: obj }));
              break;

            case 'data':
              setState((s) => ({
                ...s,
                slots: { ...s.slots, [obj.slot]: obj.payload },
              }));
              break;

            case 'citations_ready':
              setState((s) => ({ ...s, citations: obj.citations || [] }));
              break;

            case 'related':
              setState((s) => ({ ...s, related: obj.questions || [] }));
              break;

            case 'done':
              setState((s) => ({ ...s, status: 'done', done: obj }));
              break;

            case 'error':
              setState((s) => ({ ...s, status: 'error', error: obj.message || 'Unknown error' }));
              break;

            default:
              break;
          }
        }
      }

      // If we got text but never got a done event, mark as done anyway
      setState((s) => {
        if (s.status === 'streaming') return { ...s, status: 'done' };
        return s;
      });
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, []);

  return { ...state, run, reset };
}
