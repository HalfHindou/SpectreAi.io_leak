import { useState, useEffect, useRef } from 'react';
import { getDetailedTokenInfo } from '@/services/codexApi';
import { getTokenPrice as spectreGetTokenPrice } from '@/services/spectreDataApi';
import { isAppActive } from '@/lib/idleManager';
import {
  isWSUnavailable,
  getWS,
  getWSInstance,
  wsListeners,
} from './_shared';

/**
 * Hook: subscribe to real-time price updates for a token.
 *
 * 2026-05-08 cost migration:
 *   - Per-address shared subscriber map (one timer per token regardless of N renderers)
 *   - Source priority: Spectre Data API → Codex (last resort)
 *   - Default poll interval bumped 10s → 30s
 *   - Visibility + focus gating
 *   - `enabled` flag (callers can gate off-screen via IntersectionObserver)
 *
 * Strategy:
 *   1. Try WebSocket (localhost dev only — instant updates)
 *   2. REST fallback: shared per-address poller, 30s interval, free Spectre source first
 *
 * Returns { livePrice, liveChange, liveVolume, connected }
 */

const POLL_MS = 30_000; // was 10_000

// Shared subscriber registry — one poller per address
const _pollers = new Map(); // key: `${address}_${networkId}` → { interval, listeners: Set, lastData }

function _scheduleFetch(key, address, networkId) {
  const entry = _pollers.get(key);
  if (!entry) return;
  if (document.hidden || !isAppActive()) return;
  if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) return;

  // Source priority: Spectre Data API → Codex
  // Spectre serves CG-listed tokens by symbol; address-only tokens fall through to Codex.
  (async () => {
    try {
      // Try Spectre first if we have a symbol-like identifier (skip for raw addresses)
      let info = null;
      if (entry.symbolHint) {
        const sp = await spectreGetTokenPrice(entry.symbolHint).catch(() => null);
        if (sp && (sp.price != null || sp.usd != null)) {
          info = {
            price: sp.price ?? sp.usd ?? null,
            priceUSD: sp.price ?? sp.usd ?? null,
            change24: sp.change24h ?? sp.usd_24h_change ?? sp.change ?? null,
            volume24: sp.volume24h ?? sp.usd_24h_vol ?? null,
          };
        }
      }
      if (!info) {
        // Codex fallback (cost: counts against quota)
        info = await getDetailedTokenInfo(address, networkId);
      }
      if (info) {
        const next = {
          price: info.price ?? info.priceUSD ?? null,
          change: info.change24 != null ? info.change24 : (info.change ?? null),
          volume: info.volume24 ?? info.volume ?? null,
        };
        entry.lastData = next;
        for (const listener of entry.listeners) listener(next);
      }
    } catch (_err) {
      // silent — keep last known data
    }
  })();
}

function _ensurePoller(key, address, networkId, symbolHint) {
  let entry = _pollers.get(key);
  if (entry) return entry;
  entry = {
    interval: null,
    listeners: new Set(),
    lastData: null,
    address,
    networkId,
    symbolHint: symbolHint || null,
  };
  _pollers.set(key, entry);
  // Immediate fetch + interval
  _scheduleFetch(key, address, networkId);
  entry.interval = setInterval(() => _scheduleFetch(key, address, networkId), POLL_MS);
  return entry;
}

function _stopPoller(key) {
  const entry = _pollers.get(key);
  if (!entry) return;
  if (entry.listeners.size > 0) return;
  if (entry.interval) clearInterval(entry.interval);
  _pollers.delete(key);
}

export function useRealtimePrice(address, networkId = 1, options = {}) {
  const { enabled = true, symbolHint = null } = options;
  const [data, setData] = useState({ price: null, change: null, volume: null });
  const [connected, setConnected] = useState(false);

  // REST polling — shared subscriber registry
  useEffect(() => {
    if (!address) return;
    if (!enabled) return;
    if (!isWSUnavailable()) return; // WS path will handle it

    const key = `${address.toLowerCase()}_${networkId}`;
    const entry = _ensurePoller(key, address, networkId, symbolHint);

    const listener = (next) => {
      setData(next);
      setConnected(true);
    };
    entry.listeners.add(listener);
    // Seed immediately if cached
    if (entry.lastData) listener(entry.lastData);

    return () => {
      entry.listeners.delete(listener);
      _stopPoller(key);
    };
  }, [address, networkId, enabled, symbolHint]);

  // WebSocket path (only for local dev)
  useEffect(() => {
    if (!address) return;
    if (!enabled) return;
    if (isWSUnavailable()) return;

    const key = `${address.toLowerCase()}_${networkId}`;
    const ws = getWS();
    if (!ws) return;

    const handler = (msg) => {
      setData({ price: msg.price, change: msg.change, volume: msg.volume });
      setConnected(true);
    };

    if (!wsListeners.has(key)) wsListeners.set(key, new Set());
    wsListeners.get(key).add(handler);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', address, networkId }));
    }

    return () => {
      const listeners = wsListeners.get(key);
      if (listeners) {
        listeners.delete(handler);
        if (listeners.size === 0) {
          wsListeners.delete(key);
          const inst = getWSInstance();
          if (inst && inst.readyState === WebSocket.OPEN) {
            inst.send(JSON.stringify({ type: 'unsubscribe', address, networkId }));
          }
        }
      }
    };
  }, [address, networkId, enabled]);

  return { livePrice: data.price, liveChange: data.change, liveVolume: data.volume, connected };
}
