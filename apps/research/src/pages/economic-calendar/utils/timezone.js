/**
 * Timezone Utilities
 * Date/time manipulation for the Economic Calendar.
 * All functions operate in the user's local timezone by default.
 * Locale-sensitive output (timezone label) follows i18next current language.
 */

import i18n from 'i18next';

/**
 * Convert an ISO string to a Date object in the user's local timezone.
 * This is essentially a no-op since JS Date objects always represent
 * a point in time, but this normalizes string inputs.
 *
 * @param {string} isoString - ISO 8601 datetime string
 * @returns {Date} Date object in local timezone
 */
export function toLocalTime(isoString) {
  if (!isoString) return new Date();
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return new Date();
  return date;
}

/**
 * Get the user's timezone abbreviation.
 *
 * @returns {string} e.g. "EST", "PST", "CET", "JST"
 */
export function getTimezoneLabel() {
  try {
    const parts = new Intl.DateTimeFormat(i18n.language, {
      timeZoneName: 'short',
    }).formatToParts(new Date());

    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : 'UTC';
  } catch {
    // Fallback
    const offset = new Date().getTimezoneOffset();
    const absOffset = Math.abs(offset);
    const hours = Math.floor(absOffset / 60);
    const sign = offset <= 0 ? '+' : '-';
    return `UTC${sign}${hours}`;
  }
}

/**
 * Get the user's IANA timezone identifier.
 *
 * @returns {string} e.g. "America/New_York", "Europe/London"
 */
export function getTimezoneId() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Check if a date is today in the user's local timezone.
 *
 * @param {Date|string} date
 * @returns {boolean}
 */
export function isToday(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return false;

  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * Check if two dates fall on the same calendar day.
 *
 * @param {Date|string} date1
 * @param {Date|string} date2
 * @returns {boolean}
 */
export function isSameDay(date1, date2) {
  const d1 = date1 instanceof Date ? date1 : new Date(date1);
  const d2 = date2 instanceof Date ? date2 : new Date(date2);

  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;

  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Check if a date falls on a weekend (Saturday or Sunday).
 *
 * @param {Date|string} date
 * @returns {boolean}
 */
export function isWeekend(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return false;
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date is in the past.
 *
 * @param {Date|string} date
 * @returns {boolean}
 */
export function isPast(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

/**
 * Get an array of 7 Date objects representing the week containing the given date.
 * Week starts on Monday (ISO convention, standard for financial calendars).
 *
 * @param {Date|string} date - Any date within the desired week
 * @returns {Date[]} Array of 7 Date objects (Mon through Sun)
 */
export function getWeekDates(date) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  if (isNaN(d.getTime())) return getWeekDates(new Date());

  // Get Monday of this week (ISO: Monday = 1)
  const dayOfWeek = d.getDay();
  // Convert: Sun=0 -> 6, Mon=1 -> 0, Tue=2 -> 1, etc.
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const monday = new Date(d);
  monday.setDate(d.getDate() - daysFromMonday);
  monday.setHours(0, 0, 0, 0);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    dates.push(day);
  }

  return dates;
}

/**
 * Get a 2D array representing a calendar month grid.
 * Each row is a week (Mon-Sun), padded with null for days outside the month.
 *
 * @param {Date|string} date - Any date within the desired month
 * @returns {(Date|null)[][]} 2D array of Date objects or null for empty cells
 */
export function getMonthDates(date) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  if (isNaN(d.getTime())) return getMonthDates(new Date());

  const year = d.getFullYear();
  const month = d.getMonth();

  // First day of the month
  const firstDay = new Date(year, month, 1);
  // Last day of the month
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();

  // Day of week for the 1st (convert to Mon=0 ... Sun=6)
  const firstDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

  const weeks = [];
  let currentWeek = [];

  // Pad the first week with nulls before the 1st
  for (let i = 0; i < firstDayOfWeek; i++) {
    currentWeek.push(null);
  }

  // Fill in all days of the month
  for (let day = 1; day <= totalDays; day++) {
    currentWeek.push(new Date(year, month, day));

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  // Pad the last week with nulls
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push(currentWeek);
  }

  return weeks;
}

/**
 * Get the start and end dates of a month.
 *
 * @param {Date|string} date
 * @returns {{ start: Date, end: Date }}
 */
export function getMonthRange(date) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  if (isNaN(d.getTime())) return getMonthRange(new Date());

  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * Add days to a date.
 *
 * @param {Date} date
 * @param {number} days - Number of days to add (can be negative)
 * @returns {Date}
 */
export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Get the next business day (Monday-Friday) from a given date.
 *
 * @param {Date} date
 * @returns {Date}
 */
export function nextBusinessDay(date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  while (isWeekend(result)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

/**
 * Create an EST-based ISO string for a specific date and time.
 * Useful for generating mock events at standard release times.
 *
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {number} day
 * @param {number} hours - In EST (24h format)
 * @param {number} minutes
 * @returns {string} ISO datetime string
 */
export function createESTDateTime(year, month, day, hours, minutes) {
  // EST = UTC-5, EDT = UTC-4
  // For simplicity, use UTC-5 (standard time) for winter dates
  // and UTC-4 for summer dates (roughly Mar-Nov)
  const isDST = month >= 2 && month <= 10; // Approximate DST range
  const utcOffset = isDST ? 4 : 5;

  const utcHours = hours + utcOffset;

  const date = new Date(Date.UTC(year, month, day, utcHours, minutes, 0, 0));
  return date.toISOString();
}
