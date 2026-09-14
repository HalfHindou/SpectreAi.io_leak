/*
 * X Dash - guided tour steps.
 *
 * `id` matches the data-tour="..." attribute on each zone. A step with no
 * matching target renders as a centred card (welcome + finish). The tour is
 * button-launched (no auto-popup); the launcher switches to the Leaderboard
 * view first so the movers/attention/table zones exist to be framed.
 *
 * Tone: show off what the surface can do, in plain English - and be honest
 * that a few views are experimental previews.
 */
export const XD_TOUR_STEPS = [
  {
    id: 'xd-welcome',
    eyebrow: 'X Dash',
    title: 'Read the crowd, fast',
    description:
      'X Dash tracks what all of crypto X is talking about, in real time - which tokens, '
      + 'how loud, how fast, and whether the attention is real. Two minutes and you\'ll '
      + 'know how to read it.',
  },
  {
    id: 'xd-kpis',
    title: 'The live pulse',
    description:
      'Up top: how many tokens Spectre is tracking, total mentions in your window, and how '
      + 'many currently clear the signal bar - enough real, broad attention to be worth a '
      + 'look versus background noise.',
  },
  {
    id: 'xd-sort',
    title: 'Rank it your way',
    description:
      'Mentions = who\'s loudest. Momentum = what\'s heating up fastest versus its own '
      + 'baseline. Conviction = quality of attention - many real authors, clean and '
      + 'durable, over raw volume. Flip between them to change the whole board.',
  },
  {
    id: 'xd-table',
    title: 'The leaderboard - and every metric explained',
    description:
      'Signal score, Velocity (mentions vs the token\'s own baseline), Authors, Staying '
      + 'Power, Quality, Fresh. Tap any project row to open its full dossier: Research '
      + 'Zone, AI Screener, live sentiment, the social graph, the AI brain, one-tap '
      + 'contract copy - all the good stuff.',
  },
  {
    id: 'xd-cockpit',
    title: 'What\'s Moving Now',
    description:
      'The cockpit surfaces the story at a glance - the biggest rank climber, the cleanest '
      + 'breakout, the noisiest name, the top carrier and the hottest narrative - so you '
      + 'don\'t have to scan the whole table to see what changed.',
  },
  {
    id: 'xd-attention',
    title: 'The attention map',
    description:
      'A heatmap of where the crowd\'s focus actually sits right now. Bigger, brighter '
      + 'tiles = more attention. Great for spotting a cluster forming before it climbs '
      + 'the list.',
  },
  {
    id: 'xd-tabs',
    title: 'More than a leaderboard',
    description:
      'Proof (the track record), Narratives, KOL Radar, Creators, Rotations and more - each '
      + 'a different lens on the same live feed. A few are marked Preview (like Institutions '
      + 'and Map): the data is real, but they\'re still being built - explore them freely.',
  },
  {
    id: 'app-info-toggle',
    title: 'Never guess what a metric means',
    description:
      'Flip on Info mode and a little "i" appears beside every metric - tap it for a '
      + 'plain-English explanation. Want the full list? The Glossary spells out every term '
      + 'Spectre uses. Turn it on now and the whole board explains itself.',
  },
  {
    id: 'xd-finish',
    title: 'One house rule',
    description:
      'X Dash reads social attention - a powerful edge, not a crystal ball. Hype is not '
      + 'value, signals can be wrong, and this is research, not financial advice. Size '
      + 'small, verify contracts yourself, and have fun with it.',
  },
]
