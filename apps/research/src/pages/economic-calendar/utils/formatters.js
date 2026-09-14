/**
 * Calendar Formatters
 * Pure formatting utilities for the Economic Calendar page.
 * Uses i18next current language so dates/times honour the user's locale.
 */

import i18n from 'i18next';

/**
 * Format an ISO datetime string to "HH:MM TZ" format.
 * Displays in the user's local timezone with abbreviated timezone name.
 *
 * @param {string} isoString - ISO 8601 datetime string
 * @returns {string} e.g. "08:30 EST"
 */
export function formatEventTime(isoString) {
  if (!isoString) return '--:--';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '--:--';

    const timeStr = date.toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const tzLabel = getShortTimezone(date);
    return `${timeStr} ${tzLabel}`;
  } catch {
    return '--:--';
  }
}

/**
 * Format an ISO datetime string to "Day Mon DD, YYYY" format.
 *
 * @param {string} isoString - ISO 8601 datetime string
 * @returns {string} e.g. "Mon Feb 22, 2026"
 */
export function formatEventDate(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';

    return date.toLocaleDateString(i18n.language, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Format a date range as "Mon DD - DD, YYYY" or "Mon DD - Mon DD, YYYY".
 *
 * @param {Date|string} startDate
 * @param {Date|string} endDate
 * @returns {string} e.g. "Feb 22 - 28, 2026" or "Feb 28 - Mar 6, 2026"
 */
export function formatDateRange(startDate, endDate) {
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';

  const startMonth = start.toLocaleDateString(i18n.language, { month: 'short' });
  const endMonth = end.toLocaleDateString(i18n.language, { month: 'short' });
  const startDay = start.getDate();
  const endDay = end.getDate();
  const endYear = end.getFullYear();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay} \u2013 ${endDay}, ${endYear}`;
  }
  return `${startMonth} ${startDay} \u2013 ${endMonth} ${endDay}, ${endYear}`;
}

/**
 * Format a date to "Month YYYY" format.
 *
 * @param {Date|string} date
 * @returns {string} e.g. "February 2026"
 */
export function formatMonthYear(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';

  return d.toLocaleDateString(i18n.language, {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Format relative time from now to a target datetime.
 * Returns human-readable countdown or elapsed strings.
 *
 * @param {string} isoString - ISO 8601 datetime string
 * @returns {string} e.g. "in 4h 22m", "in 2d 14h", "3h ago", "just now"
 */
export function formatRelativeTime(isoString) {
  if (!isoString) return '';
  try {
    const target = new Date(isoString);
    if (isNaN(target.getTime())) return '';

    const now = new Date();
    const diffMs = target.getTime() - now.getTime();
    const absDiffMs = Math.abs(diffMs);
    const isFuture = diffMs > 0;

    const seconds = Math.floor(absDiffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';

    let timeStr;
    if (days > 0) {
      const remainingHours = hours % 24;
      timeStr = remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
    } else if (hours > 0) {
      const remainingMinutes = minutes % 60;
      timeStr = remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    } else {
      timeStr = `${minutes}m`;
    }

    return isFuture ? `in ${timeStr}` : `${timeStr} ago`;
  } catch {
    return '';
  }
}

/**
 * Calculate and format the deviation between actual and forecast values.
 *
 * @param {string|number} actual - The actual released value
 * @param {string|number} forecast - The forecasted value
 * @returns {string} e.g. "+0.3%", "-28K", "0.0%"
 */
export function formatDeviation(actual, forecast) {
  if (actual == null || forecast == null) return '--';

  // Extract numeric values from strings like "4.50%", "180K", "-68.5B"
  const parseValue = (val) => {
    if (typeof val === 'number') return val;
    const str = String(val).replace(/[,$]/g, '');
    const match = str.match(/^([+-]?\d+\.?\d*)/);
    if (!match) return NaN;
    let num = parseFloat(match[1]);

    // Handle suffixes
    if (/K$/i.test(str)) num *= 1;    // Keep in K
    if (/M$/i.test(str)) num *= 1000; // Convert to K
    if (/B$/i.test(str)) num *= 1000000;

    // Handle negative prefix in string
    if (str.startsWith('-') && num > 0) num = -num;

    return num;
  };

  const actualNum = parseValue(actual);
  const forecastNum = parseValue(forecast);

  if (isNaN(actualNum) || isNaN(forecastNum)) return '--';

  const diff = actualNum - forecastNum;

  // Determine the unit from the original value
  const unit = String(actual).replace(/^[+-]?\d+\.?\d*\s*/, '').trim() ||
               String(forecast).replace(/^[+-]?\d+\.?\d*\s*/, '').trim() || '';

  const sign = diff > 0 ? '+' : '';
  const decimals = String(actual).includes('.') ?
    (String(actual).split('.')[1] || '').replace(/[^0-9]/g, '').length : 0;

  return `${sign}${diff.toFixed(Math.min(decimals, 2))}${unit}`;
}

/**
 * Get a flag emoji for a country code.
 *
 * @param {string} countryCode - ISO country code (US, EU, UK, JP, etc.)
 * @returns {string} Flag emoji
 */
export function getCountryFlag(countryCode) {
  const flags = {
    US: '\u{1F1FA}\u{1F1F8}',   // US
    EU: '\u{1F1EA}\u{1F1FA}',   // EU
    UK: '\u{1F1EC}\u{1F1E7}',   // UK
    GB: '\u{1F1EC}\u{1F1E7}',   // GB
    JP: '\u{1F1EF}\u{1F1F5}',   // JP
    CN: '\u{1F1E8}\u{1F1F3}',   // CN
    AU: '\u{1F1E6}\u{1F1FA}',   // AU
    CA: '\u{1F1E8}\u{1F1E6}',   // CA
    CH: '\u{1F1E8}\u{1F1ED}',   // CH
    DE: '\u{1F1E9}\u{1F1EA}',   // DE
    FR: '\u{1F1EB}\u{1F1F7}',   // FR
    KR: '\u{1F1F0}\u{1F1F7}',   // KR
    IN: '\u{1F1EE}\u{1F1F3}',   // IN
    BR: '\u{1F1E7}\u{1F1F7}',   // BR
    MX: '\u{1F1F2}\u{1F1FD}',   // MX
    NZ: '\u{1F1F3}\u{1F1FF}',   // NZ
    SG: '\u{1F1F8}\u{1F1EC}',   // SG
    HK: '\u{1F1ED}\u{1F1F0}',   // HK
  };

  if (!countryCode) return '\u{1F30D}'; // Globe
  return flags[countryCode.toUpperCase()] || '\u{1F30D}';
}

/**
 * Get a crypto icon character for a symbol.
 *
 * @param {string} symbol - Crypto symbol (BTC, ETH, etc.)
 * @returns {string} Unicode character representing the crypto
 */
export function getCryptoIcon(symbol) {
  const icons = {
    BTC: '\u20BF',  // Bitcoin sign
    ETH: '\u039E',  // Xi (commonly used for ETH)
    SOL: '\u25C9',  // Fisheye
    AVAX: '\u25B2', // Triangle
    DOT: '\u25CF',  // Circle
    LINK: '\u26D3', // Chain
    MATIC: '\u2B23', // Hexagon
    ADA: '\u25C8',  // Diamond in circle
    XRP: '\u2716',  // Cross
    DOGE: '\u00D0', // D with stroke
  };

  if (!symbol) return '\u20BF';
  return icons[symbol.toUpperCase()] || symbol.charAt(0);
}

/**
 * Extract the abbreviated timezone name from a Date object.
 *
 * @param {Date} date
 * @returns {string} e.g. "EST", "PST", "CET"
 */
function getShortTimezone(date) {
  try {
    const parts = new Intl.DateTimeFormat(i18n.language, {
      timeZoneName: 'short',
    }).formatToParts(date);

    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : '';
  } catch {
    // Fallback: extract from toString()
    const match = date.toString().match(/\(([^)]+)\)/);
    if (match) {
      // Convert "Eastern Standard Time" to "EST"
      return match[1].replace(/[a-z\s]/g, '');
    }
    return 'UTC';
  }
}

/**
 * Append an event's unit to a numeric value for display ("4.2" + "%" ->
 * "4.2%"). TradingView-sourced events carry numeric previous/forecast/actual
 * plus a `unit` field; legacy string values already have units baked in and
 * pass through untouched. No unit is fabricated for unitless indices.
 *
 * @param {number|string|null} value
 * @param {string|null} unit
 * @returns {string|null}
 */
const SCALE_UNIT_FACTORS = { K: 1e3, M: 1e6, B: 1e9 };

export function formatValueWithUnit(value, unit) {
  if (value == null || value === '') return null;
  const str = String(value);
  if (!unit || str.endsWith(unit)) return str;
  // Legacy payload guard: the feed used to carry raw base units next to a
  // scale unit ("110000" + "K" rendered "110000K"). A value that large is
  // already IN base units - rescale it into the unit instead of suffixing.
  const factor = SCALE_UNIT_FACTORS[String(unit).trim().charAt(0).toUpperCase()];
  const n = Number(str.replace(/,/g, ''));
  if (factor && Number.isFinite(n) && Math.abs(n) >= 1e5) {
    return `${Math.round((n / factor) * 10) / 10}${unit}`;
  }
  return `${str}${unit}`;
}
