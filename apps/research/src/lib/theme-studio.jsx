// Opening the Theme Studio from anywhere.
//
// The studio panel is owned by `ProThemeStudio`, which AppShell mounts once per
// page. It used to be reachable ONLY from its own floating fab — a pill parked
// over the bottom-right of every screen, where it covered a Top Coins row and
// clipped the watchlist Add tile. Founder, 08-04: "move themes. also add themes
// to mission control and side pages."
//
// Those call sites (header, Mission Control sheet, nav sidebar, mobile drawer)
// have no ancestor relationship with the studio, so a window event is the
// cheapest correct wiring — the same pattern `spectre:showcase-lock` already
// uses. Deliberately NOT Zustand: panel-open is transient UI state, which the
// state-management rules keep out of the persisted store.
export const THEME_STUDIO_EVENT = 'spectre:theme-studio'

export function openThemeStudio() {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(THEME_STUDIO_EVENT))
  } catch { /* noop */ }
}

/* The palette mark. One definition so the header, the sheet, the sidebar and
   the drawer cannot drift into four slightly different icons. */
export const ThemeStudioIcon = ({ size = 18, strokeWidth = 1.7 }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3a9 9 0 1 0 0 18c1.4 0 1.9-1 1.4-2s.1-2 1.6-2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10zM7.5 11h.01M11 7.5h.01M15.5 9h.01" />
  </svg>
)
