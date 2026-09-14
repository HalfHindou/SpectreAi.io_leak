/*
 * X Intelligence (Social Intelligence) - guided tour steps.
 *
 * `id` matches the data-tour="..." attribute on each zone. Welcome + finish
 * have no target and render as centred cards. Button-launched, no auto-popup.
 *
 * This is the page that answers "what does Velocity Delta / Signal Density
 * mean?" - so the hero-trio step explains those directly.
 */
export const XI_TOUR_STEPS = [
  {
    id: 'xi-welcome',
    eyebrow: 'X Intelligence',
    title: 'The whole crowd, at a glance',
    description:
      'Every token crypto X is talking about, drawn as a living field - size and heat show '
      + 'where attention actually sits. This is the big-picture view; X Dash is the '
      + 'detailed board behind it.',
  },
  {
    id: 'xi-metrics',
    title: 'The vital signs',
    description:
      'Total mentions, tokens tracked, overall sentiment, average velocity and how many '
      + 'names are firing an active signal right now - the market\'s social pulse in five '
      + 'numbers. Each has an "i" for a plain-English definition.',
  },
  {
    id: 'xi-stage',
    title: 'A living map of attention',
    description:
      'Switch between Reactor, Bubbles, Treemap and Bars. Bigger, brighter = more '
      + 'attention; color reads sentiment. Tap any token to pull its full detail into the '
      + 'side panel - mentions, growth and who\'s carrying it.',
  },
  {
    id: 'xi-hero',
    title: 'Influence, Velocity Delta & Signal Density',
    description:
      'Influence = the crowd\'s overall lean. Velocity Delta = how hard mentions are '
      + 'swinging across the whole board right now (the pace of change). Signal Density = '
      + 'the share of tracked tokens actively moving - how broadly the market is lit up, '
      + 'not just one runner.',
  },
  {
    id: 'app-info-toggle',
    title: 'Turn on the explanations',
    description:
      'Flip on Info mode and a little "i" appears beside every metric - tap it for a '
      + 'plain-English definition. The Glossary lists every term in full. Great for your '
      + 'first few sessions here.',
  },
  {
    id: 'xi-finish',
    title: 'A quick reminder',
    description:
      'This reads social attention across X - a strong signal, but hype is not value and '
      + 'reads can be wrong. It\'s research and education, not financial advice. Verify '
      + 'anything before you act, and size accordingly.',
  },
]
