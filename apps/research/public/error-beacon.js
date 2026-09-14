;(function() {
  'use strict'

  // 2026-05-12 post-lockdown: skip beaconing entirely when the app is
  // rendered inside an iframe (e.g., the live demo iframe on spectreai.io
  // pointing at /embed/chart/:cgId, or the trading app embedded with
  // ?embedded=true in the research app). Two reasons:
  //   1. Cross-origin iframes can't send the dc_session cookie that
  //      dev-control's edge middleware now requires, so every POST to
  //      /api/errors fails CORS preflight — flooding visitors' consoles
  //      with red errors and leaking the dev-control URL in their
  //      network tab.
  //   2. Error reports from anonymous public-iframe contexts are not
  //      actionable for our team and would just inflate noise in the
  //      developer-control errors dashboard.
  // Authenticated team-member sessions on the real apps continue to
  // beacon normally because they're not in an iframe.
  try {
    if (typeof window !== 'undefined' && window.self !== window.top) return
  } catch (_) {
    // Cross-origin frame access threw — that's definitively an iframe context, so skip.
    return
  }

  var BEACON_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5182/api/errors'
    : 'https://developer-control.vercel.app/api/errors'

  var APP = window.location.port === '5181' || window.location.hostname === 'spectre-trading.vercel.app'
    ? 'trading' : 'research'

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

  // Read the load time AFTER the load event has finished, from Navigation
  // Timing Level 2 (already relative to navigationStart).
  // The old code read the deprecated `performance.timing` INSIDE the load
  // handler, where `loadEventEnd` is still 0, so it shipped
  // `0 - navigationStart` - an epoch-sized negative number, every time.
  // Caught on the trading twin by capturing a live beacon payload on prod:
  // "pageLoadTime": -1785411925513, matching that page's navigationStart to
  // the digit. Same bug here.
  window.addEventListener('load', function() {
    setTimeout(function() {
      try {
        var nav = performance.getEntriesByType('navigation')[0]
        if (nav && nav.loadEventEnd > 0) pageLoadTime = Math.round(nav.loadEventEnd)
      } catch (_) { /* leave at 0 */ }
    }, 0)
  })

  function flush() {
    // Nothing to report - don't send. Without this the beacon POSTed an empty
    // payload cross-origin every 60s AND on every tab hide, for the life of
    // every session. The counters are checked too because console.error with a
    // non-string first arg bumps them without buffering an entry; they keep
    // accumulating until a real flush.
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
      if (navigator.sendBeacon) {
        // text/plain skips the CORS preflight that application/json triggers.
        // Dev-control parses the body as JSON regardless of Content-Type.
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
