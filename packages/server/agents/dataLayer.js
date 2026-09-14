/**
 * Spectre Intelligence — Data Layer
 * All data fetchers for the Trader Research Pipeline.
 * Steps 2-7: Source Priority, DeFiLlama, CoinGecko Deep, Reddit, GitHub, Blog.
 * Free APIs only (except optional GITHUB_TOKEN for higher rate limits).
 */
const fetch = require('node-fetch');

// ── HELPERS ──────────────────────────────────────────────────────────────────

function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ]).catch(e => ({ available: false, error: e.message, timedOut: true }));
}

function safeJson(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── FOUNDER MAP — Known project founders/team X handles (100+ tokens) ────────
// Format: 'SYMBOL': '@founderHandle + @projectHandle' or 'Anonymous / community'
// Used by Perplexity to search X/Twitter for relevant founder commentary.
const FOUNDER_MAP = {
  // ── Spectre AI (this platform) ──
  'SPECTRE': '@Spectre__AI + @Sunny_Enzo',
  'SPECT': '@Spectre__AI + @Sunny_Enzo',

  // ── Top 10 by market cap ──
  'BTC': '@satoshi (anonymous)',
  'ETH': '@VitalikButerin',
  'BNB': '@caboronkov + @binance',
  'SOL': '@aeyakovenko + @solana',
  'XRP': '@JoelKatz + @Ripple',
  'DOGE': '@BillyM2k (community-driven)',
  'ADA': '@IOHK_Charles + @Cardano',
  'AVAX': '@el33th4xor + @AvaLabs',
  'TRX': '@justinsuntron + @traboronkov',
  'LINK': '@SergeyNazarov + @chainlink',

  // ── Top 11-25 ──
  'DOT': '@gavofyork + @Polkadot',
  'TON': '@durov + @ton_blockchain',
  'SHIB': 'Anonymous (Ryoshi)',
  'LTC': '@SatoshiLite',
  'BCH': 'Bitcoin fork (community)',
  'XLM': '@JedMcCaleb + @StellarOrg',
  'UNI': '@haaboronkov + @Uniswap',
  'NEAR': '@ilaboronkov + @NEARProtocol',
  'ATOM': '@jaekwon + @cosmos',
  'ICP': '@dominic_w + @dfinity',
  'FIL': '@juaboronkov + @Filecoin',
  'APT': '@AptosLabs',
  'ARB': '@OffchainLabs + @arbitrum',
  'HBAR': '@Leemon + @hedera',
  'MNT': '@0xMantle',

  // ── Top 26-50 ──
  'OP': '@optimismFND + @karl_f',
  'MKR': '@RuneKek + @MakerDAO',
  'AAVE': '@StaniKulechov + @AaveAave',
  'INJ': '@InjectiveLabs',
  'SUI': '@SuiNetwork + @EvanCheng_',
  'SEI': '@SeiNetwork + @jayendra_jog',
  'TIA': '@CelestiaOrg + @musalbas',
  'RENDER': '@JulesUrbach + @RenderToken',
  'FET': '@Fetch_ai + @AISFnet',
  'GRT': '@graphprotocol',
  'IMX': '@Immutable + @BobbinThreadbare',
  'CRV': '@newmichwill + @CurveFinance',
  'SAND': '@TheSandboxGame',
  'MANA': '@decentraland',
  'ENS': '@nicksdjohnson + @ensdomains',
  'LDO': '@LidoFinance',
  'FTM': '@FantomFDN + @AborondreabCronjeTech',
  'SNX': '@kaboronkov + @synthetix_io',
  'COMP': '@rleshner + @compoundfinance',
  'RPL': '@Rocket_Pool',

  // ── DeFi Protocols ──
  'SUSHI': '@SushiSwap',
  'YFI': '@AndreCronjeTech + @yeaboronkov',
  'BAL': '@Balancer',
  'DYDX': '@AntonioMJuliano + @dYdX',
  'GMX': '@GMX_IO',
  'JUP': '@JupiterExchange + @weremeow',
  'RAY': '@RaydiumProtocol',
  'ORCA': '@orca_so',
  'CAKE': '@PancakeSwap',
  'PENDLE': '@penaboronkov_fi',
  '1INCH': '@1inch',

  // ── AI & Compute ──
  'TAO': '@opentensor',
  'AKT': '@gregosuri + @akaboronkov',
  'AGIX': '@singaboronkov_io + @BenGoertzel',
  'OCEAN': '@oceanprotocol + @taboronkov',
  'WLD': '@worldcoin + @samaboronkov',
  'NEURAL': '@GoNeuralAI',
  'AI16Z': '@ai16zdao',
  'RNDR': '@JulesUrbach + @RenderToken',

  // ── L2 & Infrastructure ──
  'MATIC': '@sandeepnailwal + @0xPolygon',
  'STRK': '@StarkWareLtd',
  'ZK': '@zkSync + @gluk64',
  'MINA': '@MinaProtocol',
  'CELO': '@CeloOrg',
  'ROSE': '@OasisProtocol',
  'KDA': '@kadena_io',
  'ALGO': '@silvio_micali + @Algorand',

  // ── Gaming & Metaverse ──
  'AXS': '@AxieInfinity',
  'GALA': '@GoGalaGames',
  'ILV': '@illuviumio',
  'MAGIC': '@Treasure_DAO',
  'BEAM': '@MeritCircle_io',

  // ── RWA & Stables ──
  'ONDO': '@nathanlallman + @OndoFinance',
  'CFG': '@centrifuge',
  'MPL': '@SidPowell + @maplefinance',
  'ENA': '@ethena_labs',
  'FRAX': '@samkazemian + @fraboronkov',

  // ── Meme Coins ──
  'PEPE': 'Anonymous / community',
  'BONK': 'Anonymous / community',
  'WIF': 'Anonymous / community',
  'FLOKI': '@RealFlokiInu',
  'TURBO': 'AI-generated concept / community',
  'BRETT': 'Anonymous / community',
  'POPCAT': 'Anonymous / community',
  'MEW': 'Anonymous / community',

  // ── Storage & Data ──
  'AR': '@ArweaveTeam + @samecwilliams',
  'STORJ': '@storj',
  'HNT': '@helium',

  // ── Privacy ──
  'XMR': 'Anonymous (community)',
  'ZEC': '@zooko + @zcash',

  // ── Exchange Tokens ──
  'CRO': '@cryptocom',
  'LEO': '@bitfinex',
  'OKB': '@okx',
  'GT': '@gate_io',
  'KCS': '@kucoincom',

  // ── Spectre-tracked tokens ──
  'ZIG': '@zigchain + Abdul Rafay (Zignaly)',
};

// ── COINGECKO ID RESOLVER ────────────────────────────────────────────────────
// Extended from existing SYMBOL_TO_COINGECKO_ID
const CG_ID_MAP = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'BNB': 'binancecoin',
  'XRP': 'ripple', 'ADA': 'cardano', 'DOGE': 'dogecoin', 'DOT': 'polkadot',
  'AVAX': 'avalanche-2', 'LINK': 'chainlink', 'UNI': 'uniswap', 'LTC': 'litecoin',
  'SHIB': 'shiba-inu', 'ARB': 'arbitrum', 'OP': 'optimism', 'PEPE': 'pepe',
  'AAVE': 'aave', 'MKR': 'maker', 'RENDER': 'render-token', 'INJ': 'injective-protocol',
  'SUI': 'sui', 'APT': 'aptos', 'TIA': 'celestia', 'SEI': 'sei-network',
  'BONK': 'bonk', 'NEAR': 'near', 'ATOM': 'cosmos', 'FIL': 'filecoin',
  'ICP': 'internet-computer', 'FET': 'fetch-ai', 'TAO': 'bittensor',
  'ONDO': 'ondo-finance', 'ZIG': 'zigchain', 'NEURAL': 'neural-ai',
  'AKT': 'akash-network', 'HNT': 'helium', 'CFG': 'centrifuge',
  'MPL': 'maple', 'ENA': 'ethena',
};

function resolveCoinGeckoId(symbol) {
  return CG_ID_MAP[symbol.toUpperCase()] || symbol.toLowerCase();
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: SOURCE PRIORITY LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

const WEIGHT_ORDER = { CRITICAL: 0, ALWAYS: 1, HIGH: 2, MEDIUM: 3, LOW: 4, SKIP: 5 };

function byWeightDescending(a, b) {
  return (WEIGHT_ORDER[a.weight] ?? 5) - (WEIGHT_ORDER[b.weight] ?? 5);
}

function deduplicateBySource(priorities) {
  const seen = new Map();
  for (const p of priorities) {
    const existing = seen.get(p.source);
    if (!existing || (WEIGHT_ORDER[p.weight] ?? 5) < (WEIGHT_ORDER[existing.weight] ?? 5)) {
      seen.set(p.source, p);
    }
  }
  return [...seen.values()];
}

/**
 * determineSourcePriority — Context-aware source weighting.
 * Returns sorted array of { source, weight, reason, searchFocus } objects.
 */
function determineSourcePriority(context) {
  const priorities = [];

  // SIGNAL: PRICE IS MOVING (>5% in 24h)
  if (Math.abs(context.change24h || 0) > 5) {
    priorities.push({ source: 'X_TWITTER', weight: 'CRITICAL', reason: 'Price moving. X has fastest signal on catalysts.' });
    priorities.push({ source: 'REDDIT', weight: 'HIGH', reason: 'Community reacting to move in real time.' });
    priorities.push({ source: 'DEFILLAMA', weight: context.isDefi ? 'HIGH' : 'SKIP', reason: 'TVL spike/drop explains price moves.' });
    priorities.push({ source: 'GITHUB', weight: 'LOW', reason: 'Not relevant to short-term moves.' });
    priorities.push({ source: 'MEDIUM', weight: 'LOW', reason: 'Blog posts lag real-time events.' });
  }

  // SIGNAL: NEW TOKEN (<90 days old)
  if ((context.ageInDays || 999) < 90) {
    priorities.push({ source: 'GITHUB', weight: 'CRITICAL', reason: 'New token. Is there actual code?' });
    priorities.push({ source: 'X_TWITTER', weight: 'CRITICAL', reason: 'New token. Founder credibility check.' });
    priorities.push({ source: 'REDDIT', weight: 'HIGH', reason: 'Early community red flags surface on Reddit first.' });
    priorities.push({ source: 'MEDIUM', weight: 'HIGH', reason: 'Whitepaper/litepaper details.' });
    priorities.push({ source: 'DEFILLAMA', weight: 'LOW', reason: 'Too early for meaningful TVL.' });
  }

  // SIGNAL: DEFI / L1 / L2 PROTOCOL
  const cats = (context.categories || []).map(c => c.toLowerCase());
  if (context.isDefi || cats.some(c => ['defi', 'dex', 'lending', 'yield', 'layer-1', 'layer-2'].includes(c))) {
    priorities.push({ source: 'DEFILLAMA', weight: 'CRITICAL', reason: 'TVL and revenue are primary truth signal for protocols.' });
    priorities.push({ source: 'GITHUB', weight: 'HIGH', reason: 'Protocol security and dev activity are existential.' });
    priorities.push({ source: 'X_TWITTER', weight: 'HIGH' });
    priorities.push({ source: 'REDDIT', weight: 'MEDIUM' });
    priorities.push({ source: 'MEDIUM', weight: 'MEDIUM', reason: 'Protocol updates and governance posts.' });
  }

  // SIGNAL: MICROCAP (<$10M market cap)
  if ((context.marketCap || 0) > 0 && context.marketCap < 10_000_000) {
    priorities.push({ source: 'GITHUB', weight: 'CRITICAL', reason: 'Microcap. Code is only objective proof of work.' });
    priorities.push({ source: 'X_TWITTER', weight: 'CRITICAL', reason: 'Microcap. Team activity on X is primary legitimacy signal.' });
    priorities.push({ source: 'REDDIT', weight: 'HIGH', reason: 'Microcap sentiment lives on Reddit.' });
    priorities.push({ source: 'MEDIUM', weight: 'HIGH', reason: 'Microcap teams often communicate via Medium.' });
    priorities.push({ source: 'DEFILLAMA', weight: context.isDefi ? 'HIGH' : 'SKIP' });
  }

  // SIGNAL: MAJOR CAP (>$500M market cap)
  if ((context.marketCap || 0) > 500_000_000) {
    priorities.push({ source: 'WEB_NEWS', weight: 'CRITICAL', reason: 'Major cap. Mainstream press coverage is signal.' });
    priorities.push({ source: 'DEFILLAMA', weight: context.isDefi ? 'CRITICAL' : 'HIGH' });
    priorities.push({ source: 'X_TWITTER', weight: 'HIGH' });
    priorities.push({ source: 'REDDIT', weight: 'MEDIUM' });
    priorities.push({ source: 'GITHUB', weight: 'LOW', reason: 'Major protocols have teams. Repo activity less telling.' });
  }

  // SIGNAL: RECENT MAJOR NEWS
  if (context.hasBreakingNews) {
    priorities.forEach(p => {
      if (p.source === 'X_TWITTER') p.weight = 'CRITICAL';
      if (p.source === 'WEB_NEWS') p.weight = 'CRITICAL';
      if (p.source === 'GITHUB') p.weight = 'LOW';
    });
    priorities.push({ source: 'MEDIUM', weight: 'HIGH', reason: 'Teams often publish Medium posts about major announcements.' });
  }

  // SIGNAL: STALE PRICE / LOW VOLUME
  if ((context.volume24h || 0) < 50_000 || context.change7d === 0) {
    priorities.push({ source: 'X_TWITTER', weight: 'CRITICAL', reason: 'Checking if team/community is still alive.' });
    priorities.push({ source: 'GITHUB', weight: 'CRITICAL', reason: 'Last commit date tells you if devs are still working.' });
    priorities.push({ source: 'REDDIT', weight: 'HIGH', reason: 'Dead communities ghost their subreddits first.' });
    priorities.push({ source: 'DEFILLAMA', weight: 'LOW' });
  }

  // DEFAULTS: Always run for every token
  priorities.push({ source: 'COINGECKO_DEEP', weight: 'ALWAYS', reason: 'Supply, exchange, contract flags.' });
  priorities.push({ source: 'PRICE_TECHNICALS', weight: 'ALWAYS', reason: 'Chart context.' });
  priorities.push({ source: 'WEB_NEWS', weight: 'ALWAYS', reason: 'Last 7 days minimum.' });

  return deduplicateBySource(priorities).sort(byWeightDescending);
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: DEFILLAMA INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

// Cache protocols list for 15 minutes (large response, rarely changes)
let _protocolsCache = null;
let _protocolsCacheTime = 0;

async function fetchDeFiLlama(symbol) {
  try {
    // Get all protocols (cached)
    const now = Date.now();
    if (!_protocolsCache || now - _protocolsCacheTime > 15 * 60 * 1000) {
      const res = await fetch('https://api.llama.fi/protocols', { signal: AbortSignal.timeout(10000) });
      _protocolsCache = await res.json();
      _protocolsCacheTime = now;
    }

    // Find protocol by symbol or name
    const symLower = symbol.toLowerCase();
    const protocol = _protocolsCache.find(p =>
      p.symbol?.toLowerCase() === symLower ||
      p.name?.toLowerCase() === symLower ||
      p.name?.toLowerCase().includes(symLower)
    );

    if (!protocol) return { available: false, reason: 'Not found on DeFiLlama' };

    // Get detailed data
    const [detail, yieldPools] = await Promise.allSettled([
      fetch(`https://api.llama.fi/protocol/${protocol.slug}`, { signal: AbortSignal.timeout(8000) }).then(safeJson),
      fetch('https://yields.llama.fi/pools', { signal: AbortSignal.timeout(8000) })
        .then(safeJson)
        .then(data => (data.data || []).filter(p =>
          p.symbol?.toLowerCase().includes(symLower)
        ).slice(0, 5)),
    ]);

    const detailData = detail.status === 'fulfilled' ? detail.value : {};

    return {
      available: true,
      name: protocol.name,
      slug: protocol.slug,
      tvl: protocol.tvl,
      tvl7dChange: protocol.change_7d,
      tvl30dChange: protocol.change_1m,
      chains: protocol.chains || [],
      category: protocol.category,
      revenue24h: detailData.revenue24h || null,
      fees24h: detailData.fees24h || null,
      mcapTvl: protocol.mcap ? (protocol.mcap / (protocol.tvl || 1)).toFixed(2) : null,
      yieldPools: yieldPools.status === 'fulfilled' ? yieldPools.value : [],
      url: `https://defillama.com/protocol/${protocol.slug}`,
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: ENHANCED COINGECKO PULL
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchCoinGeckoDeep(symbol) {
  try {
    const cgId = resolveCoinGeckoId(symbol);
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${cgId}?` +
      'localization=false&tickers=true&market_data=true&' +
      'community_data=true&developer_data=true&sparkline=false',
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await safeJson(res);

    const md = data.market_data || {};
    const cd = data.community_data || {};
    const dd = data.developer_data || {};

    return {
      available: true,
      name: data.name,
      symbol: data.symbol?.toUpperCase(),
      categories: data.categories || [],
      description: data.description?.en?.substring(0, 500) || '',

      // Supply
      circulatingSupply: md.circulating_supply,
      totalSupply: md.total_supply,
      maxSupply: md.max_supply,
      supplyRatio: md.total_supply ? (md.circulating_supply / md.total_supply) : null,

      // Market
      price: md.current_price?.usd,
      marketCap: md.market_cap?.usd,
      volume24h: md.total_volume?.usd,
      change24h: md.price_change_percentage_24h,
      change7d: md.price_change_percentage_7d,
      change30d: md.price_change_percentage_30d,

      // ATH
      ath: md.ath?.usd,
      athDate: md.ath_date?.usd,
      athDrawdown: md.ath_change_percentage?.usd,

      // Exchange listings (top 10)
      exchanges: (data.tickers || []).slice(0, 10).map(t => ({
        name: t.market?.name,
        pair: `${t.base}/${t.target}`,
        volume24h: t.converted_volume?.usd,
        trustScore: t.trust_score,
      })),

      // Community
      twitterFollowers: cd.twitter_followers,
      telegramUsers: cd.telegram_channel_user_count,
      redditSubscribers: cd.reddit_subscribers,

      // Developer activity
      githubCommits4w: dd.commit_count_4_weeks,
      githubStars: dd.stars,

      // Links
      homepage: data.links?.homepage?.[0] || null,
      githubUrl: data.links?.repos_url?.github?.[0] || null,
      blogUrl: data.links?.official_forum_url?.[0] || null,
      twitterUrl: data.links?.twitter_screen_name ? `https://x.com/${data.links.twitter_screen_name}` : null,
      telegramUrl: data.links?.telegram_channel_identifier ? `https://telegram.me/${data.links.telegram_channel_identifier}` : null,

      // Launch date approximation
      genesisDate: data.genesis_date || null,
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

/**
 * Quick CoinGecko fetch (basic info only, used in Step 0 of pipeline).
 */
async function fetchCoinGeckoBasic(symbol) {
  try {
    const cgId = resolveCoinGeckoId(symbol);
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${cgId}?` +
      'localization=false&tickers=false&market_data=true&' +
      'community_data=false&developer_data=false&sparkline=false',
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await safeJson(res);
    const md = data.market_data || {};

    return {
      available: true,
      name: data.name,
      categories: data.categories || [],
      launchDate: data.genesis_date || null,
      repos_url: data.links?.repos_url,
      blog_url: data.links?.official_forum_url,
      marketCap: md.market_cap?.usd,
      price: md.current_price?.usd,
      change24h: md.price_change_percentage_24h,
      change7d: md.price_change_percentage_7d,
      volume24h: md.total_volume?.usd,
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: REDDIT INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

const REDDIT_HEADERS = { 'User-Agent': 'Spectre-AI-Bot/1.0' };

async function fetchRedditData(symbol, projectName) {
  try {
    const q = `$${symbol} OR ${projectName || symbol}`;
    const [cryptoSearch, projectSub, globalSearch] = await Promise.allSettled([
      // r/CryptoCurrency search
      fetch(
        `https://www.reddit.com/r/CryptoCurrency/search.json?q=${encodeURIComponent(q)}&sort=new&limit=10&t=week`,
        { headers: REDDIT_HEADERS, signal: AbortSignal.timeout(8000) }
      ).then(safeJson),

      // Project-specific subreddit
      fetch(
        `https://www.reddit.com/r/${projectName || symbol}/new.json?limit=10`,
        { headers: REDDIT_HEADERS, signal: AbortSignal.timeout(8000) }
      ).then(safeJson).catch(() => null),

      // Global search
      fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(`$${symbol}`)}&sort=new&limit=15&t=week`,
        { headers: REDDIT_HEADERS, signal: AbortSignal.timeout(8000) }
      ).then(safeJson),
    ]);

    const posts = [
      ...(cryptoSearch.value?.data?.children || []),
      ...(projectSub.value?.data?.children || []),
      ...(globalSearch.value?.data?.children || []),
    ]
      .map(p => p.data)
      .filter(p => p && p.score > 3)
      .sort((a, b) => (b.created_utc || 0) - (a.created_utc || 0))
      // Deduplicate by permalink
      .filter((p, i, arr) => arr.findIndex(x => x.permalink === p.permalink) === i)
      .slice(0, 10);

    // Classify posts
    const redFlags = posts.filter(p =>
      /rug|scam|honeypot|hack|exploit|exit.?scam|dump|dead|abandoned|ponzi/i.test(`${p.title} ${p.selftext || ''}`)
    );
    const bullishPosts = posts.filter(p =>
      /partnership|listing|launch|release|milestone|bullish|gem|alpha|undervalued/i.test(p.title)
    );

    const hasProjectSub = projectSub.value?.data?.children?.length > 0;

    return {
      available: posts.length > 0,
      posts: posts.slice(0, 5).map(p => ({
        title: p.title,
        subreddit: p.subreddit,
        score: p.score,
        comments: p.num_comments,
        url: `https://reddit.com${p.permalink}`,
        ageHours: Math.floor((Date.now() / 1000 - (p.created_utc || 0)) / 3600),
        preview: (p.selftext || '').substring(0, 200),
      })),
      redFlagCount: redFlags.length,
      redFlagTitles: redFlags.map(p => p.title),
      bullishPostCount: bullishPosts.length,
      communitySubreddit: hasProjectSub ? `r/${projectName || symbol}` : null,
      overallSentiment: redFlags.length > 2 ? 'negative' :
        bullishPosts.length > redFlags.length ? 'positive' : 'mixed',
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: GITHUB INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

function getGitHubHeaders() {
  const headers = { 'User-Agent': 'Spectre-AI-Bot/1.0', Accept: 'application/vnd.github.v3+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function parseGitHubUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

async function resolveGitHubRepo(symbol, projectName) {
  // 1. Check CoinGecko links first
  const cg = await fetchCoinGeckoBasic(symbol);
  const ghUrl = cg?.repos_url?.github?.[0];
  if (ghUrl) return ghUrl;

  // 2. Search GitHub
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(projectName || symbol)}+crypto&sort=stars&per_page=3`,
      { headers: getGitHubHeaders(), signal: AbortSignal.timeout(8000) }
    );
    const data = await safeJson(res);
    return data.items?.[0]?.html_url || null;
  } catch (_) {
    return null;
  }
}

async function fetchGitHubData(symbol, projectName) {
  try {
    const repoUrl = await resolveGitHubRepo(symbol, projectName);
    if (!repoUrl) return { available: false, reason: 'No public GitHub found' };

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) return { available: false, reason: 'Invalid GitHub URL' };

    const { owner, repo } = parsed;
    const headers = getGitHubHeaders();

    const [repoData, commits, contributors, releases] = await Promise.allSettled([
      fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal: AbortSignal.timeout(8000) }).then(safeJson),
      fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=10`, { headers, signal: AbortSignal.timeout(8000) }).then(safeJson),
      fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=10`, { headers, signal: AbortSignal.timeout(8000) }).then(safeJson),
      fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=3`, { headers, signal: AbortSignal.timeout(8000) }).then(safeJson),
    ]);

    const repoInfo = repoData.status === 'fulfilled' ? repoData.value : {};
    const lastCommits = Array.isArray(commits.value) ? commits.value : [];
    const lastCommitDate = lastCommits[0]?.commit?.committer?.date;
    const daysSinceCommit = lastCommitDate
      ? Math.floor((Date.now() - new Date(lastCommitDate)) / 86400000)
      : null;

    // Activity classification
    const activityStatus =
      daysSinceCommit === null ? 'unknown' :
      daysSinceCommit < 7 ? 'very_active' :
      daysSinceCommit < 30 ? 'active' :
      daysSinceCommit < 90 ? 'slowing' :
      daysSinceCommit < 180 ? 'dormant' :
      'abandoned';

    const contribs = Array.isArray(contributors.value) ? contributors.value : [];
    const rels = Array.isArray(releases.value) ? releases.value : [];

    return {
      available: true,
      repoUrl: `https://github.com/${owner}/${repo}`,
      stars: repoInfo.stargazers_count || 0,
      forks: repoInfo.forks_count || 0,
      openIssues: repoInfo.open_issues_count || 0,
      language: repoInfo.language || null,
      lastCommitDate,
      daysSinceLastCommit: daysSinceCommit,
      activityStatus,
      contributorCount: contribs.length,
      topContributors: contribs.slice(0, 3).map(c => ({ login: c.login, commits: c.contributions })),
      latestRelease: rels[0] ? {
        name: rels[0].name || rels[0].tag_name,
        date: rels[0].published_at,
        url: rels[0].html_url,
      } : null,
      recentCommitMessages: lastCommits.slice(0, 5).map(c => ({
        message: c.commit?.message?.substring(0, 100),
        date: c.commit?.committer?.date,
        author: c.commit?.author?.name,
      })),
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7: MEDIUM / BLOG INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchProjectBlog(symbol, projectName) {
  try {
    // Check CoinGecko for blog URL
    const cg = await fetchCoinGeckoBasic(symbol);
    const blogUrl = cg?.blog_url?.[0] || null;

    // Try Medium RSS if URL is medium.com
    let mediumPosts = [];
    if (blogUrl && blogUrl.includes('medium.com')) {
      try {
        const { fetchRssFeed } = require('../lib/rssParser');
        const rssUrl = blogUrl.endsWith('/feed') ? blogUrl : `${blogUrl}/feed`;
        const feed = await fetchRssFeed(rssUrl);
        mediumPosts = (feed || []).slice(0, 5).map(item => ({
          title: item.title,
          date: item.publishedAt || item.pubDate,
          url: item.link || item.url,
          summary: (item.summary || item.description || '').substring(0, 300).replace(/<[^>]+>/g, ''),
        }));
      } catch (_) {}
    }

    // Also try Medium search by project name
    if (mediumPosts.length === 0 && projectName) {
      try {
        const { fetchRssFeed } = require('../lib/rssParser');
        const searchFeed = `https://medium.com/feed/tag/${projectName.toLowerCase()}`;
        const feed = await fetchRssFeed(searchFeed);
        mediumPosts = (feed || []).slice(0, 3).map(item => ({
          title: item.title,
          date: item.publishedAt || item.pubDate,
          url: item.link || item.url,
          summary: (item.summary || '').substring(0, 300).replace(/<[^>]+>/g, ''),
        }));
      } catch (_) {}
    }

    const hasRecentUpdate = mediumPosts.some(p => {
      if (!p.date) return false;
      const daysOld = (Date.now() - new Date(p.date)) / 86400000;
      return daysOld < 30;
    });

    return {
      available: mediumPosts.length > 0 || !!blogUrl,
      blogUrl,
      recentPosts: mediumPosts,
      hasRecentUpdate,
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8: COMPILE RESEARCH DOSSIER
// ═══════════════════════════════════════════════════════════════════════════════

function extractValue(settled) {
  return settled?.status === 'fulfilled' ? settled.value : settled?.value || null;
}

function compileDossier(data) {
  const { context, sourcePriorities } = data;
  const cgDeep = extractValue(data.onChainData) || {};
  const price = extractValue(data.priceData) || {};
  const defi = extractValue(data.defiData) || {};
  const reddit = extractValue(data.redditData) || {};
  const github = extractValue(data.githubData) || {};
  const blog = extractValue(data.blogData) || {};
  const xData = extractValue(data.xData) || {};
  const news = extractValue(data.webNews) || [];

  const dossier = {
    // Research context
    researchContext: {
      symbol: context.symbol,
      projectName: context.projectName,
      marketCap: context.marketCap,
      isDefi: context.isDefi,
      ageInDays: context.ageInDays,
      hasBreakingNews: context.hasBreakingNews,
      sourcePrioritiesApplied: sourcePriorities
        .filter(p => p.weight !== 'SKIP')
        .map(p => `${p.source}:${p.weight}`)
        .join(', '),
    },

    // Price snapshot
    price: {
      current: price.price || cgDeep.price,
      change24h: price.change24h || cgDeep.change24h,
      change7d: price.change7d || cgDeep.change7d,
      change30d: cgDeep.change30d,
      ath: cgDeep.ath,
      athDrawdown: cgDeep.athDrawdown,
      volume24h: price.volume24h || cgDeep.volume24h,
      marketCap: price.marketCap || cgDeep.marketCap,
    },

    // Supply
    supply: {
      circulating: cgDeep.circulatingSupply,
      total: cgDeep.totalSupply,
      max: cgDeep.maxSupply,
      ratio: cgDeep.supplyRatio,
    },

    // Exchange listings
    exchanges: cgDeep.exchanges || [],

    // Social
    social: {
      twitterFollowers: cgDeep.twitterFollowers,
      telegramUsers: cgDeep.telegramUsers,
      redditSubscribers: cgDeep.redditSubscribers,
      founderHandle: context.founderHandle || FOUNDER_MAP[context.symbol] || null,
      xSentiment: xData.sentiment || null,
      xKeyPosts: xData.keyPosts || [],
    },

    // Reddit
    reddit: reddit.available ? {
      topPosts: reddit.posts,
      redFlagCount: reddit.redFlagCount,
      redFlagTitles: reddit.redFlagTitles,
      sentiment: reddit.overallSentiment,
      hasProjectSubreddit: !!reddit.communitySubreddit,
    } : { available: false, skipped: reddit.skipped },

    // GitHub
    github: github.available ? {
      repoUrl: github.repoUrl,
      activityStatus: github.activityStatus,
      daysSinceLastCommit: github.daysSinceLastCommit,
      contributorCount: github.contributorCount,
      stars: github.stars,
      latestRelease: github.latestRelease,
      recentCommits: github.recentCommitMessages,
    } : { available: false, skipped: github.skipped },

    // Blog
    blog: blog.available ? {
      hasRecentUpdate: blog.hasRecentUpdate,
      recentPosts: blog.recentPosts,
      blogUrl: blog.blogUrl,
    } : { available: false, skipped: blog.skipped },

    // DeFi
    defi: defi.available ? {
      tvl: defi.tvl,
      tvlTrend: defi.tvl7dChange,
      hasRevenue: (defi.revenue24h || 0) > 0,
      revenue24h: defi.revenue24h,
      fees24h: defi.fees24h,
      chains: defi.chains,
      category: defi.category,
      url: defi.url,
    } : { available: false },

    // Auto-detected risk flags
    riskFlags: [
      cgDeep.supplyRatio && cgDeep.supplyRatio < 0.3 &&
        'INFLATION: Less than 30% of supply circulating. High unlock risk.',
      cgDeep.exchanges?.length <= 2 &&
        'LIQUIDITY: Only 1-2 exchange listings. Thin exit liquidity.',
      (price.volume24h || cgDeep.volume24h || 0) < 50_000 &&
        `VOLUME: $${((price.volume24h || cgDeep.volume24h || 0)).toLocaleString()}/day. Critically low.`,
      github.activityStatus === 'abandoned' &&
        'GITHUB: Development appears abandoned.',
      github.activityStatus === 'dormant' &&
        `GITHUB: No commits in ${github.daysSinceLastCommit} days.`,
      reddit.redFlagCount > 2 &&
        `COMMUNITY: ${reddit.redFlagCount} Reddit posts flagging scam/rug concerns.`,
      (context.ageInDays || 999) < 30 &&
        'NEW TOKEN: Launched less than 30 days ago. Minimal track record.',
    ].filter(Boolean),

    // News
    recentNews: Array.isArray(news) ? news : [],

    // All sources for citation panel
    allSources: [
      ...(xData.sources || []),
      ...(Array.isArray(news) ? news.map(n => n.url).filter(Boolean) : []),
      ...(defi.available ? [defi.url || 'https://defillama.com'] : []),
      ...(github.available ? [github.repoUrl] : []),
      ...(blog.recentPosts?.map(p => p.url) || []),
      ...(reddit.posts?.map(p => p.url) || []),
      'https://coingecko.com',
    ].filter(Boolean).slice(0, 10),

    // Description
    description: cgDeep.description || '',

    // Categories
    categories: cgDeep.categories || context.categories || [],
  };

  return dossier;
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Source priority
  determineSourcePriority,

  // Data fetchers
  fetchDeFiLlama,
  fetchCoinGeckoDeep,
  fetchCoinGeckoBasic,
  fetchRedditData,
  fetchGitHubData,
  resolveGitHubRepo,
  fetchProjectBlog,

  // Pipeline helpers
  compileDossier,
  withTimeout,
  resolveCoinGeckoId,

  // Maps
  FOUNDER_MAP,
  CG_ID_MAP,
};
