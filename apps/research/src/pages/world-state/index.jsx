/**
 * /world-state — thin route wrapper.
 *
 * No dayMode prop: the page's day palette is a pure CSS concern, keyed off the
 * `.app.app-day-mode` ancestor that the settings store already sets. Passing a
 * boolean down to toggle a second class would give the page two sources of
 * truth for one question.
 */
import WorldStatePage from './components/world-state-page'

export default function WorldState() {
  return <WorldStatePage />
}
