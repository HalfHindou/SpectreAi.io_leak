# Stock Mode Fix Plan

## Current Issues
1. **TokenTicker (scrolling top bar)** - Hardcoded crypto, no stock support
2. **Trending Badge** - Always shows crypto trending tokens
3. **Watchlist** - Crypto-only, no stock watchlist support
4. **Search** - Stock search not working properly

## Components to Fix

### 1. TokenTicker.jsx (CRITICAL)
**Location:** `/src/components/TokenTicker.jsx`
**Issue:** Hardcoded crypto symbols, uses crypto-only APIs

**Fix:**
- Add `marketMode` prop
- When `marketMode='stocks'`: show stock prices (SPY, QQQ, AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, JPM)
- Use `useStockPrices()` hook for stock data
- Keep crypto logic for `marketMode='crypto'`

### 2. WelcomePage.jsx - Trending Section (CRITICAL)
**Location:** Lines 2565-2773

**Issue:**
- TokenTicker always receives `trendingTokens` (crypto)
- Trending badge always shows crypto

**Fix:**
- Pass `marketMode` to TokenTicker
- When `isStocks`, use `stockGainers` for trending badge instead of `trendingTokens`
- Create unified trending data: `activeTrending = isStocks ? stockGainers : trendingTokens`

### 3. WatchlistsPage.jsx (CRITICAL)
**Location:** `/src/components/WatchlistsPage.jsx`

**Issue:**
- Only uses crypto search (`useTokenSearch`)
- Only fetches crypto prices (`useWatchlistPrices`)
- Table columns are crypto-specific

**Fix:**
- Add `marketMode` prop from parent
- When stocks mode: use `useStockSearch()` for adding
- Separate storage: `stockWatchlist` vs `cryptoWatchlist`
- Update table columns for stocks (Price, Change, Sector, P/E, Volume)

### 4. Header.jsx - Search (MEDIUM)
**Location:** Already partially done

**Issue:** Stock search might not be returning results

**Fix:**
- Verify `useStockSearch()` works with Yahoo Finance API
- Test search for "AAPL", "MSFT" etc.

## Implementation Order
1. TokenTicker - Add stock mode support
2. WelcomePage - Connect trending to stocks
3. WatchlistsPage - Stock watchlist support
4. Verify Header search works

## Files to Modify
1. `/src/components/TokenTicker.jsx`
2. `/src/components/WelcomePage.jsx`
3. `/src/components/WatchlistsPage.jsx`
4. `/src/hooks/useStockData.js` (verify search works)
