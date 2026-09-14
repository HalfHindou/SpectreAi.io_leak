import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors';
import { getStockLogoUrl, getStockLogoFallback } from '@/services/stockApi';
import useTokenBrandColor from '@/hooks/useTokenBrandColor';
import { COINGECKO_LOGOS } from '@/constants/majorTokens';
import RzWhatIf from './rz-whatif';
import { RzHeroEarnings } from './rz-earnings-banner';
import { shortExchange } from '@/lib/exchange-label';

// Stock hero logo. The white plate under a stock logo is NOT decoration — most
// of these are transparent PNGs whose mark is dark (NVDA 59% transparent, TSLA
// 73%, INTC 87%), and without a plate they vanish into the dark hero.
//
// 🪤 But some are full-bleed and carry their OWN background: AAPL is 0%
// transparent with white corners, SPCX is 0% transparent with near-black
// corners. For those, `background:#fff` + `padding:6px` + `object-fit:contain`
// shrinks the artwork inside the plate, and the plate becomes a rim — on SPCX
// a black disc floating in a fat white ring (founder 08-04). CSS cannot see
// transparency, so we measure it: sample the image's alpha through the
// same-origin proxy (a direct CDN read taints the canvas and getImageData
// throws), and if it is opaque edge-to-edge let it bleed to the full circle.
// Any failure keeps today's plated behaviour — the safe direction.
function RzStockLogo({ symbol }) {
  const [src, setSrc] = useState(() => getStockLogoUrl(symbol));
  const [bleed, setBleed] = useState(false);

  useEffect(() => { setSrc(getStockLogoUrl(symbol)); setBleed(false); }, [symbol]);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const n = 24; // sampling grid — enough to judge the edges, costs nothing
        const c = document.createElement('canvas');
        c.width = n; c.height = n;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, n, n);
        const { data } = ctx.getImageData(0, 0, n, n);
        // opaque enough to supply its own backdrop = every edge pixel solid
        let edgeClear = true;
        for (let i = 0; i < n && edgeClear; i++) {
          for (const [x, y] of [[i, 0], [i, n - 1], [0, i], [n - 1, i]]) {
            if (data[(y * n + x) * 4 + 3] < 250) { edgeClear = false; break; }
          }
        }
        if (edgeClear) setBleed(true);
      } catch { /* tainted or unreadable — keep the plate */ }
    };
    img.src = `/api/img-proxy?url=${encodeURIComponent(src)}`;
    return () => { cancelled = true; };
  }, [src]);

  return (
    <img
      src={src}
      alt=""
      width="62"
      height="62"
      fetchpriority="high"
      decoding="async"
      className={`rz-lite-hero-logo rz-lite-hero-logo--stock${bleed ? ' is-bleed' : ''}`}
      onError={() => setSrc(getStockLogoFallback(symbol))}
    />
  );
}

// Hero token logo with a recoverable, per-token fallback chain:
//   1. direct CDN URL (preconnect to assets/coin-images.coingecko is warm)
//   2. /api/img-proxy (same-origin, 24h server cache + stale-while-revalidate)
//      - survives CoinGecko CDN slowness / 429s after one warm fetch
//   3. letter avatar
// The previous onError nuked the <img> imperatively and appended a raw span
// React didn't track, so switching tokens via the quick-switcher (no remount)
// left the OLD token's letter stuck forever ("B for BTC"). State-driven +
// reset-on-url-change fixes the stuck-forever case.
//
// Two more fixes (Gleb 2026-06-12, "still see B for 2-3s then the real logo"):
//   - SEED majors synchronously from COINGECKO_LOGOS so BTC/ETH/etc. have a
//     URL on the FIRST render instead of waiting for the async data hook to
//     populate data.token.logo (that lag was the 2-3s letter flash).
//   - While the image is downloading, show a SKELETON SHIMMER, not the letter.
//     The letter reads as "broken/mock"; a shimmer reads as "loading". The
//     letter now appears only on terminal failure (both sources errored) or
//     when there is genuinely no logo and nothing is in flight.
function RzHeroLogo({ url, symbol, loading }) {
  // Candidate list, best first: the resolved async logo, then the known major
  // logo as a recovery source. Earlier code only ever tried `url` (direct then
  // proxy) and fell straight to the letter — so a major whose async `url` was
  // slow or broken could sit blank/letter instead of recovering to its known
  // CoinGecko logo. Probing each candidate direct -> /api/img-proxy.
  const majorSeed = COINGECKO_LOGOS[(symbol || '').toUpperCase()] || null;
  const candidates = useMemo(() => {
    const list = [];
    if (url) list.push(url);
    if (majorSeed && majorSeed !== url) list.push(majorSeed);
    return list;
  }, [url, majorSeed]);
  const candKey = candidates.join('|');

  // goodSrc = the last src that actually loaded. We keep showing it even when a
  // newer `url` arrives for the SAME token, so a late/broken refinement never
  // blanks an already-painted logo (the empty-circle flash). It's cleared only
  // when the symbol changes (a genuinely different token).
  const [goodSrc, setGoodSrc] = useState(null);
  const [idx, setIdx] = useState(0);       // which candidate
  const [proxy, setProxy] = useState(false); // direct vs proxy for current candidate
  const [exhausted, setExhausted] = useState(false);

  // New token: drop the prior logo and restart probing.
  useEffect(() => { setGoodSrc(null); setIdx(0); setProxy(false); setExhausted(false); }, [symbol]);
  // Same token, candidate set refined (async url landed): re-probe from the top
  // but KEEP goodSrc visible until the better candidate loads.
  const prevKey = useRef(candKey);
  useEffect(() => {
    if (prevKey.current === candKey) return;
    prevKey.current = candKey;
    setIdx(0); setProxy(false); setExhausted(false);
  }, [candKey]);

  const current = candidates[idx] || null;
  const probingSrc = current ? (proxy ? `/api/img-proxy?url=${encodeURIComponent(current)}` : current) : null;

  // Preload the current candidate OFF the DOM via `new Image()` instead of a
  // hidden <img> in JSX. That closes the cached-image race that was the real
  // "empty circle" bug (2026-07-02): when a logo is already in the browser
  // cache (every repeat visit / token switch), the hidden <img> mounts
  // already-`complete`, so its `onLoad` never fires — goodSrc was never set and
  // the hero sat pinned on the shimmer skeleton forever. Here we attach the
  // handlers first, set src, THEN read `.complete` synchronously to catch the
  // cache-hit the load event silently skips. Same direct -> /api/img-proxy ->
  // next-candidate -> letter fallback chain as before.
  useEffect(() => {
    if (!probingSrc || probingSrc === goodSrc) return;
    let active = true;
    const advance = () => {
      if (!active) return;
      if (!proxy) { setProxy(true); return; }             // retry same candidate via proxy
      if (idx < candidates.length - 1) { setIdx(idx + 1); setProxy(false); return; } // next candidate
      setExhausted(true);                                  // out of candidates -> letter
    };
    const img = new Image();
    img.onload = () => { if (active) setGoodSrc(probingSrc); };
    img.onerror = advance;
    img.src = probingSrc;
    // Cache hit: the element is already complete and the load event won't fire.
    if (img.complete) { if (img.naturalWidth > 0) setGoodSrc(probingSrc); else advance(); }
    return () => { active = false; img.onload = null; img.onerror = null; };
  }, [probingSrc, goodSrc, proxy, idx, candidates.length]);

  // letter only when nothing ever loaded AND we've run out of options
  const showLetter = !goodSrc && (exhausted || (!current && !loading));
  const showSkeleton = !goodSrc && !showLetter;

  return (
    <>
      {showSkeleton && <span className="rz-skeleton rz-skeleton--circle rz-lite-hero-logo" aria-hidden="true" />}
      {showLetter && <span className="rz-lite-hero-logo-fallback">{(symbol || '?').charAt(0).toUpperCase()}</span>}
      {goodSrc && (
        <img src={goodSrc} alt="" width="62" height="62" fetchpriority="high" decoding="async" className="rz-lite-hero-logo" />
      )}
    </>
  );
}

const HERO_LINK_DEFS = [
  { key: 'website', label: 'Website', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { key: 'twitter', label: 'X (Twitter)', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> },
  { key: 'reddit', label: 'Reddit', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg> },
  { key: 'github', label: 'GitHub', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg> },
  { key: 'telegram', label: 'Telegram', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg> },
  { key: 'discord', label: 'Discord', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.946 2.418-2.157 2.418z"/></svg> },
]

function resolveLinks(symbol, aboutDetails) {
  // Links come from real API data only: Codex `socialLinks` and CoinGecko
  // `coin.links` are merged in useResearchZoneData. No hardcoded fallback.
  const links = {}
  const cl = aboutDetails?.links
  if (cl) {
    if (cl.homepage) links.website = Array.isArray(cl.homepage) ? cl.homepage[0] : cl.homepage
    if (cl.twitter) links.twitter = cl.twitter
    if (cl.twitter_screen_name) links.twitter = `https://twitter.com/${cl.twitter_screen_name}`
    if (cl.reddit) links.reddit = cl.reddit
    if (cl.subreddit_url) links.reddit = cl.subreddit_url
    if (cl.github) links.github = cl.github
    if (cl.repos_url?.github?.[0]) links.github = cl.repos_url.github[0]
    if (cl.telegram) links.telegram = cl.telegram
    if (cl.telegram_channel_identifier) links.telegram = `https://telegram.me/${cl.telegram_channel_identifier}`
    if (cl.discord) links.discord = cl.discord
  }
  return links
}

// Memoized: the hero re-renders on every live-price tick (it shows the ticking
// price), but the social links depend only on symbol + aboutDetails, so without
// memo resolveLinks() + filter ran on every tick. Now it runs only when those
// actually change.
const HeroSocialLinks = React.memo(function HeroSocialLinks({ symbol, aboutDetails }) {
  const links = resolveLinks(symbol, aboutDetails)
  const available = HERO_LINK_DEFS.filter(l => links[l.key])
  if (available.length === 0) return null

  return (
    <div className="rz-lite-hero-socials">
      {available.map(link => (
        <a key={link.key} href={links[link.key]} target="_blank" rel="noopener noreferrer" className="rz-lite-hero-social" title={link.label}>
          {link.icon}
        </a>
      ))}
    </div>
  )
})

const RzHeroBanner = React.memo(function RzHeroBanner({
  reportedEarnings,
  symbol,
  tokenName,
  tokenData,
  isStock,
  aboutDetails,
  icons,
  fmtPrice,
  formatChange,
  displayColors,
  tokenLogo,
  loading,
  isInWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  onOpenHistory,
  cgId,
  fmtPriceFn,
  livePrice,
}) {
  const { t } = useTranslation();
  const displayPrice = (livePrice != null && Number.isFinite(Number(livePrice))) ? Number(livePrice) : tokenData.price;

  // Token brand color: curated → server KV → canvas extraction → hash.
  // Drives --token-rgb on the hero banner so unknown tokens get a real glow
  // instead of the purple fallback.
  const brand = useTokenBrandColor(symbol, tokenLogo, tokenData?.address);
  const brandRgb = TOKEN_ROW_COLORS[symbol]?.bg || brand.rgb;

  // Category label: prefer real CoinGecko categories from aboutDetails
  const categoryLabel = isStock
    ? (tokenData.sector || 'Stock')
    : (aboutDetails?.categories?.[0] || 'Cryptocurrency');

  const inWatchlist = isInWatchlist?.(symbol)

  // Stocks only, and only once the date has actually landed — the slot stays
  // empty rather than reserving space for a print we can't name yet.
  const showHeroEarnings = !loading && isStock && !!tokenData?.earningsDate

  const handleWatchlistToggle = () => {
    if (!symbol) return
    if (inWatchlist) {
      removeFromWatchlist?.(symbol)
    } else {
      addToWatchlist?.({ symbol, name: tokenName, image: tokenLogo })
    }
  }

  return (
    <div className="rz-lite-hero" aria-label={`${tokenName} overview`} style={{ '--token-rgb': brandRgb, '--token-rgb-accent': displayColors.accent || brandRgb, '--token-rgb-accent-day': displayColors.accentDay || brandRgb }}>
      <div className="rz-lite-hero-glow" />
      <div className="rz-lite-hero-accent" />
      <div className="rz-lite-hero-left">
        <div className="rz-lite-hero-actions">
          <button type="button" className={`rz-lite-hero-star${inWatchlist ? ' rz-lite-hero-star--active' : ''}`} aria-label={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'} title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'} onClick={handleWatchlistToggle}>
            {icons.star}
          </button>
          {onOpenHistory && (
            <button
              type="button"
              className="rz-lite-hero-history"
              onClick={onOpenHistory}
              aria-label={t('researchPro.heroBanner.rzherobanner.ariaRecentTokensAltH', "Recent tokens (Alt+H)")}
              title={t('researchPro.heroBanner.rzherobanner.title', "Recent tokens · Alt+H")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
                <path d="M12 7v5l3 2" />
              </svg>
            </button>
          )}
        </div>
        <div className="rz-lite-hero-logo-wrap">
          {isStock ? (
            loading
              ? <span className="rz-skeleton rz-skeleton--circle" style={{ width: 36, height: 36 }} />
              : <RzStockLogo symbol={symbol} />
          ) : (
            // Crypto: RzHeroLogo renders even while `loading` so a known major's
            // seeded CG logo paints on first render instead of waiting for the
            // data hook; it shows its own shimmer until the image is ready.
            <RzHeroLogo url={tokenLogo} symbol={symbol} loading={loading} />
          )}
          {/* The corner badge overlaps the logo tile, so it only ever holds a
              SHORT value. A crypto rank ("#12") fits; an exchange name does
              not - "NASDAQ NMS - GLOBAL MARKET" wrapped straight across the
              logo and read as a corrupted image. Stocks show their venue in
              the identity line below instead, where it has room. */}
          {!loading && !isStock && tokenData.rank ? (
            <span className="rz-lite-hero-rank">#{tokenData.rank}</span>
          ) : null}
        </div>
        <div className="rz-lite-hero-identity">
          <span className="rz-lite-hero-name">{loading ? symbol : tokenName}</span>
          {loading ? (
            <span className="rz-skeleton rz-skeleton--ticker" />
          ) : (
            <span className="rz-lite-hero-ticker">
              {symbol}
              {isStock && tokenData.exchange ? ` · ${shortExchange(tokenData.exchange)}` : ''}
              {categoryLabel ? ` · ${categoryLabel}` : ''}
            </span>
          )}
        </div>
      </div>
      {/* The hero's middle slot. On crypto it holds the What-If calculator; on a
          stock that slot used to sit empty across the full width of the banner
          while the next-earnings print took a separate row below the hero. The
          print lives here now — same row, no extra chrome. */}
      <div className={`rz-lite-hero-mid${showHeroEarnings ? ' rz-lite-hero-mid--earn' : ''}`}>
        {!loading && !isStock && cgId && (
          <RzWhatIf
            symbol={symbol}
            currentPrice={Number(displayPrice)}
            cgId={cgId}
            fmtPrice={fmtPriceFn || fmtPrice}
          />
        )}
        {showHeroEarnings && (
          <RzHeroEarnings
            reported={reportedEarnings}
            earningsDate={tokenData.earningsDate}
            earningsAvg={tokenData.earningsAvg}
            revenueAvg={tokenData.revenueAvg}
            earningsHistory={tokenData.earningsHistory}
          />
        )}
        <HeroSocialLinks symbol={symbol} aboutDetails={aboutDetails} icons={icons} />
      </div>
      <div className="rz-lite-hero-price-block">
        {loading ? (
          <>
            <span className="rz-skeleton rz-skeleton--price" />
            <span className="rz-skeleton rz-skeleton--change" />
          </>
        ) : (
          <>
            <span className="rz-lite-hero-price">{fmtPrice(displayPrice)}</span>
            <span className={`rz-lite-hero-change ${tokenData.change24h >= 0 ? 'up' : 'down'}`}>
              <span className="rz-lite-hero-change-pill">
                {tokenData.change24h >= 0 ? '+' : ''}{formatChange(tokenData.change24h)}%
              </span>
              <span className="rz-lite-hero-change-label">24h</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
})

export default RzHeroBanner
