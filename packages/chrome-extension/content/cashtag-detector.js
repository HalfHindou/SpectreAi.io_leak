/**
 * Spectre AI — Cashtag Detector
 * Detects $TICKER patterns in X's DOM and attaches Spectre overlays
 */

// Selectors that match X's cashtag rendering
const CASHTAG_SELECTORS = [
  'a[href*="/search?q=%24"]',
  'a[href*="/search?q=$"]',
  '[data-testid="cashtag"]',
  'a.cashtag',
];

const COMBINED_SELECTOR = CASHTAG_SELECTORS.join(', ');
const PROCESSED_ATTR = 'data-spectre-processed';

/**
 * Extract ticker from a cashtag element
 */
function extractTicker(element) {
  // From href: /search?q=%24BTC → BTC
  const href = element.getAttribute('href') || '';
  const hrefMatch = href.match(/[?&]q=%24([A-Za-z0-9]+)/);
  if (hrefMatch) return hrefMatch[1].toUpperCase();

  // Alternative encoding
  const hrefMatch2 = href.match(/[?&]q=\$([A-Za-z0-9]+)/);
  if (hrefMatch2) return hrefMatch2[1].toUpperCase();

  // From text content: $BTC → BTC
  const text = element.textContent.trim();
  const textMatch = text.match(/^\$([A-Za-z0-9]+)$/);
  if (textMatch) return textMatch[1].toUpperCase();

  return null;
}

/**
 * Process a single cashtag element
 */
function processCashtag(element, onCashtagFound) {
  if (element.hasAttribute(PROCESSED_ATTR)) return;

  const ticker = extractTicker(element);
  if (!ticker) return;

  // Mark as processed
  element.setAttribute(PROCESSED_ATTR, ticker);

  // Add Spectre visual treatment
  element.style.position = 'relative';

  // Call handler
  onCashtagFound(element, ticker);
}

/**
 * Scan the page for all cashtag elements
 */
function scanPage(onCashtagFound) {
  const elements = document.querySelectorAll(COMBINED_SELECTOR);
  elements.forEach(el => processCashtag(el, onCashtagFound));
}

/**
 * Start watching for new cashtags (infinite scroll, new tweets)
 */
function startObserver(onCashtagFound) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Check if the added node itself is a cashtag
        if (node.matches?.(COMBINED_SELECTOR)) {
          processCashtag(node, onCashtagFound);
        }

        // Check children of added node
        const cashtags = node.querySelectorAll?.(COMBINED_SELECTOR);
        if (cashtags) {
          cashtags.forEach(el => processCashtag(el, onCashtagFound));
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return observer;
}

export { scanPage, startObserver, extractTicker };
