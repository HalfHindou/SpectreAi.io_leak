/**
 * CCFullViewOverlay - Command Center full-screen overlay (portaled)
 * Shows expanded version of the active CC tab with same tab navigation.
 */
import React, { Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { createPortal } from 'react-dom'
import useSettingsStore from '@/store/useSettingsStore'
import spectreIcons from '@/icons/spectreIcons'
import { marketAiTabIcons } from './welcome-page-icons'
import BriefTabContent from './brief-tab-content'
const AiMarketPanel = lazy(() => import('./ai-market-panel'))
import NewsTabPanel from './news-tab-panel'
import HeatmapCommandPanel from './heatmap-command-panel'
import SectorsTabPanel from './sectors-tab-panel'
import WalletsTabPanel from './wallets-tab-panel'
import MindshareTabPanel from './mindshare-tab-panel'
import CalendarMiniPanel from './calendar-mini-panel'
import EtfFlowsView from '@/components/etf/etf-flows-view'
// Same real heatmap the inline Command Center renders. The overlay used to
// hardcode the Coming Soon placeholder here, so the tab worked inline and
// went dead the moment the user went fullscreen.
const LiqHeatmapPanel = lazy(() => import('@/components/liq-heatmap-panel'))

const CCFullViewOverlay = ({
  briefFullViewOpen, setBriefFullViewOpen,
  fullViewTab, setFullViewTab, setMarketAiTab,
  handleShareBrief, isBriefShareExporting,
  // Brief tab props
  briefPausedRef, handleBriefTouchStart, handleBriefTouchEnd,
  briefDisplay, briefFading, terminalIsFullBrief,
  allBriefStatements, briefIndex, goToBrief, getTerminalBriefInterval,
  topCoinPrices, stockPrices, macroAnalysisData,
  fearGreed, liveVix, marketStructureTrio, marketFlowSummary, sentimentRgb, biasRgb,
  isStocks, dayMode, t,
  // Analysis tab
  marketAiTimeframe, setMarketAiTimeframe,
  // News tab
  newsXToggle, setNewsXToggle, newsItems, newsLoading,
  xPosts, xPostsLoading, xPostsError, onRetryXPosts,
  // Heatmaps tab
  heatmapTokens, topCoinsTokens, fmtPrice, openTokenCardPopup,
  heatmapsBubblesToggle, setHeatmapsBubblesToggle,
  // Liquidation tab - { symbol, setSymbol } shared with the inline panel so
  // the pair the user picked survives entering/leaving fullscreen
  liqProps,
  // Mindshare tab
  intelLastUpdated,
}) => {
  const toggleDayMode = useSettingsStore((s) => s.toggleDayMode)

  if (!briefFullViewOpen) return null

  return createPortal(
    <div className={`cc-fullview-overlay${dayMode ? ' day-mode app-day-mode' : ''}`} onClick={() => setBriefFullViewOpen(false)}>
      <div className="cc-fullview-widget" onClick={e => e.stopPropagation()}>
        <div className="cc-fullview-header">
          <div className="cc-fullview-title">
            <span className="welcome-market-ai-icon">{spectreIcons.ai}</span>
            <span>{t('commandCenter.title')}</span>
          </div>
          <div className="cc-fullview-tabs-row">
            <div className="cc-fullview-tabs welcome-market-ai-tabs">
              {(() => {
                const isShowcaseEmbed = (() => {
                  if (typeof window === 'undefined') return false
                  try {
                    const params = new URLSearchParams(window.location.search)
                    if (params.get('embed') === 'showcase') return true
                    if (window.self !== window.top) return true
                  } catch { return true }
                  return false
                })()
                const ALLOWED_CC_TABS = new Set(['brief', 'analysis', 'news', 'posts', 'heatmaps'])
                const tabs = [
                  { id: 'brief', label: t('commandCenter.aiBrief') },
                  { id: 'analysis', label: t('commandCenter.aiMarket') },
                  { id: 'news', label: t('commandCenter.news') },
                  { id: 'posts', label: t('commandCenter.posts', 'Posts') },
                  { id: 'heatmaps', label: t('commandCenter.heatmaps') },
                  { id: 'liquidation', label: t('commandCenter.liquidation') },
                  { id: 'sector', label: t('commandCenter.sectors') },
                  { id: 'mindshare', label: t('commandCenter.mindshare') },
                  { id: 'calendar', label: t('commandCenter.calendar') },
                  { id: 'flows', label: t('commandCenter.flows') },
                  { id: 'wallets', label: t('commandCenter.wallets') },
                ].map((t) => ({ ...t, locked: isShowcaseEmbed && !ALLOWED_CC_TABS.has(t.id) }))
                return tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`welcome-market-ai-tab ${fullViewTab === tab.id ? 'active' : ''}${tab.locked ? ' cc-tab-locked' : ''}`}
                    onClick={() => {
                      if (tab.locked) {
                        try {
                          window.dispatchEvent(new CustomEvent('spectre:showcase-lock', {
                            detail: { source: 'cc-fullview', tab: tab.id },
                          }))
                        } catch { /* noop */ }
                        return
                      }
                      setFullViewTab(tab.id)
                      if (setMarketAiTab) setMarketAiTab(tab.id)
                    }}
                    aria-disabled={tab.locked || undefined}
                    title={tab.locked ? t('commandCenter.availableInBeta', 'Available in Beta') : undefined}
                  >
                    <span className="welcome-market-ai-tab-icon" aria-hidden>{marketAiTabIcons[tab.id]}</span>
                    <span>{tab.label}</span>
                    {tab.locked && (
                      <span className="cc-tab-lock-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                        </svg>
                      </span>
                    )}
                  </button>
                ))
              })()}
            </div>
          </div>
          <div className="cc-header-actions">
            <button
              type="button"
              className={`cc-fullview-theme-toggle${dayMode ? ' is-day' : ''}`}
              onClick={toggleDayMode}
              title={dayMode ? t('commandCenter.switchToDark', 'Switch to Dark') : t('commandCenter.switchToLight', 'Switch to Light')}
            >
              {dayMode
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              }
            </button>
            <button
              type="button"
              className="cc-tab-action-btn"
              onClick={handleShareBrief}
              disabled={isBriefShareExporting}
              title={t('commandCenter.shareToX', 'Share to X')}
            >
              {isBriefShareExporting ? (
                <span className="cc-tab-action-loading" />
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  <span>{t('common.share', 'Share')}</span>
                </>
              )}
            </button>
            <button className="cc-fullview-close" onClick={() => setBriefFullViewOpen(false)} title={t('commandCenter.closeEsc', 'Close (Esc)')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="cc-fullview-content">
          {/* Render the same tab content as the inline Command Center */}
          {fullViewTab === 'brief' && (
            <BriefTabContent
              briefPausedRef={briefPausedRef}
              handleBriefTouchStart={handleBriefTouchStart}
              handleBriefTouchEnd={handleBriefTouchEnd}
              briefDisplay={briefDisplay}
              briefFading={briefFading}
              terminalIsFullBrief={terminalIsFullBrief}
              allBriefStatements={allBriefStatements}
              briefIndex={briefIndex}
              goToBrief={goToBrief}
              getTerminalBriefInterval={getTerminalBriefInterval}
              topCoinPrices={topCoinPrices}
              stockPrices={stockPrices}
              macroAnalysisData={macroAnalysisData}
              fearGreed={fearGreed}
              liveVix={liveVix}
              marketStructureTrio={marketStructureTrio}
              sentimentRgb={sentimentRgb}
              biasRgb={biasRgb}
              isStocks={isStocks}
              t={t}
            />
          )}
          {fullViewTab === 'analysis' && (
            macroAnalysisData
              ? <Suspense fallback={<div className="welcome-market-ai-analysis-full"><div className="ai-mkt-loading"><div className="ai-mkt-loading-pulse" /><span>{t('ui.analyzingMarketData')}</span></div></div>}><AiMarketPanel macroAnalysisData={macroAnalysisData} marketStructureTrio={marketStructureTrio} marketAiTimeframe={marketAiTimeframe} setMarketAiTimeframe={setMarketAiTimeframe} /></Suspense>
              : <div className="welcome-market-ai-analysis-full"><div className="ai-mkt-loading"><div className="ai-mkt-loading-pulse" /><span>{t('ui.analyzingMarketData')}</span></div></div>
          )}
          {fullViewTab === 'news' && (
            <NewsTabPanel newsXToggle={false} setNewsXToggle={setNewsXToggle} newsItems={newsItems || []} newsLoading={!!newsLoading} isStocks={isStocks} t={t} xPosts={xPosts} xPostsLoading={xPostsLoading} xPostsError={xPostsError} onRetryXPosts={onRetryXPosts} hideToggle />
          )}
          {fullViewTab === 'posts' && (
            <NewsTabPanel newsXToggle={true} setNewsXToggle={setNewsXToggle} newsItems={newsItems || []} newsLoading={!!newsLoading} isStocks={isStocks} t={t} xPosts={xPosts} xPostsLoading={xPostsLoading} xPostsError={xPostsError} onRetryXPosts={onRetryXPosts} hideToggle />
          )}
          {fullViewTab === 'heatmaps' && (
            <HeatmapCommandPanel
              heatmapTokens={heatmapTokens}
              topCoinsTokens={topCoinsTokens}
              topCoinPrices={topCoinPrices}
              fmtPrice={fmtPrice}
              openTokenCardPopup={openTokenCardPopup}
              isStocks={isStocks}
              dayMode={dayMode}
              showBubbles={heatmapsBubblesToggle}
              onToggleBubbles={setHeatmapsBubblesToggle}
            />
          )}
          {fullViewTab === 'liquidation' && (
            <Suspense fallback={null}>
              <LiqHeatmapPanel
                symbol={liqProps?.symbol}
                setSymbol={liqProps?.setSymbol}
                enabled
                dayMode={dayMode}
                fmtPrice={fmtPrice}
                height={640}
              />
            </Suspense>
          )}
          {fullViewTab === 'sector' && (
            <SectorsTabPanel />
          )}
          {fullViewTab === 'mindshare' && (
            <MindshareTabPanel topCoinPrices={topCoinPrices} />
          )}
          {fullViewTab === 'calendar' && <CalendarMiniPanel />}
          {fullViewTab === 'flows' && <EtfFlowsView />}
          {fullViewTab === 'wallets' && <WalletsTabPanel />}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CCFullViewOverlay
