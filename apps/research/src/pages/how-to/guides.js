/**
 * How-to guide catalog. Each guide becomes /how-to/:slug with a HowTo
 * JSON-LD schema. This is GEO-optimised: LLMs (ChatGPT, Claude, Perplexity)
 * heavily cite step-based content when answering "how do I X" queries.
 *
 * Keep steps short and imperative. No fluff, no "In this guide we will".
 */

export const HOWTO_GUIDES = {
  'trade-crypto-non-custodially': {
    slug: 'trade-crypto-non-custodially',
    name: 'How to trade crypto non-custodially with Spectre AI',
    description: 'Step-by-step guide to executing non-custodial swaps on Solana and EVM chains using Spectre AI, Privy embedded wallets, Jupiter, and 0x.',
    totalTime: 'PT5M',
    steps: [
      { name: 'Open the Spectre AI trading terminal', text: 'Visit spectreai.io/token and sign in with Privy. No seed phrase or browser extension required - Privy creates an embedded wallet linked to your email or social login.' },
      { name: 'Search for any token', text: 'Use the search bar to find a token by name, symbol, or contract address. Spectre covers 13,173+ tokens across 150+ chains.' },
      { name: 'Review live intelligence', text: 'Inspect the chart, holder distribution, whale activity, and AI-generated sentiment before trading. All data is real-time.' },
      { name: 'Enter the swap amount', text: 'Type the amount you want to swap in the right panel. Spectre auto-routes through Jupiter on Solana or 0x on EVM chains for best execution.' },
      { name: 'Confirm the swap', text: 'Review the quote, slippage, and estimated gas. Click Swap. Privy signs client-side - your private keys never leave your browser.' },
      { name: 'Verify the transaction', text: 'The transaction hash appears in your wallet activity. Click to view on Etherscan or Solscan. The new token balance updates automatically in the header.' },
    ],
  },

  'use-mcp-server-with-claude': {
    slug: 'use-mcp-server-with-claude',
    name: 'How to connect Spectre AI MCP server to Claude Desktop',
    description: 'Step-by-step guide to connecting Claude Desktop to Spectre AI\'s MCP server so Claude can query live crypto prices, sentiment, on-chain, and news.',
    totalTime: 'PT3M',
    steps: [
      { name: 'Install Claude Desktop', text: 'Download Claude Desktop from claude.ai/download if not already installed.' },
      { name: 'Locate the Claude Desktop config file', text: 'On macOS: ~/Library/Application Support/Claude/claude_desktop_config.json. On Windows: %APPDATA%\\Claude\\claude_desktop_config.json.' },
      { name: 'Add the Spectre MCP server', text: 'Add an entry under mcpServers pointing to https://mcp.spectreai.io. Save the file.' },
      { name: 'Restart Claude Desktop', text: 'Quit and reopen Claude Desktop. You should see 81 new Spectre tools available.' },
      { name: 'Ask Claude a live market question', text: 'Try: "What is the current Fear and Greed Index on Spectre?" or "Show me the top liquidation levels for BTC right now." Claude will call the Spectre MCP server and return live data.' },
    ],
  },

  'read-crypto-fear-and-greed-index': {
    slug: 'read-crypto-fear-and-greed-index',
    name: 'How to read the crypto Fear and Greed Index',
    description: 'Step-by-step guide to interpreting the Spectre AI Fear and Greed Index - what the 0-100 scale means and how to use it in trading decisions.',
    totalTime: 'PT2M',
    steps: [
      { name: 'Open the Fear and Greed page', text: 'Visit spectreai.io/fear-greed. The gauge shows the current reading on a 0-100 scale.' },
      { name: 'Understand the scale', text: '0-25 is Extreme Fear (often a buy signal). 25-45 is Fear. 45-55 is Neutral. 55-75 is Greed. 75-100 is Extreme Greed (often a sell signal).' },
      { name: 'Inspect the sub-factors', text: 'The index aggregates five factors: volatility, volume, social sentiment, Bitcoin dominance, and on-chain signals. Expand each to see the raw contribution.' },
      { name: 'Compare to history', text: 'Scroll down to view the 30-day and 1-year historical overlays. Extremes are rare and mean-reverting.' },
      { name: 'Use as a contrarian signal', text: 'Historically, periods of Extreme Fear have preceded price recoveries and Extreme Greed has preceded corrections. Combine with other tools before trading.' },
    ],
  },
}

export function getGuide(slug) {
  return HOWTO_GUIDES[slug?.toLowerCase?.()] || null
}

export const HOWTO_SLUGS = Object.keys(HOWTO_GUIDES)
