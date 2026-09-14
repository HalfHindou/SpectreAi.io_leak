/**
 * IButton - Intelligence "i" tooltip system.
 *
 * A 16px circle with "i" that appears next to any metric.
 * On hover (desktop) or tap (mobile) it opens an AI-generated tooltip.
 * Click to pin the tooltip open; click outside or press Escape to close.
 *
 * The tooltip is portalled to document.body so it escapes overflow:hidden parents.
 * On mobile (<= 768px), it renders as a bottom sheet with a backdrop overlay.
 */

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import useSettingsStore from '@/store/useSettingsStore';
import useInsight from './useInsight';
import ITooltipSkeleton from './ITooltipSkeleton';
import { getMetricInfo } from './insightTypes';
import './IButton.css';

const GAP = 8;
const TOOLTIP_W = 300;

function getPosition(btnRect, preferred, tipH = 0) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safeMargin = 12;

  const spaceAbove = btnRect.top - GAP - safeMargin;
  const spaceBelow = vh - btnRect.bottom - GAP - safeMargin;
  const fitsRight = vw - btnRect.right >= TOOLTIP_W + GAP + safeMargin;
  const fitsLeft = btnRect.left >= TOOLTIP_W + GAP + safeMargin;
  const bestVertical = spaceBelow >= spaceAbove ? 'bottom' : 'top';

  // Start with preferred, fall back when there's no room. Horizontal sides
  // need the full card width; when neither fits (narrow window) drop to the
  // vertical logic. Vertical sides flip on real space — the AI insight card
  // regularly runs 400-600px tall, so a side is only "enough" with real room.
  let dir = preferred;
  if (dir === 'right' && !fitsRight) dir = fitsLeft ? 'left' : bestVertical;
  else if (dir === 'left' && !fitsLeft) dir = fitsRight ? 'right' : bestVertical;
  if (dir === 'top' && spaceAbove < 420 && spaceBelow > spaceAbove) dir = 'bottom';
  if (dir === 'bottom' && spaceBelow < 420 && spaceAbove > spaceBelow) dir = 'top';

  const centerX = btnRect.left + btnRect.width / 2;
  let left = centerX - TOOLTIP_W / 2;

  // Clamp horizontally
  if (left < safeMargin) left = safeMargin;
  if (left + TOOLTIP_W > vw - safeMargin) left = vw - TOOLTIP_W - safeMargin;

  // Every placement carries a maxHeight clamp: the insight loads async, so
  // the tooltip GROWS after it is positioned — without a clamp a top-anchored
  // card pushes past the viewport top (the "i hides into the screen" bug).
  const style = { position: 'fixed', width: TOOLTIP_W };

  switch (dir) {
    case 'bottom':
      style.top = btnRect.bottom + GAP;
      style.left = left;
      style.maxHeight = Math.max(spaceBelow, 120);
      break;
    case 'left':
    case 'right': {
      const centerY = btnRect.top + btnRect.height / 2;
      style.left = dir === 'left' ? btnRect.left - TOOLTIP_W - GAP : btnRect.right + GAP;
      if (tipH > 0) {
        // Content height is known (positioning re-runs when the insight
        // lands): center on the button, then SHIFT to stay inside the
        // viewport instead of shrinking.
        const h = Math.min(tipH, vh - 2 * safeMargin);
        style.top = Math.min(Math.max(centerY - h / 2, safeMargin), vh - h - safeMargin);
        style.maxHeight = vh - 2 * safeMargin;
      } else {
        // First paint (skeleton): center on the button, capped at twice the
        // distance to the nearest vertical edge so it can't poke off-screen.
        style.top = centerY;
        style.transform = 'translateY(-50%)';
        style.maxHeight = Math.max(2 * Math.min(centerY - safeMargin, vh - centerY - safeMargin), 120);
      }
      break;
    }
    case 'top':
    default:
      style.bottom = vh - btnRect.top + GAP;
      style.left = left;
      style.maxHeight = Math.max(spaceAbove, 120);
      break;
  }

  return style;
}

export default function IButton({
  metricType,
  metricValue,
  metricLabel,
  contextColor = '#f5f5f7',
  tokenSymbol,
  sector,
  timeframe,
  additionalContext,
  position = 'right',
  size = 'sm',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState(null);
  const dayMode = useSettingsStore((s) => s.dayMode);

  const btnRef = useRef(null);
  const tooltipRef = useRef(null);
  const hoverTimeout = useRef(null);

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  const { insight, loading, error, refetch } = useInsight({
    metricType,
    metricValue,
    metricLabel,
    tokenSymbol,
    sector,
    timeframe,
    additionalContext,
    enabled: isOpen,
  });

  const info = getMetricInfo(metricType);

  // Recalculate position when opening AND when the content changes (desktop
  // only) — the insight loads async, so the card's height isn't known until
  // it lands. scrollHeight reads the natural content height even under the
  // first-pass maxHeight clamp, letting side placements shift into view
  // instead of shrinking.
  useLayoutEffect(() => {
    if (!isOpen || isMobile || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const tipH = tooltipRef.current ? tooltipRef.current.scrollHeight + 2 : 0;
    setTooltipStyle(getPosition(rect, position, tipH));
  }, [isOpen, isMobile, position, loading, insight, error]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setIsPinned(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    function onClick(e) {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target)
      ) {
        setIsOpen(false);
        setIsPinned(false);
      }
    }
    // Use setTimeout to avoid closing on the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onClick);
    };
  }, [isOpen]);

  // -- Desktop hover handlers --
  const handleMouseEnter = useCallback(() => {
    if (isMobile) return;
    clearTimeout(hoverTimeout.current);
    setIsOpen(true);
  }, [isMobile]);

  const handleMouseLeave = useCallback(() => {
    if (isMobile || isPinned) return;
    hoverTimeout.current = setTimeout(() => setIsOpen(false), 150);
  }, [isMobile, isPinned]);

  const handleTooltipMouseEnter = useCallback(() => {
    clearTimeout(hoverTimeout.current);
  }, []);

  const handleTooltipMouseLeave = useCallback(() => {
    if (isPinned) return;
    hoverTimeout.current = setTimeout(() => setIsOpen(false), 150);
  }, [isPinned]);

  // -- Click: toggle pin (desktop) or toggle open (mobile) --
  const handleClick = useCallback((e) => {
    e.stopPropagation();
    if (isMobile) {
      setIsOpen(prev => !prev);
      setIsPinned(prev => !prev);
    } else {
      if (isPinned) {
        setIsPinned(false);
        setIsOpen(false);
      } else {
        setIsPinned(true);
        setIsOpen(true);
      }
    }
  }, [isMobile, isPinned]);

  const handleOverlayClick = useCallback(() => {
    setIsOpen(false);
    setIsPinned(false);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setIsPinned(false);
  }, []);

  // -- Render tooltip content --
  const renderContent = () => {
    if (loading) return <ITooltipSkeleton />;

    if (error) {
      return (
        <div className="i-tooltip-error">
          Unable to generate insight
          <br />
          <button className="i-tooltip-retry" onClick={refetch}>
            Try again
          </button>
        </div>
      );
    }

    if (!insight) return <ITooltipSkeleton />;

    return (
      <>
        {/* Label row */}
        <div className="i-tooltip-label">
          <span className="i-tooltip-label-icon">i</span>
          {info.label}
        </div>

        {/* Title */}
        {insight.title && (
          <div className="i-tooltip-title">{insight.title}</div>
        )}

        {/* Body */}
        {insight.body && (
          <div className="i-tooltip-body">{insight.body}</div>
        )}

        {/* Historical context card */}
        {insight.historical && (
          <div className="i-tooltip-historical">
            <div className="i-tooltip-historical-label">Historical context</div>
            <div className="i-tooltip-historical-text">{insight.historical}</div>
          </div>
        )}

        {/* Action items */}
        {insight.actions && insight.actions.length > 0 && (
          <div className="i-tooltip-actions">
            {insight.actions.map((action, idx) => {
              const sentiment = action.type || action.sentiment || 'neutral';
              return (
                <div
                  key={idx}
                  className={`i-tooltip-action i-tooltip-action--${sentiment}`}
                >
                  <span className={`i-tooltip-action-dot i-tooltip-action-dot--${sentiment}`} />
                  <span>{action.text}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Disclaimer */}
        <div className="i-tooltip-disclaimer">
          AI-generated analysis - not financial advice
        </div>
      </>
    );
  };

  // -- The tooltip portal --
  const tooltip = isOpen
    ? createPortal(
        <>
          {/* Mobile overlay backdrop */}
          {isMobile && (
            <div className={`i-tooltip-overlay${dayMode ? ' i-tooltip-overlay--day' : ''}`} onClick={handleOverlayClick} />
          )}

          <div
            ref={tooltipRef}
            className={`i-tooltip${dayMode ? ' i-tooltip--day' : ''}`}
            style={!isMobile ? tooltipStyle : undefined}
            onMouseEnter={handleTooltipMouseEnter}
            onMouseLeave={handleTooltipMouseLeave}
          >
            {/* Pin/close button */}
            <button
              className="i-tooltip-pin"
              onClick={handleClose}
              aria-label="Close insight"
            >
              <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>

            {renderContent()}
          </div>
        </>,
        document.body
      )
    : null;

  const btnClass = [
    'i-btn',
    size === 'sm' && 'i-btn--sm',
    size === 'md' && 'i-btn--md',
    isOpen && 'i-btn--active',
    // Same portal-safety the tooltip already has (i-tooltip--day): the
    // `.app.app-day-mode` selectors can't reach a button rendered inside a
    // body portal (token-card-popup et al), so the dark glass chrome painted
    // gray circles on light cards. The variant class travels with the button.
    dayMode && 'i-btn--day',
  ].filter(Boolean).join(' ');

  return (
    <>
      <button
        ref={btnRef}
        className={btnClass}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        aria-label={`Intelligence: ${info.label}`}
        aria-expanded={isOpen}
        type="button"
      >
        i
      </button>
      {tooltip}
    </>
  );
}
