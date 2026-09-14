/*
 * Potential Gainers - guided tour steps.
 *
 * `id` matches the data-tour="..." attribute on each page zone. The tour
 * walks a first-time visitor through the four zones, teaching what the
 * surface proves and - critically - that early signals pay off over the 72h
 * window and that being a few hours late still works.
 */
export const PG_TOUR_STEPS = [
  {
    id: 'pg-edge',
    title: 'The Edge',
    description:
      'The real return of an equal-weight book - $100 into every published signal, '
      + 'winners and losers included. A track record of the model, not a projection '
      + 'of your account.',
  },
  {
    id: 'pg-record',
    title: 'The Record',
    description:
      'The official win rate - every signal that has finished the full 72-hour proof '
      + 'window. Losses are stated in the headline. Nothing is hidden or filtered.',
  },
  {
    id: 'pg-live',
    title: 'Live Now',
    description:
      'Fresh signals, flagged before momentum expansion. Returns usually play out over '
      + 'the next 72 hours - and in our tracking, entering 2-3 hours late performed '
      + 'about the same. You do not have to be first.',
  },
  {
    id: 'pg-proof',
    title: 'Proven Calls',
    description:
      'Every call timestamped before the move - the win-rate history, the biggest '
      + 'runners since signal, and the receipts. The full record, open to inspection.',
  },
  {
    /* No data-tour target - renders as a centred closing card. */
    id: 'pg-finish',
    title: 'House rules',
    description:
      "It's an edge, not a crystal ball - read from social buzz, not financial advice. "
      + "So don't bet the rent, spread your stake, and go have fun with it.",
  },
]
