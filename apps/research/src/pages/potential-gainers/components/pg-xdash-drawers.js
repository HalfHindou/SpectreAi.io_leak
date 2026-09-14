/*
 * Reuse the X Dash token + author detail drawers on Potential Gainers.
 *
 * The drawer components live in the x-dash page and render xd-* classes
 * whose styles live in x-dash-page.css (the drawers do not import their own
 * CSS). This wrapper pulls that stylesheet set in alongside the components,
 * and the page lazy-loads THIS module - so the x-dash CSS only ever loads
 * when a user actually opens a drawer, never on the initial page render.
 *
 * xd-* and pg-* class namespaces do not collide, so importing the x-dash
 * stylesheet here is side-effect-safe for the Potential Gainers page.
 */
import '@/pages/x-dash/components/x-dash-page.css'
import '@/pages/x-dash/components/x-dash-page.day-mode.css'
import '@/pages/x-dash/components/x-dash-page.mobile.css'

export { default as XDTokenDrawer } from '@/pages/x-dash/components/xd-token-drawer'
export { default as XDAuthorDrawer } from '@/pages/x-dash/components/xd-author-drawer'
