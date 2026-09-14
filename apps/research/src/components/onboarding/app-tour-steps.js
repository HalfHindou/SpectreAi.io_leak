/*
 * Global app tour - the first-look orientation for a new visitor.
 *
 * The tour always opens on a length-picker card ('app-tour-welcome' with
 * `choices`): the visitor chooses a QUICK tour (essentials only) or the FULL
 * walkthrough. The chosen `mode` selects which step ids follow.
 *
 * Each remaining `id` matches a data-tour="<id>" anchor in the app shell / home
 * surface; a step with no anchor renders as a centred card. Copy is plain
 * English and threaded through `t` (i18next) so it is translation-ready - the
 * second arg is the English fallback used until keys are translated.
 */

// Step ids per mode (excluding the always-first chooser). Kept as a pure list
// so the shell can derive bounds + step side-effects without building copy.
const SHORT_IDS = ['market-cockpit', 'app-info-toggle', 'app-finish']
const FULL_IDS = ['market-cockpit', 'command-center', 'discovery', 'app-nav', 'app-info-toggle', 'app-search', 'app-finish']

function idsForMode(mode) {
  const rest = mode === 'short' ? SHORT_IDS : mode === 'full' ? FULL_IDS : []
  return ['app-tour-welcome', ...rest]
}

/** Ordered step ids for a mode (chooser first). Translation-independent. */
export function getAppTourStepIds(mode) {
  return idsForMode(mode)
}

export function buildAppTourSteps(t = (_k, d) => d, mode) {
  const chooser = {
    id: 'app-tour-welcome',
    eyebrow: t('appTour.welcome.eyebrow', 'Welcome to Spectre'),
    title: t('appTour.welcome.title', 'Quick tour, or the full walkthrough?'),
    description: t(
      'appTour.welcome.desc',
      'New here? The quick tour hits just the essentials in about 30 seconds. The '
        + 'full walkthrough shows every corner of the app. Either way, you can replay '
        + 'it any time from the "?" button up top.',
    ),
    choices: [
      { mode: 'short', label: t('appTour.choice.quick', 'Quick tour'), hint: t('appTour.choice.quickHint', '~30s - the essentials') },
      { mode: 'full', label: t('appTour.choice.full', 'Full walkthrough'), hint: t('appTour.choice.fullHint', 'every stop'), primary: true },
    ],
  }

  const byId = {
    'market-cockpit': {
      id: 'market-cockpit',
      title: t('appTour.cockpit.title', 'Your market cockpit'),
      description: t(
        'appTour.cockpit.desc',
        'The top bar is your at-a-glance dashboard: total market cap, the majors, the '
          + 'Fear & Greed mood gauge, and what share Bitcoin holds. It is the market\'s '
          + 'pulse before you dig into anything.',
      ),
    },
    'command-center': {
      id: 'command-center',
      title: t('appTour.cc.title', 'The Command Center'),
      description: t(
        'appTour.cc.desc',
        'Your AI market desk: a plain-English brief on what is happening right now, plus '
          + 'news, liquidations, heatmaps and sector flows - switch tabs to go deeper without '
          + 'leaving the page.',
      ),
    },
    'discovery': {
      id: 'discovery',
      title: t('appTour.discovery.title', 'Find what is moving'),
      description: t(
        'appTour.discovery.desc',
        'Top Coins and on-chain movers, sortable and searchable. Star a token to add it to '
          + 'your watchlist, or click any row to open its full Research Zone.',
      ),
    },
    'app-nav': {
      id: 'app-nav',
      title: t('appTour.nav.title', 'Every tool, one click away'),
      description: t(
        'appTour.nav.desc',
        'This is the whole platform - Research Zone for deep token analysis, X Dash to '
          + 'read the crowd, heatmaps, the AI screener, watchlists and more. Hover any '
          + 'item to see what it does.',
      ),
    },
    'app-info-toggle': {
      id: 'app-info-toggle',
      title: t('appTour.edu.title', 'Turn on Education mode'),
      description: t(
        'appTour.edu.desc',
        'New to any of this? Flip this switch and helpful "i" dots appear next to every '
          + 'metric and term - hover one for a plain-English explanation of what it means '
          + 'and why it matters. We\'ve just turned it on for you.',
      ),
    },
    'app-search': {
      id: 'app-search',
      title: t('appTour.search.title', 'Search anything'),
      description: t(
        'appTour.search.desc',
        'Jump straight to any coin, stock or page. Type a name, ticker or even a '
          + 'contract address and Spectre finds it - the fastest way around the app.',
      ),
    },
    'app-finish': {
      id: 'app-finish',
      eyebrow: t('appTour.finish.eyebrow', 'You\'re all set'),
      title: t('appTour.finish.title', 'Go explore'),
      description: t(
        'appTour.finish.desc',
        'That\'s the tour. Replay it any time from the "?" button up top - and pick the '
          + 'longer or shorter version there. Education mode stays on until you switch it '
          + 'off. Welcome aboard.',
      ),
    },
  }

  const rest = mode === 'short' ? SHORT_IDS : mode === 'full' ? FULL_IDS : []
  return [chooser, ...rest.map((id) => byId[id])]
}

export default buildAppTourSteps
