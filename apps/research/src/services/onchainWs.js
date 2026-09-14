/**
 * Spectre Onchain WebSocket Client
 *
 * Connects directly to our api-eth WebSocket for real-time data.
 * Supports subscriptions for: swaps, volume, holdersChart, price, ohlcv
 *
 * Usage:
 *   import { onchainWs, useOnchainStream } from './onchainWs';
 *
 *   // React hook (auto subscribe/unsubscribe)
 *   const { data, isConnected } = useOnchainStream('swaps', {
 *     chainId: 1, poolAddress: '0x...', from: '...', to: '...'
 *   });
 *
 *   // Manual
 *   const unsub = onchainWs.subscribe('swaps', {...}, (msg) => console.log(msg));
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// WebSocket URL — connect directly to api-eth (not proxied)
const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3012/ws'
  : 'wss://onchain.spectreai.io/ws';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 25000;

// ═══════════════════════════════════════════════════════════════════════════════
// WebSocket Manager (singleton)
// ═══════════════════════════════════════════════════════════════════════════════

class OnchainWebSocket {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;

    // topic -> Set<callback>
    this.subscriptions = new Map();
    // topic -> params (for resubscribe on reconnect)
    this.topicParams = new Map();
    // Listeners for connection state changes
    this.stateListeners = new Set();
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_URL);
    } catch (err) {
      console.warn('[onchain-ws] Failed to create WebSocket:', err.message);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this._notifyStateChange();
      this._startHeartbeat();
      // Resubscribe all topics
      for (const [topic, params] of this.topicParams.entries()) {
        this._send({ action: 'subscribe', ...params });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'snapshot' || msg.type === 'update') {
          const topic = msg.topic;
          const callbacks = this.subscriptions.get(topic);
          if (callbacks) {
            for (const cb of callbacks) {
              try { cb(msg); } catch (err) { console.warn('[onchain-ws] Callback error:', err); }
            }
          }
        }
      } catch (err) {
        // Ignore parse errors (heartbeat pongs, etc.)
      }
    };

    this.ws.onclose = (event) => {
      this.isConnected = false;
      this._stopHeartbeat();
      this._notifyStateChange();
      this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  /**
   * Subscribe to a topic.
   * @param {string} kind - swaps | volume | holdersChart | price | ohlcv
   * @param {object} params - { chainId, poolAddress, ... }
   * @param {function} callback - Called with { type, topic, data }
   * @returns {function} Unsubscribe function
   */
  subscribe(kind, params, callback) {
    // Ensure connected
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
    }

    const fullParams = { ...params, kind };
    // Generate topic key matching server format
    const topic = this._topicKey(fullParams);

    // Register callback
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic).add(callback);
    this.topicParams.set(topic, fullParams);

    // Send subscribe message
    this._send({ action: 'subscribe', ...fullParams });

    // Return unsubscribe function
    return () => {
      const cbs = this.subscriptions.get(topic);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
          this.subscriptions.delete(topic);
          this.topicParams.delete(topic);
          this._send({ action: 'unsubscribe', ...fullParams });
        }
      }
    };
  }

  onStateChange(listener) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  destroy() {
    this._stopHeartbeat();
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.subscriptions.clear();
    this.topicParams.clear();
  }

  // Internal helpers

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _topicKey(params) {
    const kind = params.kind;
    const chainId = params.chainId || '';
    if (kind === 'swaps') {
      return `swaps|${chainId}|${(params.poolAddress || '').toLowerCase()}|${(params.maker || '').toLowerCase()}`;
    }
    if (kind === 'volume') {
      return `volume|${chainId}|${(params.poolAddress || '').toLowerCase()}|${params.timeframe || 'hour'}`;
    }
    if (kind === 'holdersChart') {
      return `holders|${chainId}|${(params.tokenAddress || '').toLowerCase()}|${params.bucket || '1h'}`;
    }
    if (kind === 'price') {
      return `price|${chainId}|${(params.tokenAddresses || []).sort().join(',')}`;
    }
    if (kind === 'ohlcv') {
      return `ohlcv|${chainId}|${(params.poolAddress || '').toLowerCase()}|${params.interval || '1m'}`;
    }
    return `unknown|${JSON.stringify(params)}`;
  }

  _scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts), RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // Skip ping when the tab is hidden — server keeps the socket alive on its
      // side, and a hidden tab firing every 25s wakes the CPU for nothing.
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // The server uses ws ping/pong; we just check if still connected
        try { this.ws.send('ping'); } catch { /* ignore */ }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    clearInterval(this.heartbeatTimer);
  }

  _notifyStateChange() {
    for (const listener of this.stateListeners) {
      try { listener(this.isConnected); } catch { /* ignore */ }
    }
  }
}

// Singleton
export const onchainWs = new OnchainWebSocket();

// ═══════════════════════════════════════════════════════════════════════════════
// React Hook
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Subscribe to a real-time stream.
 *
 * @param {string} kind - swaps | volume | holdersChart | price | ohlcv
 * @param {object} params - Subscription params (chainId, poolAddress, etc.)
 * @param {boolean} enabled - Whether to subscribe (default true)
 * @returns {{ data: any[], snapshot: any[], isConnected: boolean, error: string|null }}
 */
export function useOnchainStream(kind, params, enabled = true) {
  const [data, setData] = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [isConnected, setIsConnected] = useState(onchainWs.isConnected);
  const [error, setError] = useState(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Track connection state
  useEffect(() => {
    return onchainWs.onStateChange(setIsConnected);
  }, []);

  // Subscribe/unsubscribe
  useEffect(() => {
    if (!enabled || !kind || !params) return;

    // Validate required params
    if (kind === 'swaps' && (!params.poolAddress || !params.chainId)) return;
    if (kind === 'volume' && (!params.poolAddress || !params.chainId)) return;
    if (kind === 'holdersChart' && (!params.tokenAddress || !params.chainId)) return;
    if (kind === 'price' && (!params.tokenAddresses?.length || !params.chainId)) return;
    if (kind === 'ohlcv' && (!params.poolAddress || !params.chainId)) return;

    setError(null);

    const unsub = onchainWs.subscribe(kind, params, (msg) => {
      if (msg.type === 'snapshot') {
        setSnapshot(msg.data || []);
        setData(msg.data || []);
      } else if (msg.type === 'update') {
        setData(prev => {
          // For swaps: prepend new trades
          if (kind === 'swaps') {
            const combined = [...(msg.data || []), ...prev];
            return combined.slice(0, 200); // Keep max 200
          }
          // For volume/holders: replace entirely (full dataset each time)
          return msg.data || [];
        });
      } else if (msg.type === 'error') {
        setError(msg.error || 'Unknown error');
      }
    });

    return unsub;
  }, [kind, JSON.stringify(params), enabled]);

  return { data, snapshot, isConnected, error };
}

/**
 * Hook for real-time swap feed.
 */
export function useRealtimeSwaps(poolAddress, chainId, enabled = true) {
  const now = new Date().toISOString();
  const params = poolAddress ? {
    chainId,
    poolAddress,
    from: new Date(Date.now() - 86400000).toISOString(), // last 24h
    to: now,
    limit: 50,
  } : null;

  return useOnchainStream('swaps', params, enabled && !!poolAddress);
}

/**
 * Hook for real-time volume updates.
 */
export function useRealtimeVolume(poolAddress, chainId, timeframe = 'hour', enabled = true) {
  const params = poolAddress ? {
    chainId,
    poolAddress,
    timeframe,
    from: new Date(Date.now() - 7 * 86400000).toISOString(),
    to: new Date().toISOString(),
    limit: 168,
  } : null;

  return useOnchainStream('volume', params, enabled && !!poolAddress);
}

/**
 * Hook for real-time holder count chart.
 */
export function useRealtimeHolders(tokenAddress, chainId, bucket = '1h', enabled = true) {
  const params = tokenAddress ? {
    chainId,
    tokenAddress,
    bucket,
  } : null;

  return useOnchainStream('holdersChart', params, enabled && !!tokenAddress);
}

/**
 * Hook for real-time price ticker.
 * Subscribes to batch price updates (5s interval).
 * @param {string[]} tokenAddresses - Up to 50 token addresses
 * @param {number} chainId
 * @returns {{ data: PriceRow[], isConnected, error }}
 */
export function useRealtimePrice(tokenAddresses, chainId, enabled = true) {
  const params = tokenAddresses?.length ? {
    chainId,
    tokenAddresses: tokenAddresses.map(a => a.toLowerCase()),
  } : null;

  return useOnchainStream('price', params, enabled && !!tokenAddresses?.length);
}

/**
 * Hook for real-time OHLCV candle updates.
 * Subscribes to live candle updates (5s poll).
 * @param {string} poolAddress
 * @param {number} chainId
 * @param {string} interval - 1s|30s|1m|5m|15m|1h|4h|1d
 * @returns {{ data: CandleRow[], isConnected, error }}
 */
export function useRealtimeOhlcv(poolAddress, chainId, interval = '1m', enabled = true) {
  const params = poolAddress ? {
    chainId,
    poolAddress: poolAddress.toLowerCase(),
    interval,
  } : null;

  return useOnchainStream('ohlcv', params, enabled && !!poolAddress);
}
