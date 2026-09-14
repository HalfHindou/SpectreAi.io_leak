/**
 * Spectre AI — TradingView Bridge
 * Content script injected into TradingView pages.
 * Receives SPECTRE_TV_CMD messages from the Lens desktop overlay
 * (sent via AppleScript → window.postMessage) and executes
 * drawing / indicator / alert actions on the chart.
 */

(() => {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────

  /** Small delay for UI settling */
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /** Simulate a keyboard event on a target element */
  function simulateKey(el, key, opts = {}) {
    const base = { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...opts };
    el.dispatchEvent(new KeyboardEvent('keydown', base));
    el.dispatchEvent(new KeyboardEvent('keyup', base));
  }

  /** Click an element by selector, with optional retries */
  async function clickEl(selector, retries = 3) {
    for (let i = 0; i < retries; i++) {
      const el = document.querySelector(selector);
      if (el) { el.click(); return true; }
      await sleep(200);
    }
    return false;
  }

  /** Type text into the currently focused input */
  async function typeText(text) {
    for (const char of text) {
      document.execCommand('insertText', false, char);
      await sleep(30);
    }
  }

  /** Get TradingView's chart widget iframe (or main body) */
  function getChartContainer() {
    // TradingView can be embedded or standalone
    return document.querySelector('.chart-container') ||
           document.querySelector('#tv-chart-container') ||
           document.querySelector('[class*="chart"]') ||
           document.body;
  }

  // ── Command Handlers ─────────────────────────────────────────

  /**
   * Add an indicator via TradingView's search
   * Opens the indicator panel with '/', types name, presses Enter
   */
  async function addIndicator(params) {
    const indicator = params.indicator || params.name;
    if (!indicator) return { ok: false, error: 'No indicator specified' };

    const chart = getChartContainer();

    // Open indicator search with '/'
    simulateKey(chart, '/', { code: 'Slash' });
    await sleep(400);

    // Find the search input
    const searchInput = document.querySelector('[data-name="indicators-search"]') ||
                        document.querySelector('input[placeholder*="Search"]') ||
                        document.querySelector('.tv-search-row input') ||
                        document.querySelector('[class*="searchInput"]');

    if (searchInput) {
      searchInput.focus();
      searchInput.value = '';
      // Use native input event for React-controlled inputs
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSet.call(searchInput, indicator);
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(600);

      // Click first result
      const firstResult = document.querySelector('[data-name="indicator-item"]') ||
                          document.querySelector('[class*="listItem"]') ||
                          document.querySelector('[class*="result"]');
      if (firstResult) {
        firstResult.click();
        await sleep(200);
      } else {
        // Fallback: press Enter
        simulateKey(searchInput, 'Enter', { code: 'Enter' });
      }

      // Close the dialog
      simulateKey(document.body, 'Escape', { code: 'Escape' });
    }

    return { ok: true, action: 'addIndicator', indicator };
  }

  /**
   * Draw a horizontal line at a specific price
   * Uses TradingView's Alt+H shortcut or drawing toolbar
   */
  async function drawHorizontalLine(params) {
    const price = params.price;
    const label = params.type || 'line';

    const chart = getChartContainer();

    // Method 1: Try Alt+H for horizontal line tool
    simulateKey(chart, 'h', { code: 'KeyH', altKey: true });
    await sleep(300);

    // Check if the drawing toolbar activated
    const priceInput = document.querySelector('[class*="priceAxisLabel"]') ||
                       document.querySelector('input[name="price"]');

    if (price && priceInput) {
      priceInput.focus();
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSet.call(priceInput, String(price));
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      simulateKey(priceInput, 'Enter', { code: 'Enter' });
    }

    // Method 2: If Alt+H didn't work, try the drawing toolbar
    if (!priceInput) {
      // Look for the horizontal line in the drawing tools
      const drawBtn = document.querySelector('[data-name="drawHorzLine"]') ||
                      document.querySelector('[aria-label="Horizontal Line"]') ||
                      document.querySelector('[class*="horizontalLine"]');
      if (drawBtn) {
        drawBtn.click();
        await sleep(300);
      }
    }

    return { ok: true, action: 'drawLine', type: label, price };
  }

  /**
   * Draw a trend line (support / resistance)
   * Uses TradingView's Alt+T shortcut
   */
  async function drawTrendLine(params) {
    const chart = getChartContainer();
    simulateKey(chart, 't', { code: 'KeyT', altKey: true });
    await sleep(200);
    return { ok: true, action: 'drawTrendLine', type: params.type || 'trendline' };
  }

  /**
   * Draw fibonacci retracement
   * Uses TradingView's Alt+F shortcut
   */
  async function drawFibonacci() {
    const chart = getChartContainer();
    simulateKey(chart, 'f', { code: 'KeyF', altKey: true });
    await sleep(200);
    return { ok: true, action: 'drawFib' };
  }

  /**
   * Set a price alert
   * Uses TradingView's Alt+A shortcut
   */
  async function setAlert(params) {
    const price = params.price;
    const chart = getChartContainer();

    // Alt+A opens alert dialog
    simulateKey(chart, 'a', { code: 'KeyA', altKey: true });
    await sleep(500);

    if (price) {
      // Try to set the price in the alert dialog
      const priceInput = document.querySelector('[data-name="alert-price-input"]') ||
                         document.querySelector('.tv-alert-dialog input[type="number"]') ||
                         document.querySelector('[class*="alertPrice"] input');

      if (priceInput) {
        priceInput.focus();
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSet.call(priceInput, String(price));
        priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    return { ok: true, action: 'setAlert', price };
  }

  /**
   * Draw Monday/Weekly open horizontal line at a specific price
   */
  async function drawPriceLine(params) {
    const price = params.price;
    if (!price) return { ok: false, error: 'No price available' };

    // Try to use TradingView's API to add a horizontal line
    // TradingView exposes widget API on some pages
    const widget = window.TradingView?.widget ||
                   window.tvWidget ||
                   document.querySelector('iframe')?.contentWindow?.TradingView?.widget;

    if (widget && typeof widget.activeChart === 'function') {
      try {
        const chart = widget.activeChart();
        chart.createShape(
          { time: Date.now() / 1000, price },
          { shape: 'horizontal_line', lock: false, disableSelection: false,
            overrides: { linecolor: '#8b5cf6', linewidth: 1, linestyle: 2,
                         showLabel: true, text: params.type || 'Monday Open' } }
        );
        return { ok: true, action: 'drawPriceLine', price, type: params.type };
      } catch (e) { /* fallback below */ }
    }

    // Fallback: use horizontal line tool
    return drawHorizontalLine({ price, type: params.type || 'mondayOpen' });
  }

  // ── Command Router ───────────────────────────────────────────

  async function handleCommand(payload) {
    const { action, params = {} } = payload;

    switch (action) {
      case 'addIndicator':
        return addIndicator(params);

      case 'drawLine':
        if (params.type === 'support' || params.type === 'resistance') {
          return drawTrendLine(params);
        }
        return drawHorizontalLine(params);

      case 'setAlert':
        return setAlert(params);

      case 'drawFib':
        return drawFibonacci();

      case 'mondayOpen':
      case 'weeklyOpen':
        return drawPriceLine({ ...params, type: action === 'mondayOpen' ? 'Monday Open' : 'Weekly Open' });

      default:
        return { ok: false, error: `Unknown action: ${action}` };
    }
  }

  // ── Message Listener ─────────────────────────────────────────

  window.addEventListener('message', async (event) => {
    // Only accept messages from this window (AppleScript injects here)
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'SPECTRE_TV_CMD') return;

    const payload = event.data.payload;
    if (!payload || !payload.action) return;

    console.log('[Spectre TV Bridge] Received command:', payload.action, payload.params);

    try {
      const result = await handleCommand(payload);
      console.log('[Spectre TV Bridge] Result:', result);

      // Post result back so Lens can confirm. Scope targetOrigin to the
      // current document's origin so third-party scripts loaded on the
      // TradingView page can't read command results via message events.
      window.postMessage({
        type: 'SPECTRE_TV_RESULT',
        payload: result,
      }, window.location.origin);
    } catch (err) {
      console.error('[Spectre TV Bridge] Error:', err.message);
      window.postMessage({
        type: 'SPECTRE_TV_RESULT',
        payload: { ok: false, error: err.message },
      }, window.location.origin);
    }
  });

  // ── Ready signal ─────────────────────────────────────────────
  console.log('[Spectre TV Bridge] Loaded on TradingView');
  window.postMessage({ type: 'SPECTRE_TV_READY' }, window.location.origin);

})();
