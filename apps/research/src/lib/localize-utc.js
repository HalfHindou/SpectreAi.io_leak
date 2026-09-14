// The box composes its market reads server-side and stamps times in UTC
// ("low 63,006 at 01:00Z"), because it has no idea where the reader is. The
// timelines rendered next to those reads are in the reader's local clock — so
// the same KOSPI halt showed as "01:18Z" in the sentence and "03:18" in the
// list directly below it. Two clocks, one screen.
//
// This rewrites every HH:MMZ stamp in a server string into the reader's local
// HH:MM. The date is inferred, not guessed: a Z-stamp inside a same-day read
// always refers to the most recent instant with that UTC time at or before
// now, so we walk back at most one day. Anything older than the window these
// reads cover (24h) was never expressible as a bare HH:MMZ in the first place.
const Z_STAMP = /\b([01]\d|2[0-3]):([0-5]\d)Z\b/g

export function utcStampToLocal(hh, mm, now = new Date()) {
  const d = new Date(now)
  d.setUTCHours(Number(hh), Number(mm), 0, 0)
  // that UTC wall-clock time has not happened yet today → it was yesterday
  if (d.getTime() > now.getTime()) d.setUTCDate(d.getUTCDate() - 1)
  return d
}

/**
 * Replace UTC "HH:MMZ" stamps in a server-composed string with the reader's
 * local time. Returns the input untouched when there is nothing to convert.
 */
export function localizeUtcStamps(text, now = new Date()) {
  if (!text || typeof text !== 'string') return text
  return text.replace(Z_STAMP, (_m, hh, mm) =>
    utcStampToLocal(hh, mm, now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  )
}

export default localizeUtcStamps
