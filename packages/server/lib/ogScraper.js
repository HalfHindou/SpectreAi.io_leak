/**
 * OG Image Scraper — extracts og:image meta tags from article URLs.
 * Used by the news writer agent to fetch real hero images from source sites
 * (CoinDesk, Bloomberg, Reuters, etc.) instead of generating SVG fallbacks.
 *
 * Also provides scrapeReutersImage() to find editorial-quality Reuters photos
 * for a given topic (e.g. "bitcoin", "crypto market crash").
 */
const fetch = require('node-fetch');

/**
 * Scrape the og:image URL from a web page.
 * @param {string} url - The source article URL
 * @param {number} [timeoutMs=5000] - Request timeout
 * @returns {Promise<string|null>} The og:image URL or null
 */
async function scrapeOgImage(url, timeoutMs = 5000) {
  if (!url || typeof url !== 'string') return null;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });

    if (!res.ok) return null;

    // Only read first 50KB — og:image is always in <head>
    const html = await res.text();
    const head = html.slice(0, 50000);

    // Match both attribute orderings:
    //   <meta property="og:image" content="URL" />
    //   <meta content="URL" property="og:image" />
    const match =
      head.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

    if (!match?.[1]) return null;

    let imgUrl = match[1].replace(/&amp;/g, '&').trim();

    // Resolve relative URLs
    if (imgUrl.startsWith('/')) {
      try {
        imgUrl = new URL(imgUrl, url).href;
      } catch { return null; }
    }

    // Validate
    if (!imgUrl.startsWith('http')) return null;

    console.log(`[og-scraper] Found image for ${url.slice(0, 60)}: ${imgUrl.slice(0, 80)}`);
    return imgUrl;
  } catch (e) {
    // Timeout, network error, etc. — fail silently
    console.warn(`[og-scraper] Failed for ${url?.slice(0, 60)}: ${e.message}`);
    return null;
  }
}

/**
 * Search Reuters for an editorial photo related to a topic.
 * Scrapes the og:image from a Reuters search result page.
 * @param {string} query - Search terms (e.g. "bitcoin crash", "crypto regulation")
 * @param {number} [timeoutMs=5000] - Request timeout
 * @returns {Promise<string|null>} Reuters photo URL or null
 */
async function scrapeReutersImage(query, timeoutMs = 5000) {
  if (!query || typeof query !== 'string') return null;

  try {
    // Search Reuters for the topic and scrape the first article's og:image
    const searchUrl = `https://www.reuters.com/site-search/?query=${encodeURIComponent(query)}&offset=0`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Reuters search results have article links — find the first article URL
    const articleMatch = html.match(/href="(\/[a-z-]+\/[a-z-]+\/[^"]+\d{4}-\d{2}-\d{2}[^"]*)"/i) ||
      html.match(/href="(\/[a-z-]+\/[^"]+\/[^"]+)"/i);

    if (!articleMatch?.[1]) return null;

    const articleUrl = `https://www.reuters.com${articleMatch[1]}`;

    // Now scrape the og:image from that article
    const ogImage = await scrapeOgImage(articleUrl, timeoutMs);
    if (ogImage) {
      console.log(`[og-scraper] Reuters image found for "${query}": ${ogImage.slice(0, 80)}`);
    }
    return ogImage;
  } catch (e) {
    console.warn(`[og-scraper] Reuters search failed for "${query}": ${e.message}`);
    return null;
  }
}

module.exports = { scrapeOgImage, scrapeReutersImage };
