/**
 * FlightControls — Bottom-right floating control pill for the graph viewport.
 *
 * Provides zoom in/out, reset view, fullscreen toggle, and day/dark mode switch.
 */

// ── Icons ────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 8h10" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8a5 5 0 019.5-1.5M13 8a5 5 0 01-9.5 1.5" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

function FullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
    </svg>
  )
}

function ExitFullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2v4H2M10 6h4V2M10 14v-4h4M6 10H2v4" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 8.5a5.5 5.5 0 01-6-6A5.5 5.5 0 108 14a5.5 5.5 0 005.5-5.5z" />
    </svg>
  )
}

function CrosshairIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="5" />
      <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
    </svg>
  )
}

function GridOrganizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 11.8 3.8 14l.8-4.7L1.2 6l4.7-.7z" />
    </svg>
  )
}

function FlameIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1C8 1 3 6 3 10a5 5 0 0010 0C13 6 8 1 8 1z" />
      <path d="M8 14a2 2 0 002-2c0-2-2-3-2-3s-2 1-2 3a2 2 0 002 2z" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4h10M3 8h10M3 12h10" />
    </svg>
  )
}

function ConnectionsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 5c3 0 4 3 6 3s3-3 6-3" />
      <path d="M2 8c3 0 4 3 6 3s3-3 6-3" />
      <path d="M2 11c3 0 4 3 6 3s3-3 6-3" />
    </svg>
  )
}

function DefaultViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FlightControls({
  onZoomIn,
  onZoomOut,
  onResetView,
  onToggleFullscreen,
  isFullscreen,
  dayMode,
  onToggleDayMode,
  focusMode,
  onToggleFocusMode,
  organizeByType,
  onToggleOrganize,
  viewMode,
  onCycleViewMode,
  showListView,
  onToggleListView,
  showConnections,
  onToggleConnections,
}) {
  const viewModeIcon = viewMode === 'constellation'
    ? <StarIcon />
    : viewMode === 'heatmap'
      ? <FlameIcon />
      : <DefaultViewIcon />

  const viewModeTitle = viewMode === 'constellation'
    ? 'Constellation mode (click to switch)'
    : viewMode === 'heatmap'
      ? 'Heatmap mode (click to switch)'
      : 'Default mode (click to switch)'

  return (
    <div className="xi-controls xi-glass">
      <button className="xi-controls__btn" onClick={onZoomIn} title="Zoom in">
        <PlusIcon />
      </button>
      <button className="xi-controls__btn" onClick={onZoomOut} title="Zoom out">
        <MinusIcon />
      </button>

      <span className="xi-controls__separator" />

      <button className="xi-controls__btn" onClick={onResetView} title="Reset view">
        <ResetIcon />
      </button>
      <button
        className="xi-controls__btn"
        onClick={onToggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
      </button>
      <button
        className={`xi-controls__btn xi-controls__btn--adv ${focusMode ? 'xi-controls__btn--focus-active' : ''}`}
        onClick={onToggleFocusMode}
        title={focusMode ? 'Disable focus mode' : 'Enable focus mode'}
      >
        <CrosshairIcon />
      </button>

      <span className="xi-controls__separator xi-controls__separator--adv" />

      <button
        className={`xi-controls__btn xi-controls__btn--adv ${organizeByType ? 'xi-controls__btn--active' : ''}`}
        onClick={onToggleOrganize}
        title={organizeByType ? 'Disable organize by type' : 'Organize by type'}
      >
        <GridOrganizeIcon />
      </button>
      <button
        className={`xi-controls__btn xi-controls__btn--adv ${showConnections === false ? '' : 'xi-controls__btn--active'}`}
        onClick={onToggleConnections}
        title={showConnections ? 'Hide connections (C)' : 'Show connections (C)'}
        style={showConnections === false ? { opacity: 0.4 } : undefined}
      >
        <ConnectionsIcon />
      </button>
      <button
        className={`xi-controls__btn ${showListView ? 'xi-controls__btn--active xi-glow-btn' : ''}`}
        onClick={onToggleListView}
        title={showListView ? 'Close list view' : 'List view'}
      >
        <ListIcon />
      </button>
      <button
        className={`xi-controls__btn xi-controls__btn--adv ${viewMode !== 'default' ? 'xi-controls__btn--active' : ''}`}
        onClick={onCycleViewMode}
        title={viewModeTitle}
      >
        {viewModeIcon}
      </button>

      <span className="xi-controls__separator xi-controls__separator--adv" />

      <button
        className={`xi-controls__btn xi-controls__btn--adv ${dayMode ? 'xi-controls__btn--active' : ''}`}
        onClick={onToggleDayMode}
        title={dayMode ? 'Dark mode' : 'Day mode'}
      >
        {dayMode ? <MoonIcon /> : <SunIcon />}
      </button>
    </div>
  )
}
