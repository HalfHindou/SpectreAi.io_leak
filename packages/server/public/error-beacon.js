;(function() {
  'use strict'

  // Determine beacon endpoint based on current hostname
  var BEACON_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5182/api/errors'
    : 'https://spectre-developer-control.vercel.app/api/errors'

  // Detect which app this is
  var APP = window.location.port === '5181' || window.location.hostname === 'spectre-trading.vercel.app'
    ? 'trading' : 'research'

  var buffer = []
  var consoleErrorCount = 0
  var fetchFailCount = 0
  var pageLoadTime = 0

  // 1. Capture uncaught errors
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

  // 2. Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unknown rejection'
    buffer.push({
      type: 'rejection',
      message: String(msg).slice(0, 300),
      stack: e.reason && e.reason.stack ? String(e.reason.stack).slice(0, 500) : '',
      timestamp: Date.now()
    })
  })

  // 3. Count console.error calls
  var origConsoleError = console.error
  console.error = function() {
    consoleErrorCount++
    // Capture first arg as message if it's an error-like thing
    if (buffer.length < 50) {
      var msg = arguments[0]
      if (msg && typeof msg === 'string' && !msg.includes('DevTools') && !msg.includes('React DevTools')) {
        buffer.push({
          type: 'console',
          message: String(msg).slice(0, 300),
          timestamp: Date.now()
        })
      }
    }
    origConsoleError.apply(console, arguments)
  }

  // 4. Track failed fetch calls
  var origFetch = window.fetch
  window.fetch = function() {
    var url = arguments[0]
    if (typeof url === 'object') url = url.url || ''
    return origFetch.apply(window, arguments).then(function(res) {
      if (res.status >= 500) {
        fetchFailCount++
        if (buffer.length < 50) {
          buffer.push({
            type: 'fetch',
            message: 'HTTP ' + res.status + ' ' + String(url).split('?')[0].slice(0, 200),
            timestamp: Date.now()
          })
        }
      }
      return res
    }).catch(function(err) {
      fetchFailCount++
      if (buffer.length < 50 && !String(url).includes('/api/errors')) {
        buffer.push({
          type: 'fetch',
          message: 'Network error: ' + String(url).split('?')[0].slice(0, 200),
          timestamp: Date.now()
        })
      }
      throw err
    })
  }

  // 5. Measure page load time - AFTER the load event has finished, from
  //    Navigation Timing Level 2 (already relative to navigationStart).
  //    The old code read the deprecated `performance.timing` INSIDE the load
  //    handler, where `loadEventEnd` is still 0, so it shipped
  //    `0 - navigationStart`: an epoch-sized negative number, every time.
  //    Caught on the trading twin by capturing a live prod payload
  //    ("pageLoadTime": -1785411925513, = that page's navigationStart).
  window.addEventListener('load', function() {
    setTimeout(function() {
      try {
        var nav = performance.getEntriesByType('navigation')[0]
        if (nav && nav.loadEventEnd > 0) pageLoadTime = Math.round(nav.loadEventEnd)
      } catch (_) { /* leave at 0 */ }
    }, 0)
  })

  // 6. Send buffered errors every 60 seconds - but only when there IS something
  //    to send. Without the guard this POSTed an empty payload cross-origin
  //    every 60s and on every tab hide, for the life of every session.
  function flush() {
    if (buffer.length === 0 && consoleErrorCount === 0 && fetchFailCount === 0) return

    var errors = buffer.splice(0, 50)
    var payload = {
      app: APP,
      url: window.location.pathname,
      errors: errors,
      metrics: {
        consoleErrors: consoleErrorCount,
        fetchFails: fetchFailCount,
        pageLoadTime: pageLoadTime,
        errorRate: errors.length
      },
      timestamp: Date.now()
    }

    // Reset counters
    consoleErrorCount = 0
    fetchFailCount = 0

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(BEACON_URL, JSON.stringify(payload))
      } else {
        var xhr = new XMLHttpRequest()
        xhr.open('POST', BEACON_URL, true)
        xhr.setRequestHeader('Content-Type', 'application/json')
        xhr.send(JSON.stringify(payload))
      }
    } catch(e) {
      // Silent fail - never break the app
    }
  }

  setInterval(flush, 60000)

  // Also flush on page unload
  window.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') flush()
  })
})()
