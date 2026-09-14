;(function() {
  'use strict'

  // 2026-05-12 post-lockdown: skip beaconing entirely when the trading app
  // is rendered inside an iframe (e.g., embedded in research's /token
  // route via ?embedded=true, or future embeds on marketing surfaces).
  // Same rationale as the research-app beacon — cross-origin iframes
  // can't send the dc_session cookie that dev-control's edge middleware
  // requires, so every POST to /api/errors fails CORS preflight and
  // floods the parent's console with red errors. Authenticated team
  // sessions on the real trading app are unaffected (not in an iframe).
  try {
    if (typeof window !== 'undefined' && window.self !== window.top) return
  } catch (_) {
    // Cross-origin frame access threw — definitively an iframe context.
    return
  }

  var BEACON_URL = 'https://developer-control.vercel.app/api/errors'

  // This file is served ONLY by the trading app (apps/trading/public), so the
  // app name is a constant. It used to be sniffed:
  //   port === '5181' || hostname === 'spectre-trading.vercel.app' ? 'trading' : 'research'
  // Neither matches the real production host `trade.spectreai.io`, so every
  // beacon from prod trading was filed under 'research' in Developer Control -
  // verified live by capturing a payload on trade.spectreai.io ("app":"research").
  // Any error dashboard split by app has been mis-attributing trading to
  // research on the one host that actually carries users.
  var APP = 'trading'

  var buffer = []
  var consoleErrorCount = 0
  var fetchFailCount = 0
  var pageLoadTime = 0

  var origOnError = window.onerror
  window.onerror = function(msg, src, line, col, err) {
    buffer.push({
      type: 'uncaught',
      message: String(msg).slice(0, 300),
      source: String(src || '').split('/').pop(),
      line: line,
      stack: err && err.stack ? String(err.stack).slice(0, 500) : '',
      timestamp: Date.now()
    })
    if (origOnError) origOnError.apply(window, arguments)
  }

  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unknown rejection'
    buffer.push({
      type: 'rejection',
      message: String(msg).slice(0, 300),
      stack: e.reason && e.reason.stack ? String(e.reason.stack).slice(0, 500) : '',
      timestamp: Date.now()
    })
  })

  var origConsoleError = console.error
  console.error = function() {
    consoleErrorCount++
    if (buffer.length < 50) {
      var msg = arguments[0]
      if (msg && typeof msg === 'string' && !msg.includes('DevTools') && !msg.includes('React DevTools')) {
        buffer.push({ type: 'console', message: String(msg).slice(0, 300), timestamp: Date.now() })
      }
    }
    origConsoleError.apply(console, arguments)
  }

  var origFetch = window.fetch
  window.fetch = function() {
    var url = arguments[0]
    if (typeof url === 'object') url = url.url || ''
    return origFetch.apply(window, arguments).then(function(res) {
      if (res.status >= 500) {
        fetchFailCount++
        if (buffer.length < 50) {
          buffer.push({ type: 'fetch', message: 'HTTP ' + res.status + ' ' + String(url).split('?')[0].slice(0, 200), timestamp: Date.now() })
        }
      }
      return res
    }).catch(function(err) {
      fetchFailCount++
      if (buffer.length < 50 && !String(url).includes('/api/errors')) {
        buffer.push({ type: 'fetch', message: 'Network error: ' + String(url).split('?')[0].slice(0, 200), timestamp: Date.now() })
      }
      throw err
    })
  }

  // Read the load time AFTER the load event has finished, from the Navigation
  // Timing Level 2 entry (already relative to navigationStart).
  // The old code read the deprecated `performance.timing` INSIDE the load
  // handler, where `loadEventEnd` is still 0 - so it computed
  // `0 - navigationStart` and shipped an epoch-sized negative number. Captured
  // live on prod: "pageLoadTime": -1785411925513. It was never once correct.
  window.addEventListener('load', function() {
    setTimeout(function() {
      try {
        var nav = performance.getEntriesByType('navigation')[0]
        if (nav && nav.loadEventEnd > 0) pageLoadTime = Math.round(nav.loadEventEnd)
      } catch (_) { /* leave at 0 */ }
    }, 0)
  })

  function flush() {
    // Nothing to say - don't say it. Without this the beacon POSTed an empty
    // payload cross-origin every 60s AND on every tab hide, for the life of
    // every session. `consoleErrorCount`/`fetchFailCount` are checked too
    // because console.error with a non-string first arg bumps the counter
    // without buffering an entry; they keep accumulating until a real flush.
    if (buffer.length === 0 && consoleErrorCount === 0 && fetchFailCount === 0) return

    var errors = buffer.splice(0, 50)
    var payload = {
      app: APP,
      url: window.location.pathname,
      errors: errors,
      metrics: { consoleErrors: consoleErrorCount, fetchFails: fetchFailCount, pageLoadTime: pageLoadTime, errorRate: errors.length },
      timestamp: Date.now()
    }
    consoleErrorCount = 0
    fetchFailCount = 0
    try {
      var json = JSON.stringify(payload)
      // Use text/plain (CORS-safelisted) to skip the preflight that
      // application/json triggers on cross-origin POSTs. Without this,
      // every flush fails the preflight against developer-control.vercel.app
      // (which has Access-Control-Allow-Credentials unset) and spams CORS
      // errors in the user's console. The dev-control endpoint already
      // parses request bodies as JSON regardless of Content-Type, so the
      // payload still gets ingested correctly.
      if (navigator.sendBeacon) {
        var blob = new Blob([json], { type: 'text/plain;charset=UTF-8' })
        navigator.sendBeacon(BEACON_URL, blob)
      } else {
        var xhr = new XMLHttpRequest()
        xhr.open('POST', BEACON_URL, true)
        xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8')
        xhr.send(json)
      }
    } catch(e) {}
  }

  setInterval(flush, 60000)
  window.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') flush()
  })
})()
