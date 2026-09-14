/**
 * LITE's slug-keyed translator.
 *
 * The key is derived from the English default, so every toggle, eyebrow and
 * group title translates without hand-naming hundreds of keys. It was copied
 * verbatim into twelve files; one copy now.
 *
 * Two keys are tried, in order:
 *   lite.<ns>.<slug>  - the historical shape, kept so existing entries resolve
 *   lite.s.<slug>     - one entry per distinct English string
 *
 * The flat key exists because ns is a grouping label, not meaning: the same
 * word arrives as 'opt' from one call site and 'grp' from another, and a
 * per-ns dictionary would ask a translator for the same string four times and
 * get four different answers. i18next takes an array of keys and uses the
 * first one that resolves, so the flat entry covers every namespace at once.
 */
export const liteSlug = (text) =>
  String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

export const tl = (t, text, ns = 'opt') => {
  const slug = liteSlug(text)
  return t([`lite.${ns}.${slug}`, `lite.s.${slug}`], text)
}
