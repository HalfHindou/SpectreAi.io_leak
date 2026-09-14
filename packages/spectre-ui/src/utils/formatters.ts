/**
 * Spectre AI Design System - Text Formatters
 * ==========================================
 * Utility functions for formatting numbers, dates, and text
 * commonly used in trading and fintech applications.
 */

/**
 * Format a number as currency with proper symbol and decimals.
 * 
 * @example
 * formatCurrency(1234.56) // "$1,234.56"
 * formatCurrency(1234.56, 'EUR') // "€1,234.56"
 * formatCurrency(0.00001234, 'USD', 8) // "$0.00001234"
 */
export function formatCurrency(
  value: number,
  currency: string = 'USD',
  decimals?: number
): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals ?? (value < 1 ? 8 : 2),
  });
  return formatter.format(value);
}

/**
 * Format a number with compact notation (K, M, B, T).
 * 
 * @example
 * formatCompact(1234) // "1.23K"
 * formatCompact(1234567) // "1.23M"
 * formatCompact(1234567890) // "1.23B"
 */
export function formatCompact(value: number): string {
  if (value === 0) return '0';
  
  const suffixes = ['', 'K', 'M', 'B', 'T'];
  const tier = Math.floor(Math.log10(Math.abs(value)) / 3);
  
  if (tier === 0) return value.toString();
  
  const suffix = suffixes[tier] || '';
  const scale = Math.pow(10, tier * 3);
  const scaled = value / scale;
  
  return scaled.toFixed(2).replace(/\.?0+$/, '') + suffix;
}

/**
 * Format a percentage value.
 * 
 * @example
 * formatPercent(0.1234) // "12.34%"
 * formatPercent(0.1234, 1) // "12.3%"
 * formatPercent(-0.05) // "-5.00%"
 */
export function formatPercent(
  value: number,
  decimals: number = 2,
  includeSign: boolean = false
): string {
  const percent = value * 100;
  const formatted = percent.toFixed(decimals);
  
  if (includeSign && percent > 0) {
    return `+${formatted}%`;
  }
  return `${formatted}%`;
}

/**
 * Format a price change with color indicator.
 * Returns an object with formatted value and direction.
 * 
 * @example
 * formatPriceChange(0.0534) // { value: "+5.34%", direction: "up" }
 * formatPriceChange(-0.0234) // { value: "-2.34%", direction: "down" }
 */
export function formatPriceChange(change: number): {
  value: string;
  direction: 'up' | 'down' | 'neutral';
} {
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';
  const sign = change > 0 ? '+' : '';
  const value = `${sign}${(change * 100).toFixed(2)}%`;
  
  return { value, direction };
}

/**
 * Format a crypto/token amount with appropriate decimals.
 * Automatically adjusts decimals based on value size.
 * 
 * @example
 * formatTokenAmount(1234.567) // "1,234.57"
 * formatTokenAmount(0.00001234) // "0.00001234"
 * formatTokenAmount(1234567890) // "1,234,567,890"
 */
export function formatTokenAmount(
  value: number,
  maxDecimals: number = 8
): string {
  if (value === 0) return '0';
  
  const absValue = Math.abs(value);
  let decimals: number;
  
  if (absValue >= 1000) {
    decimals = 2;
  } else if (absValue >= 1) {
    decimals = 4;
  } else if (absValue >= 0.0001) {
    decimals = 6;
  } else {
    decimals = maxDecimals;
  }
  
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Truncate a wallet address or hash with ellipsis.
 * 
 * @example
 * truncateAddress("0x1234567890abcdef1234567890abcdef12345678") // "0x1234...5678"
 * truncateAddress("0x1234567890abcdef", 6, 4) // "0x1234...cdef"
 */
export function truncateAddress(
  address: string,
  startChars: number = 6,
  endChars: number = 4
): string {
  if (address.length <= startChars + endChars) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Format a timestamp as relative time (e.g., "2 hours ago").
 * 
 * @example
 * formatRelativeTime(Date.now() - 60000) // "1 minute ago"
 * formatRelativeTime(Date.now() - 3600000) // "1 hour ago"
 */
export function formatRelativeTime(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a date for display.
 * 
 * @example
 * formatDate(new Date()) // "Jan 21, 2024"
 * formatDate(new Date(), 'long') // "January 21, 2024 at 3:45 PM"
 */
export function formatDate(
  date: Date | number | string,
  format: 'short' | 'long' | 'time' = 'short'
): string {
  const d = new Date(date);
  
  switch (format) {
    case 'long':
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    case 'time':
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
    default:
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
  }
}

/**
 * Format market cap or volume with appropriate suffix.
 * 
 * @example
 * formatMarketCap(1234567890) // "$1.23B"
 * formatMarketCap(123456789012) // "$123.46B"
 */
export function formatMarketCap(value: number): string {
  if (value === 0) return '$0';
  
  const suffixes = ['', 'K', 'M', 'B', 'T'];
  const tier = Math.floor(Math.log10(Math.abs(value)) / 3);
  
  if (tier === 0) return `$${value}`;
  
  const suffix = suffixes[tier] || '';
  const scale = Math.pow(10, tier * 3);
  const scaled = value / scale;
  
  return `$${scaled.toFixed(2)}${suffix}`;
}

/**
 * Format a number with thousand separators.
 * 
 * @example
 * formatNumber(1234567.89) // "1,234,567.89"
 */
export function formatNumber(value: number, decimals?: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Pluralize a word based on count.
 * 
 * @example
 * pluralize(1, 'token', 'tokens') // "1 token"
 * pluralize(5, 'token', 'tokens') // "5 tokens"
 */
export function pluralize(
  count: number,
  singular: string,
  plural: string
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
