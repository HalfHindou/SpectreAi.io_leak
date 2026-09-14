/**
 * Spectre AI — Badge Injector
 * Inline sentiment alignment badges next to cashtag elements.
 * Tiny 16px circle: green ✓ (agree), red ✗ (disagree), gray ~ (neutral), purple pulse (pending).
 * Shared glassmorphic tooltip on hover.
 */

import { analyzeTweetSentiment, getTweetText, computeAlignment } from './tweet-sentiment.js';

// ─── State ───────────────────────────────────────────────────────
let isDayMode = false;
let tooltipHost = null;
let tooltipShadow = null;
let tooltipEl = null;
let tooltipHideTimer = null;
const allBadges = new Set(); // track all badges for day-mode updates

// ─── Badge State Colors ──────────────────────────────────────────
const BADGE_STATES = {
  agree: {
    bg: 'rgba(16,185,129,0.15)',
    border: 'rgba(16,185,129,0.3)',
    color: '#10B981',
    icon: '✓',
    dayBg: 'rgba(16,185,129,0.1)',
    dayBorder: 'rgba(16,185,129,0.25)',
    dayColor: '#059669',
  },
  disagree: {
    bg: 'rgba(239,68,68,0.15)',
    border: 'rgba(239,68,68,0.3)',
    color: '#EF4444',
    icon: '✗',
    dayBg: 'rgba(239,68,68,0.1)',
    dayBorder: 'rgba(239,68,68,0.25)',
    dayColor: '#DC2626',
  },
  neutral: {
    bg: 'rgba(255,255,255,0.06)',
    border: 'rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.4)',
    icon: '~',
    dayBg: 'rgba(0,0,0,0.04)',
    dayBorder: 'rgba(0,0,0,0.08)',
    dayColor: '#94a3b8',
  },
  pending: {
    bg: 'rgba(255,255,255,0.06)',
    border: 'rgba(255,255,255,0.12)',
    color: 'rgba(245,245,247,0.45)',
    icon: '',
    dayBg: 'rgba(0,0,0,0.04)',
    dayBorder: 'rgba(0,0,0,0.08)',
    dayColor: 'rgba(17,17,19,0.4)',
  },
};

/**
 * Inject a <style> into the page <head> for the pending pulse animation.
 * Idempotent — skips if already injected.
 */
export function injectBadgeKeyframes() {
  if (document.getElementById('spectre-badge-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'spectre-badge-keyframes';
  style.textContent = `
    @keyframes spectre-badge-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.7); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Create a pending badge (purple pulse) next to a cashtag element.
 * Inserts as a sibling <span> after the cashtag <a> element.
 */
export function createPendingBadge(cashtagElement, ticker) {
  // Skip if badge already exists for this element
  if (cashtagElement.dataset.spectreBadge) return;
  cashtagElement.dataset.spectreBadge = 'pending';

  const badge = document.createElement('span');
  badge.dataset.spectreBadgeEl = 'true';
  badge.dataset.spectreTicker = ticker;
  badge.dataset.spectreBadgeState = 'pending';

  applyBadgeStyle(badge, 'pending');

  // Pending state: pulsing dot instead of icon
  const dot = document.createElement('span');
  dot.style.cssText = `
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    animation: spectre-badge-pulse 1.5s ease-in-out infinite;
    display: block;
  `;
  badge.appendChild(dot);

  // Insert after the cashtag element
  if (cashtagElement.nextSibling) {
    cashtagElement.parentNode.insertBefore(badge, cashtagElement.nextSibling);
  } else {
    cashtagElement.parentNode.appendChild(badge);
  }

  allBadges.add(badge);

  // Hover tooltip
  badge.addEventListener('mouseenter', (e) => showTooltip(badge, e));
  badge.addEventListener('mouseleave', () => scheduleHideTooltip());
}

/**
 * Update badge from pending to resolved state.
 * Analyzes tweet sentiment, computes alignment with token data.
 */
export function updateBadge(cashtagElement, tokenData, marketState) {
  const badge = cashtagElement.nextElementSibling;
  if (!badge || badge.dataset.spectreBadgeEl !== 'true') return;
  if (badge.dataset.spectreBadgeState !== 'pending') return; // Already resolved

  // Get tweet text and analyze sentiment
  const tweetText = getTweetText(cashtagElement);
  const tweetSentiment = analyzeTweetSentiment(tweetText);

  // Compute alignment
  const change24 = parseFloat(tokenData.change24) || 0;
  const aiPulse = marketState.aiPulse || 'NEUTRAL';
  const alignment = computeAlignment(tweetSentiment, change24, aiPulse);

  // Update badge visual
  badge.dataset.spectreBadgeState = alignment;
  badge.dataset.spectreSentiment = tweetSentiment;
  badge.dataset.spectreChange = change24.toFixed(2);
  badge.innerHTML = '';

  const state = BADGE_STATES[alignment] || BADGE_STATES.neutral;
  badge.textContent = state.icon;
  applyBadgeStyle(badge, alignment);
}

/**
 * Toggle all badges between day and night mode.
 */
export function setBadgeDayMode(isDay) {
  isDayMode = isDay;
  for (const badge of allBadges) {
    if (!badge.isConnected) {
      allBadges.delete(badge);
      continue;
    }
    const state = badge.dataset.spectreBadgeState || 'neutral';
    applyBadgeStyle(badge, state);
  }
  // Update tooltip style if exists
  updateTooltipTheme();
}

// ─── Internal Helpers ────────────────────────────────────────────

function applyBadgeStyle(badge, state) {
  const s = BADGE_STATES[state] || BADGE_STATES.neutral;
  const bg = isDayMode ? s.dayBg : s.bg;
  const border = isDayMode ? s.dayBorder : s.border;
  const color = isDayMode ? s.dayColor : s.color;

  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${bg};
    border: 1px solid ${border};
    color: ${color};
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    margin-left: 3px;
    vertical-align: middle;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
    position: relative;
    top: -1px;
  `;
}

// ─── Tooltip ─────────────────────────────────────────────────────

function ensureTooltip() {
  if (tooltipHost && tooltipHost.isConnected) return;

  tooltipHost = document.createElement('div');
  tooltipHost.id = 'spectre-badge-tooltip-host';
  tooltipHost.style.cssText = 'position: absolute; top: 0; left: 0; z-index: 2147483647; pointer-events: none;';
  document.body.appendChild(tooltipHost);

  tooltipShadow = tooltipHost.attachShadow({ mode: 'closed' });

  tooltipEl = document.createElement('div');
  tooltipEl.style.cssText = getTooltipBaseStyle();
  tooltipShadow.appendChild(tooltipEl);
}

function getTooltipBaseStyle() {
  const bg = isDayMode ? 'rgba(255,255,255,0.95)' : 'rgba(7,7,12,0.92)';
  const border = isDayMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
  const text = isDayMode ? '#1e293b' : '#fff';
  const muted = isDayMode ? '#64748b' : 'rgba(255,255,255,0.5)';
  return `
    position: fixed;
    display: none;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px;
    background: ${bg};
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid ${border};
    border-radius: 8px;
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 11px;
    color: ${text};
    pointer-events: auto;
    z-index: 2147483647;
    max-width: 220px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
    --muted: ${muted};
  `;
}

function updateTooltipTheme() {
  if (tooltipEl) {
    tooltipEl.style.cssText = getTooltipBaseStyle();
  }
}

function showTooltip(badge, event) {
  // Disabled — per product direction the sentiment tooltip is gone.
  // The badge itself still shows; hover now does nothing.
  return;
  // eslint-disable-next-line no-unreachable
  ensureTooltip();
  clearTimeout(tooltipHideTimer);

  const state = badge.dataset.spectreBadgeState || 'neutral';
  const sentiment = badge.dataset.spectreSentiment || 'neutral';
  const ticker = badge.dataset.spectreTicker || '?';
  const change = badge.dataset.spectreChange || '0.00';

  const stateColors = BADGE_STATES[state] || BADGE_STATES.neutral;
  const stateColor = isDayMode ? stateColors.dayColor : stateColors.color;

  // Sentiment label
  const sentimentLabel = sentiment === 'neutral' ? 'Neutral' : sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
  const changeVal = parseFloat(change) || 0;
  const changeStr = (changeVal >= 0 ? '+' : '') + changeVal.toFixed(2) + '%';
  const changeDir = changeVal >= 0 ? 'up' : 'down';

  let message = '';
  if (state === 'agree') {
    message = 'Data supports this view';
  } else if (state === 'disagree') {
    message = 'Data contradicts this view';
  } else if (state === 'pending') {
    message = 'Analyzing...';
  } else {
    message = 'Insufficient signal';
  }

  const mutedColor = isDayMode ? '#64748b' : 'rgba(255,255,255,0.5)';

  tooltipEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:${mutedColor}">
      <span>Tweet: <strong style="color:${isDayMode ? '#1e293b' : '#fff'}">${sentimentLabel}</strong></span>
      <span style="opacity:0.3">|</span>
      <span>$${ticker}: <strong style="color:${isDayMode ? '#1e293b' : '#fff'}">${changeStr}</strong> (${changeDir})</span>
    </div>
    <div style="font-size:11px;font-weight:500;color:${stateColor}">${message}</div>
  `;

  // Position above badge
  const rect = badge.getBoundingClientRect();
  tooltipEl.style.display = 'flex';
  tooltipEl.style.left = `${rect.left + rect.width / 2 - 110}px`;
  tooltipEl.style.top = `${rect.top - 56}px`;

  // Animate in
  requestAnimationFrame(() => {
    tooltipEl.style.opacity = '1';
    tooltipEl.style.transform = 'translateY(0)';
  });
}

function scheduleHideTooltip() {
  tooltipHideTimer = setTimeout(() => {
    if (tooltipEl) {
      tooltipEl.style.opacity = '0';
      tooltipEl.style.transform = 'translateY(4px)';
      setTimeout(() => {
        if (tooltipEl) tooltipEl.style.display = 'none';
      }, 200);
    }
  }, 200);
}
