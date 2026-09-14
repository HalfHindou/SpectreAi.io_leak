/**
 * Spectre Newsroom — News Writer Agent
 * Takes an RSS item and generates a 200-500 word news brief using Perplexity sonar-pro.
 * Extracts sentiment, category, and tickers from structured footer.
 */
const fetch = require('node-fetch');
const { saveArticle } = require('../content/store');
const { logAgentActivity } = require('./activityLog');
const { generateArticleImage } = require('./imageGenerator');
const { gatedPerplexitySearch } = require('./perplexityGate');
const { scrapeOgImage, scrapeReutersImage } = require('../lib/ogScraper');

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';

const SYSTEM_PROMPT = `You are Spectre AI's newsroom writer. Write fast, sharp crypto news briefs. Professional financial journalism tone — like Bloomberg or CoinDesk. Write as "we" (Spectre AI).

Rules:
- 200-500 words, tight and punchy
- Lead with the most important fact
- Include specific numbers, prices, percentages
- Bold key tickers like **BTC**, **ETH**
- No fluff, no speculation beyond data
- One clear takeaway for traders
- Use ## for a single headline at top
- Do NOT use ### subheadings. This is a news brief, not an essay
- NO em-dashes anywhere. Split sentences or use commas/colons instead
- Paragraphs: maximum 3 sentences
- Do NOT place [1][2][3] citation markers in body text. Write clean prose
- Banned phrases: "delve into", "it's worth noting", "navigate", "landscape", "cutting-edge", "robust", "leverage" (as a verb), "seamlessly", "groundbreaking", "revolutionize", "transformative", "deep dive", "ever-evolving", "a testament to", "double-edged sword", "remains to be seen"

CRITICAL: End your article with this EXACT structured footer on separate lines:
SENTIMENT: bullish|bearish|neutral
CONFIDENCE: 1-10
CATEGORY: bitcoin|ethereum|defi|nft|regulation|exchange|stablecoin|layer1|layer2|gaming|ai|macro|general
TICKERS: BTC,ETH,SOL (comma-separated, uppercase, only relevant ones)

The footer must appear AFTER the article content, separated by a blank line.`;

const VALID_SENTIMENTS = ['bullish', 'bearish', 'neutral'];
const VALID_CATEGORIES = [
  'bitcoin', 'ethereum', 'defi', 'nft', 'regulation', 'exchange',
  'stablecoin', 'layer1', 'layer2', 'gaming', 'ai', 'macro', 'general',
];

/**
 * Parse the structured footer from the article content.
 * Returns { content, sentiment, sentimentScore, category, tickers }
 */
function parseFooter(rawContent) {
  const lines = rawContent.split('\n');
  const result = {
    content: rawContent,
    sentiment: 'neutral',
    sentimentScore: 5,
    category: 'general',
    tickers: [],
  };

  // Find footer lines (last 10 lines)
  const footerStart = Math.max(0, lines.length - 10);
  const footerLines = [];
  let contentEndIdx = lines.length;

  for (let i = footerStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^SENTIMENT:\s*/i.test(line)) {
      const val = line.replace(/^SENTIMENT:\s*/i, '').trim().toLowerCase();
      if (VALID_SENTIMENTS.includes(val)) result.sentiment = val;
      if (contentEndIdx === lines.length) contentEndIdx = i;
      footerLines.push(i);
    } else if (/^CONFIDENCE:\s*/i.test(line)) {
      const val = parseInt(line.replace(/^CONFIDENCE:\s*/i, '').trim());
      if (val >= 1 && val <= 10) result.sentimentScore = val;
      if (contentEndIdx === lines.length) contentEndIdx = i;
      footerLines.push(i);
    } else if (/^CATEGORY:\s*/i.test(line)) {
      const val = line.replace(/^CATEGORY:\s*/i, '').trim().toLowerCase();
      if (VALID_CATEGORIES.includes(val)) result.category = val;
      if (contentEndIdx === lines.length) contentEndIdx = i;
      footerLines.push(i);
    } else if (/^TICKERS:\s*/i.test(line)) {
      const val = line.replace(/^TICKERS:\s*/i, '').trim();
      result.tickers = val.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      if (contentEndIdx === lines.length) contentEndIdx = i;
      footerLines.push(i);
    }
  }

  // Strip footer from content
  if (footerLines.length > 0) {
    // Walk backward from contentEndIdx to skip blank lines
    while (contentEndIdx > 0 && lines[contentEndIdx - 1].trim() === '') {
      contentEndIdx--;
    }
    result.content = lines.slice(0, contentEndIdx).join('\n').trim();
  }

  return result;
}

/**
 * Generate a slug from a headline + timestamp.
 */
function generateSlug(headline) {
  const base = headline
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');
  const ts = Date.now().toString(36).slice(-4);
  return `${base}-${ts}`;
}

/**
 * Write a news brief from an RSS item.
 * @param {object} rssItem - { title, url, summary, source, publishedAt }
 * @param {object} opts - { isBreaking, isFeatured }
 * @returns {Promise<object|null>} Saved article or null on failure
 */
async function writeNewsBrief(rssItem, opts = {}) {
  const { isBreaking = false, isFeatured = false } = opts;
  const startTime = Date.now();

  const agentName = isBreaking ? 'breaking-news' : 'news-writer';

  logAgentActivity({
    agent: agentName,
    action: 'started',
    target: rssItem.title?.slice(0, 60),
    targetType: 'news',
    title: `Writing brief: ${rssItem.title?.slice(0, 80)}`,
  });

  try {
    if (!PERPLEXITY_API_KEY) {
      throw new Error('PERPLEXITY_API_KEY not set');
    }

    const userPrompt = `Write a Spectre AI news brief about this story:

Title: ${rssItem.title}
Source: ${rssItem.source}
Published: ${rssItem.publishedAt || 'just now'}
Summary: ${rssItem.summary || '(no summary)'}
URL: ${rssItem.url}

${isBreaking ? 'This is BREAKING NEWS — lead with urgency and impact.' : ''}

Research the latest details about this story and write a concise 200-500 word brief. Include relevant prices and market data if applicable. Remember to include the structured footer (SENTIMENT, CONFIDENCE, CATEGORY, TICKERS).`;

    const gateResult = await gatedPerplexitySearch({
      query: userPrompt,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 2000,
      model: 'sonar-pro',
      agentId: 'news-writer',
      timeout: 45000,
      searchContextSize: 'high',
      skipResolution: true, // news items don't need entity resolution on the RSS title
    });

    if (!gateResult || gateResult.type === 'ERROR') {
      throw new Error(gateResult?.error || 'All AI providers failed');
    }

    const rawContent = gateResult.content || '';
    // Filter out low-quality sources from Perplexity citations
    const BLOCKED_DOMAINS = ['wikipedia.org', 'youtube.com', 'reddit.com', 'twitter.com', 'x.com', 'facebook.com', 'tiktok.com', 'medium.com', 'substack.com'];
    const citations = (gateResult.citations || []).filter(url => {
      try {
        const host = new URL(url).hostname.toLowerCase();
        return !BLOCKED_DOMAINS.some(d => host.includes(d));
      } catch { return false; }
    });
    const data = { model: gateResult.model };

    if (!rawContent || rawContent.length < 50) {
      throw new Error('Empty or too-short response from Perplexity');
    }

    // Parse footer for sentiment, category, tickers
    const parsed = parseFooter(rawContent);
    const content = parsed.content;
    const wordCount = content.split(/\s+/).length;

    // Extract headline from first line — strip all markdown formatting
    const firstLine = content.split('\n').find(l => l.trim().length > 0) || '';
    const headline = firstLine.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/\*/g, '').trim().slice(0, 140) || rssItem.title;

    const slug = generateSlug(headline);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    // Scrape OG image from source, with Reuters fallback for editorial-quality photos
    let coverImage = rssItem.imageUrl || null;
    if (!coverImage && rssItem.url) {
      coverImage = await scrapeOgImage(rssItem.url).catch(() => null);
    }
    // For breaking news or when no image found, try Reuters for real journalism photos
    if (!coverImage && isBreaking) {
      const searchTerms = (parsed.tickers?.[0] || '') + ' ' + (headline.split(/[:\-–—|]/).shift() || '').trim();
      coverImage = await scrapeReutersImage(searchTerms.trim()).catch(() => null);
    }

    const article = saveArticle({
      slug,
      type: 'news',
      title: `${headline} | Spectre Intelligence`,
      headline,
      summary: content.replace(/[#*]/g, '').slice(0, 155).trim(),
      content,
      sentiment: parsed.sentiment,
      sentimentScore: parsed.sentimentScore,
      category: parsed.category,
      categories: [parsed.category],
      tickers: parsed.tickers,
      tags: ['news', parsed.category, ...(isBreaking ? ['breaking'] : [])],
      isBreaking,
      isFeatured: isFeatured || isBreaking,
      sourceArticle: {
        title: rssItem.title,
        url: rssItem.url,
        source: rssItem.source,
        publishedAt: rssItem.publishedAt,
        imageUrl: coverImage,
      },
      expiresAt,
      sourcesCited: citations,
      model: data.model || 'sonar-pro',
      generationTimeMs: Date.now() - startTime,
    });

    // Generate hero image in background (non-blocking)
    generateArticleImage(article).catch(() => {});

    logAgentActivity({
      agent: agentName,
      action: 'completed',
      target: parsed.tickers[0] || rssItem.source,
      targetType: 'news',
      title: headline,
      wordCount,
      sourceCount: citations.length,
      generationTimeMs: Date.now() - startTime,
      slug,
    });

    console.log(`[${agentName}] Generated "${headline}" (${wordCount} words, ${parsed.sentiment}, ${parsed.category}, ${Date.now() - startTime}ms)`);
    return article;
  } catch (e) {
    logAgentActivity({
      agent: agentName,
      action: 'failed',
      target: rssItem.title?.slice(0, 60),
      targetType: 'news',
      title: `Failed: ${e.message}`,
      error: e.message,
    });
    console.error(`[${agentName}] Failed for "${rssItem.title?.slice(0, 60)}":`, e.message);
    return null;
  }
}

module.exports = { writeNewsBrief, parseFooter, generateSlug };
