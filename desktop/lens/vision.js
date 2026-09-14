'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a financial screen analyzer for Spectre AI.
Analyze this screenshot and extract any visible crypto token or stock being viewed.

Return ONLY valid JSON, no prose, no markdown, no code fences:
{
  "symbol":    "TOKEN ticker if visible, null if not",
  "name":      "Project name if visible, null if not",
  "address":   "Contract address if visible, null if not",
  "chain":     "blockchain if detectable: ethereum/solana/bsc/base/arbitrum, null if not",
  "price":     price as number if visible or null,
  "change24h": 24h change as number if visible or null,
  "platform":  "dexscreener/tradingview/binance/coinbase/coinmarketcap/coingecko/twitter/other",
  "assetType": "crypto or stock",
  "isOnTradingView": true or false,
  "currentSymbol": "chart ticker if on TradingView, null if not",
  "timeframe": "chart timeframe if on TradingView: 1m/5m/15m/1H/4H/1D/1W, null if not",
  "confidence": "high/medium/low"
}

Rules:
- If multiple tokens visible, return the most prominent one (largest, centered, in focus)
- For stocks: symbol is the ticker (AAPL, NVDA etc)
- If nothing financial is on screen: return { "symbol": null, "name": null, "platform": "other", "confidence": "low" }
- Never fabricate data. If unclear, return null for that field.`;

async function extractTokenContext(base64Image) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: base64Image }
        },
        { type: 'text', text: SYSTEM_PROMPT }
      ]
    }]
  });

  const raw     = response.content[0].text.trim();
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return { symbol: null, name: null, platform: 'unknown', confidence: 'low' };
  }
}

module.exports = { extractTokenContext };
