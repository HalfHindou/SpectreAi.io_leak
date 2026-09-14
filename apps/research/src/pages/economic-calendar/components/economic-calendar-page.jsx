/**
 * EconomicCalendarPage — Main page component
 *
 * Layout flow:
 *   Flat header (dot + title + filter)
 *   → NextUpHero (minimal inline text)
 *   → CountdownSidebar (horizontal pills)
 *   → Calendar Panel (glass card: view tabs + date nav + calendar view)
 *   → MarketContext → WhatsNext
 *
 * Date navigation is INSIDE the panel bar (next to tabs)
 * so the user always knows what date range they're looking at.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import useCalendarData from '../hooks/useCalendarData'
import useCalendarBundle from '../hooks/useCalendarBundle'
import useFilters from '../hooks/useFilters'
import useMarketRegime from '../hooks/useMarketRegime'
import useThemes from '../hooks/useThemes'
import useSearch from '../hooks/useSearch'
import useBookmarks from '../hooks/useBookmarks'
import useKeyboardNav from '../hooks/useKeyboardNav'
import useEventNotifications from '../hooks/useEventNotifications'
import useCustomAlerts from '../hooks/useCustomAlerts'
import useEventResultsMode from '../hooks/useEventResultsMode'
import { isToday } from '../utils/timezone'
import { downloadICS } from '../utils/icsExport'
import { buildGoogleCalendarUrl } from '../utils/googleCalendar'

import CalendarHeader from './CalendarHeader'
import CalendarLegend from './CalendarLegend'
import FilterPanel from './FilterPanel'
import NextUpHero from './NextUpHero'
import CountdownSidebar from './CountdownSidebar'
import InflationJobsWatch from './InflationJobsWatch'
import MarketOutlook from './MarketOutlook'
import MarketContext from './MarketContext'
// Default view is 'month' — Day/Week only render on tab click. Lazy
// keeps the calendar's initial bundle from carrying all three view trees.
const DayView = lazy(() => import('./DayView'))
const WeekView = lazy(() => import('./WeekView'))
import MonthView from './MonthView'
// EventDetail import removed — referenced here but never rendered in
// this file. Actual <EventDetail> render lives inside EventRow.jsx.
import WhatsNext from './WhatsNext'
import IntelSidebar from './IntelSidebar'
// CustomAlertBuilder is a modal — only mounts when alertsOpen=true.
const CustomAlertBuilder = lazy(() => import('./CustomAlertBuilder'))
import ViewTransition from './ViewTransition'
import { SkeletonDayView, SkeletonWeekView, SkeletonMonthView } from './SkeletonLoaders'

import './economic-calendar-page.css'
import './economic-calendar-page.mobile.css'

const VIEW_OPTIONS = [
  { id: 'day', labelKey: 'economicCalendar.viewDay', labelFallback: 'Day' },
  { id: 'week', labelKey: 'economicCalendar.viewWeek', labelFallback: 'Week' },
  { id: 'month', labelKey: 'economicCalendar.viewMonth', labelFallback: 'Month' },
]

const ChevronLeftSmall = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const ChevronRightSmall = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const EconomicCalendarPage = ({ dayMode, isMobile }) => {
  const { t } = useTranslation()
  const { fmtPrice } = useCurrency()
  // State
  const [view, setView] = useState('month') // 'day' | 'week' | 'month'
  const [currentDate, setCurrentDate] = useState(new Date())
  const [filterOpen, setFilterOpen] = useState(false)
  const [expandedEventId, setExpandedEventId] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const searchInputRef = useRef(null)
  const filterBtnRef = useRef(null)

  // Below-fold gating. MarketContext + MarketOutlook live below the calendar
  // panel and depend on `useMarketRegime` (5 calls) and `useThemes` (2 calls).
  // Defer those until the section is about to enter the viewport so cold load
  // only pays for above-the-fold data. `belowFoldReady` latches to true once
  // the observer fires — we never flip it back.
  const belowFoldRef = useRef(null)
  const [belowFoldReady, setBelowFoldReady] = useState(false)
  useEffect(() => {
    if (belowFoldReady) return
    const el = belowFoldRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setBelowFoldReady(true)
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        setBelowFoldReady(true)
        io.disconnect()
      }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [belowFoldReady])

  // One-shot bundle on mount: events + analysis + themes + verdict + history
  // in a single round-trip. The individual hooks below seed from this so they
  // skip their own first fetch. Polling still happens via the hooks.
  const initialDateRef = useRef(currentDate)
  const bundleRange = useMemo(() => {
    const d = initialDateRef.current
    const from = new Date(d.getFullYear(), d.getMonth() - 1, 1)
    const to = new Date(d.getFullYear(), d.getMonth() + 2, 0)
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
  }, [])
  const { data: bundle } = useCalendarBundle(bundleRange)

  // Hooks
  const {
    events,
    loading,
    analysis,
    analysisLoading,
    getEventsForDate,
    getEventsForWeek,
    getEventsForMonth,
    getNextCriticalEvent,
    getUpcomingEvents,
  } = useCalendarData(currentDate, {
    initialEvents: bundle?.events,
    initialAnalysis: bundle?.analysis?.analysis ? bundle.analysis.analysis : null,
  })

  const filters = useFilters()
  // Only <MarketContext> (desktop-only, line ~663) consumes these; the mobile
  // branch returns early at :310 without it, so on mobile they fetched ~7
  // requests whose data was discarded. Gate them off on mobile.
  const liveRegime = useMarketRegime({ fmtPrice, enabled: belowFoldReady && !isMobile })
  const { themes: liveThemes, loading: themesLoading, history: themeHistory, historyLoading } = useThemes({
    enabled: belowFoldReady && !isMobile,
    initialThemes: bundle?.themes,
    initialHistory: bundle?.history,
  })
  const bookmarks = useBookmarks()
  const customAlerts = useCustomAlerts(events)

  // Apply categorical filters first, then search
  const filteredByCategory = useMemo(() => {
    let evts
    if (view === 'day') evts = getEventsForDate(currentDate)
    else if (view === 'week') evts = getEventsForWeek(currentDate)
    else evts = getEventsForMonth(currentDate)
    return filters.applyFilters(evts)
  }, [view, currentDate, events, filters])

  const search = useSearch(filteredByCategory)

  // Derived data
  const nextCritical = useMemo(() => getNextCriticalEvent(), [events])
  const upcomingEvents = useMemo(() => getUpcomingEvents(5), [events])

  // NEXT KEY EVENTS (Market Outlook) — only events that actually move markets.
  // Critical (US marquee prints: CPI/PPI/PCE, NFP, FOMC, GDP, Michigan) own
  // the four slots; 'high' (BoJ/BoE/RBA, EU prints, secondary US data) only
  // fills what's left. Plain date order let four secondary central-bank
  // decisions crowd out FOMC + PCE entirely (2026-06-11).
  const keyMacroEvents = useMemo(() => {
    const now = Date.now()
    const future = events.filter((e) =>
      (e.event_type ? e.event_type === 'macro' : !e.isCrypto) &&
      new Date(e.dateTime).getTime() > now &&
      (e.actual === null || e.actual === undefined)
    )
    const critical = future.filter((e) => e.impact === 'critical')
    const high = future.filter((e) => e.impact === 'high')
    // De-dupe by name: a multi-day event (the Jackson Hole symposium runs
    // Thu-Sat as three separate rows) otherwise takes half the list and pushes
    // the Fed Chair's keynote and the payrolls revision out of it. `events` is
    // date-sorted, so the first occurrence is the earliest.
    const seen = new Set()
    const out = []
    for (const e of critical.concat(high)) {
      const key = (e.name || e.nameShort || '').toLowerCase().trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(e)
      if (out.length === 4) break
    }
    return out
  }, [events])

  // Event results mode — switches hero from countdown to results when events release
  const eventResults = useEventResultsMode(events, nextCritical)

  const visibleEvents = search.filteredEvents
  const selectedEvent = useMemo(() => {
    if (!expandedEventId) return null
    return events.find(e => e.id === expandedEventId) || null
  }, [expandedEventId, events])
  const notifications = useEventNotifications(events)
  const keyboard = useKeyboardNav({
    events: visibleEvents,
    expandedEventId,
    onEventToggle: (id) => setExpandedEventId(prev => prev === id ? null : id),
    onDateChange: (dir) => handleDateChange(dir),
    onViewChange: setView,
    onToday: () => setCurrentDate(new Date()),
    onSearchOpen: () => {
      setSearchOpen(prev => {
        if (prev) search.clearSearch()
        return !prev
      })
      setTimeout(() => searchInputRef.current?.focus(), 50)
    },
    onFilterClose: () => setFilterOpen(false),
    onBookmarkToggle: bookmarks.toggleBookmark,
    searchOpen,
  })

  // Date label for the panel bar
  const dateLabel = useMemo(() => {
    const d = new Date(currentDate)
    if (isNaN(d.getTime())) return ''
    if (view === 'day') {
      return d.toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
      })
    }
    if (view === 'week') {
      const start = new Date(d)
      const dayOfWeek = start.getDay()
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      start.setDate(d.getDate() + mondayOffset)
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      const fmt = { month: 'short', day: 'numeric' }
      return `${start.toLocaleDateString('en-US', fmt)} \u2013 ${end.toLocaleDateString('en-US', { ...fmt, year: 'numeric' })}`
    }
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [currentDate, view])

  // Handlers
  const handleDateChange = useCallback((direction) => {
    setCurrentDate(prev => {
      const d = new Date(prev)
      if (view === 'day') d.setDate(d.getDate() + direction)
      else if (view === 'week') d.setDate(d.getDate() + direction * 7)
      else d.setMonth(d.getMonth() + direction)
      return d
    })
  }, [view])

  const handleToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  const handleEventToggle = useCallback((eventId) => {
    setExpandedEventId(prev => prev === eventId ? null : eventId)
  }, [])

  const handleDayClick = useCallback((date) => {
    setCurrentDate(date)
    setView('day')
  }, [])

  const handleEventClick = useCallback((eventId) => {
    setExpandedEventId(eventId)
    setTimeout(() => {
      const el = document.getElementById(`event-${eventId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }, [])

  const handleSearchToggle = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) search.clearSearch()
      return !prev
    })
    setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [search])

  const handleSearchKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      search.clearSearch()
      setSearchOpen(false)
    }
  }, [search])

  const handleExport = useCallback(() => {
    const eventsToExport = visibleEvents.length > 0 ? visibleEvents : events
    downloadICS(eventsToExport, 'spectre-economic-calendar.ics')
  }, [visibleEvents, events])

  const handleGoogleCalendar = useCallback(() => {
    if (!nextCritical) return
    const url = buildGoogleCalendarUrl(nextCritical)
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [nextCritical])

  /* ═══════════════════════════════════════════
     MOBILE LAYOUT
     ═══════════════════════════════════════════ */
  if (isMobile) {
    return (
      <div className={`ec-page mec-page${dayMode ? ' day-mode' : ''}`}>
        <div className="mec-content">
          {/* Header spacer */}
          <div className="mec-header-spacer" aria-hidden="true" />

          {/* Page title + filter */}
          <div className="mec-section mec-title-row">
            <span className="mec-section-label">{t('economicCalendar.pageTitle', 'Economic Calendar')}</span>
            <button
              className={`mec-filter-btn${filterOpen ? ' mec-filter-btn--active' : ''}`}
              onClick={() => setFilterOpen(p => !p)}
              ref={filterBtnRef}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {filters.isModified && (
                <span className="mec-filter-dot" />
              )}
            </button>
          </div>

          {/* Filter panel */}
          {filterOpen && (
            <div className="mec-section">
              <FilterPanel
                filters={filters}
                onToggle={filters.toggleFilter}
                onReset={filters.resetFilters}
                onClose={() => setFilterOpen(false)}
                anchorRef={filterBtnRef}
              />
            </div>
          )}

          {/* Next event hero - compact */}
          <div className="mec-section">
            <NextUpHero
              event={nextCritical}
              mode={eventResults.mode}
              resultEvent={eventResults.resultEvent}
              brief={eventResults.brief}
              briefLoading={eventResults.briefLoading}
              hasBack={eventResults.hasBack}
              hasForward={eventResults.hasForward}
              onBack={eventResults.goBack}
              onForward={eventResults.goForward}
              currentIndex={eventResults.currentIndex}
              totalResults={eventResults.totalResults}
              countdownEvent={eventResults.countdownEvent}
            />
          </div>

          {/* Upcoming event pills */}
          <div className="mec-section-flush">
            <CountdownSidebar
              events={upcomingEvents}
              onEventClick={handleEventClick}
            />
          </div>

          {/* Inflation & Jobs Watch — data-dependent-Fed readiness */}
          <div className="mec-section">
            <InflationJobsWatch
              events={events}
              loading={loading}
              compact
              onSeriesClick={handleEventClick}
            />
          </div>

          {/* View tabs (Day/Week/Month) */}
          <div className="mec-section mec-tabs-row">
            <div className="mec-tabs">
              {VIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  className={`mec-tab${view === opt.id ? ' mec-tab--active' : ''}`}
                  onClick={() => setView(opt.id)}
                >
                  {t(opt.labelKey, opt.labelFallback)}
                </button>
              ))}
            </div>

            {/* Search toggle */}
            <button className="mec-search-btn" onClick={handleSearchToggle}>
              <SearchIcon />
            </button>
          </div>

          {/* Search input */}
          {searchOpen && (
            <div className="mec-section">
              <div className="mec-search-bar">
                <SearchIcon />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="mec-search-input"
                  placeholder={t('economicCalendar.searchEvents', 'Search events...')}
                  value={search.query}
                  onChange={(e) => search.setQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  autoFocus
                />
                {search.query && (
                  <button className="mec-search-clear" onClick={() => search.clearSearch()}>
                    <CloseIcon />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Date navigation */}
          <div className="mec-section mec-date-row">
            <button className="mec-arrow" onClick={() => handleDateChange(-1)}>
              <ChevronLeftSmall />
            </button>
            <span className="mec-date-label">{dateLabel}</span>
            <button className="mec-arrow" onClick={() => handleDateChange(1)}>
              <ChevronRightSmall />
            </button>
            {!isToday(currentDate) && (
              <button className="mec-today-btn" onClick={handleToday}>{t('economicCalendar.today', 'Today')}</button>
            )}
          </div>

          {/* Event count + star hint */}
          <div className="mec-section mec-count-row">
            <span className="mec-event-count">
              {t('economicCalendar.eventCount', { count: visibleEvents.length, defaultValue: '{{count}} events' })}
            </span>
            <span className="mec-star-hint">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span>{t('economicCalendar.tapStarToSave', 'Tap star to save')}</span>
            </span>
          </div>

          {/* Calendar view */}
          <div className="mec-section-flush mec-calendar-body">
            {loading && view === 'day' && <SkeletonDayView />}
            {loading && view === 'week' && <SkeletonWeekView />}
            {loading && view === 'month' && <SkeletonMonthView />}
            <Suspense fallback={null}>
            {!loading && view === 'day' && (
              <DayView
                events={visibleEvents}
                allEvents={events}
                date={currentDate}
                expandedEventId={expandedEventId}
                focusedEventId={keyboard.focusedEventId}
                onEventToggle={handleEventToggle}
                showLowImpact={filters.showLowImpact}
                bookmarks={bookmarks}
              />
            )}
            {!loading && view === 'week' && (
              <WeekView
                events={visibleEvents}
                currentDate={currentDate}
                onDayClick={handleDayClick}
                onEventClick={handleEventClick}
              />
            )}
            </Suspense>
            {!loading && view === 'month' && (
              <MonthView
                events={visibleEvents}
                currentDate={currentDate}
                onDayClick={handleDayClick}
              />
            )}
            {!loading && <CalendarLegend />}
          </div>

          {/* Market Outlook - compact */}
          <div className="mec-section" ref={belowFoldRef}>
            <MarketOutlook analysis={analysis} loading={analysisLoading} upcomingEvents={keyMacroEvents} />
          </div>

          {/* Bottom spacer for nav clearance */}
          <div className="mec-bottom-spacer" aria-hidden="true" />
        </div>
      </div>
    )
  }

  /* ═══════════════════════════════════════════
     DESKTOP LAYOUT
     ═══════════════════════════════════════════ */
  return (
    <div className={`ec-page${dayMode ? ' day-mode' : ''}`}>
      {/* Header — flat row, just title + filter */}
      <CalendarHeader
        onFilterToggle={() => setFilterOpen(p => !p)}
        filterOpen={filterOpen}
        filterBtnRef={filterBtnRef}
        notificationsEnabled={notifications.notificationsEnabled}
        scheduledCount={notifications.scheduledCount}
        onNotificationToggle={() => {
          if (notifications.notificationsEnabled) notifications.disable()
          else notifications.requestPermission()
        }}
        onExport={handleExport}
        onGoogleCalendar={nextCritical ? handleGoogleCalendar : undefined}
        onAlerts={() => setAlertsOpen(true)}
        alertCount={customAlerts.activeCount}
        filterDropdown={filterOpen ? (
          <FilterPanel
            filters={filters}
            onToggle={filters.toggleFilter}
            onReset={filters.resetFilters}
            onClose={() => setFilterOpen(false)}
            anchorRef={filterBtnRef}
          />
        ) : null}
      />

      {/* Next event / Event results — dual mode banner */}
      <NextUpHero
        event={nextCritical}
        mode={eventResults.mode}
        resultEvent={eventResults.resultEvent}
        brief={eventResults.brief}
        briefLoading={eventResults.briefLoading}
        hasBack={eventResults.hasBack}
        hasForward={eventResults.hasForward}
        onBack={eventResults.goBack}
        onForward={eventResults.goForward}
        currentIndex={eventResults.currentIndex}
        totalResults={eventResults.totalResults}
        countdownEvent={eventResults.countdownEvent}
      />

      {/* Upcoming pills */}
      <CountdownSidebar
        events={upcomingEvents}
        onEventClick={handleEventClick}
      />

      {/* 2-column layout: main + sidebar (desktop only) */}
      <div className="ec-layout">
        <div className="ec-layout__main">
          {/* Calendar Panel — glass card with tabs + date nav + calendar */}
          <div className="ec-panel">
            <div className="ec-panel__bar">
              {/* Left: view tabs */}
              <div className="ec-panel__tabs">
                {VIEW_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    className={`ec-panel__tab${view === opt.id ? ' ec-panel__tab--active' : ''}`}
                    onClick={() => setView(opt.id)}
                  >
                    {t(opt.labelKey, opt.labelFallback)}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className={`ec-panel__search${searchOpen ? ' ec-panel__search--open' : ''}`}>
                <button className="ec-panel__search-btn" onClick={handleSearchToggle} title={t('economicCalendar.searchEventsTitle', 'Search events')}>
                  <SearchIcon />
                </button>
                {searchOpen && (
                  <>
                    <input
                      ref={searchInputRef}
                      type="text"
                      className="ec-panel__search-input"
                      placeholder={t('economicCalendar.searchEvents', 'Search events...')}
                      value={search.query}
                      onChange={(e) => search.setQuery(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                    />
                    {search.query && (
                      <button className="ec-panel__search-clear" onClick={() => search.clearSearch()}>
                        <CloseIcon />
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Center: date navigation */}
              <div className="ec-panel__nav">
                <button className="ec-panel__arrow" onClick={() => handleDateChange(-1)} title={t('economicCalendar.previous', 'Previous')}>
                  <ChevronLeftSmall />
                </button>
                <span className="ec-panel__date">{dateLabel}</span>
                <button className="ec-panel__arrow" onClick={() => handleDateChange(1)} title={t('economicCalendar.next', 'Next')}>
                  <ChevronRightSmall />
                </button>
                <button className="ec-panel__today" onClick={handleToday}>{t('economicCalendar.today', 'Today')}</button>
              </div>

              {/* Right: event count */}
              <span className="ec-panel__count">
                {t('economicCalendar.eventCount', { count: visibleEvents.length, defaultValue: '{{count}} events' })}
              </span>
            </div>

            <div className="ec-panel__body">
              <ViewTransition viewKey={view}>
                {loading && view === 'day' && <SkeletonDayView />}
                {loading && view === 'week' && <SkeletonWeekView />}
                {loading && view === 'month' && <SkeletonMonthView />}
                <Suspense fallback={null}>
                {!loading && view === 'day' && (
                  <DayView
                    events={visibleEvents}
                    allEvents={events}
                    date={currentDate}
                    expandedEventId={expandedEventId}
                    focusedEventId={keyboard.focusedEventId}
                    onEventToggle={handleEventToggle}
                    showLowImpact={filters.showLowImpact}
                    bookmarks={bookmarks}
                  />
                )}
                {!loading && view === 'week' && (
                  <WeekView
                    events={visibleEvents}
                    currentDate={currentDate}
                    onDayClick={handleDayClick}
                    onEventClick={handleEventClick}
                  />
                )}
                </Suspense>
                {!loading && view === 'month' && (
                  <MonthView
                    events={visibleEvents}
                    currentDate={currentDate}
                    onDayClick={handleDayClick}
                  />
                )}
              </ViewTransition>
              {!loading && <CalendarLegend />}
            </div>
          </div>

          {/* Market Outlook — analysis glass card */}
          <div ref={belowFoldRef}>
            <MarketOutlook analysis={analysis} loading={analysisLoading} upcomingEvents={keyMacroEvents} />
          </div>

          {/* Market Context — Key Focus + Narrative + Regime + Themes + History */}
          <MarketContext
            regime={liveRegime}
            themes={liveThemes}
            themesLoading={themesLoading}
            history={themeHistory}
            historyLoading={historyLoading}
            verdict={liveRegime?.verdict}
            thesis={analysis?.marketThesis}
          />
        </div>

        <div className="ec-layout__side">
          {/* Inflation & Jobs Watch — right rail, the releases that drive a data-dependent Fed */}
          <InflationJobsWatch
            events={events}
            loading={loading}
            variant="rail"
            onSeriesClick={handleEventClick}
          />

          <IntelSidebar
            nextCritical={nextCritical}
            bookmarks={bookmarks}
            events={events}
            upcomingEvents={upcomingEvents}
            notificationsEnabled={notifications.notificationsEnabled}
            scheduledCount={notifications.scheduledCount}
            onEventClick={handleEventClick}
            selectedEvent={selectedEvent}
          />
        </div>
      </div>

      {/* What's Next Strip */}
      <WhatsNext events={events} />

      {/* Custom Alert Builder Modal */}
      {alertsOpen && (
        <Suspense fallback={null}>
          <CustomAlertBuilder
            alerts={customAlerts.alerts}
            onAdd={customAlerts.addAlert}
            onRemove={customAlerts.removeAlert}
            onToggle={customAlerts.toggleAlert}
            onClose={() => setAlertsOpen(false)}
          />
        </Suspense>
      )}

    </div>
  )
}

export default EconomicCalendarPage
