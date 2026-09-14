/**
 * Storage key for the mobile home shell's active tab.
 *
 * Lives here rather than in MobileHomeShell because MobileTokenPage writes it
 * too (its view-nav Watchlist shortcut). Importing the constant FROM the shell
 * created a static module edge MobileTokenPage -> MobileHomeShell -> the five
 * home screens (+ their CSS), so the desktop token page's idle chunk prefetch
 * dragged the entire mobile home tree onto a 2048px viewport that can never
 * render it (measured 2026-08-04). A constant does not need a component.
 */
export const MHS_TAB_KEY = 'spectre-mhs-tab'
