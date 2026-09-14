/**
 * Product Tour – key features around the landing page
 * Backdrop fades the rest; spotlight highlights the target; tooltip shows step content
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import './product-tour.css'

const TOUR_STEPS = [
  {
    id: 'welcome-widget',
    title: 'Welcome widget',
    description: 'Your dashboard starts here. Add your name and see key market data at a glance.',
  },
  {
    id: 'top-assets',
    title: 'Top assets',
    description: 'Track BTC, ETH, SOL and total market cap. Click any card for details.',
  },
  {
    id: 'sentiment',
    title: 'Sentiment & indicators',
    description: 'Fear & Greed and market dominance. Use them to gauge risk and flow.',
  },
  {
    id: 'command-center',
    title: 'Command Center',
    description: 'Analysis, news, flows, and narratives. Switch tabs to explore.',
  },
  {
    id: 'watchlist',
    title: 'Watchlist',
    description: 'Your saved tokens. Add from search or Top Coins; drag to reorder.',
  },
  {
    id: 'discovery',
    title: 'Top Coins & Discovery',
    description: 'Browse top coins, on-chain movers, or prediction markets. Click a row to open the chart.',
  },
]

const ProductTour = ({ steps = TOUR_STEPS, isActive, currentStep, onNext, onBack, onSkip, dayMode = false }) => {
  const { t } = useTranslation()
  const [rect, setRect] = useState(null)
  const [tooltipPlacement, setTooltipPlacement] = useState('bottom')

  const step = steps[currentStep]
  const selector = step ? `[data-tour="${step.id}"]` : null

  const updateRect = useCallback(() => {
    if (!selector) {
      setRect(null)
      return
    }
    const el = document.querySelector(selector)
    if (!el) {
      setRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    setTooltipPlacement(r.top > window.innerHeight / 2 ? 'top' : 'bottom')
  }, [selector])

  useEffect(() => {
    if (!isActive || !selector) return
    updateRect()
    const ro = new ResizeObserver(updateRect)
    const el = document.querySelector(selector)
    if (el) ro.observe(el)
    window.addEventListener('scroll', updateRect, true)
    window.addEventListener('resize', updateRect)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', updateRect, true)
      window.removeEventListener('resize', updateRect)
    }
  }, [isActive, selector, currentStep, updateRect])

  if (!isActive || !step) return null

  const tooltip = (
    <div
      className={`product-tour-tooltip product-tour-tooltip--${tooltipPlacement} ${dayMode ? 'day-mode' : ''}`}
      style={rect ? {
        top: tooltipPlacement === 'bottom' ? rect.top + rect.height + 16 : undefined,
        bottom: tooltipPlacement === 'top' ? window.innerHeight - rect.top + 16 : undefined,
        left: rect.left + rect.width / 2,
      } : {}}
    >
      <div className="product-tour-tooltip-inner">
        <span className="product-tour-step-badge">Step {currentStep + 1} of {steps.length}</span>
        <h3 className="product-tour-tooltip-title">{step.title}</h3>
        <p className="product-tour-tooltip-desc">{step.description}</p>
        <div className="product-tour-actions">
          <button type="button" className="product-tour-skip" onClick={onSkip}>{t('homePage.productTour.producttour.skipTour', "Skip tour")}</button>
          <div className="product-tour-nav">
            {currentStep > 0 && (
              <button type="button" className="product-tour-back" onClick={onBack}>{t('homePage.productTour.producttour.back', "Back")}</button>
            )}
            <button type="button" className="product-tour-next" onClick={onNext}>
              {currentStep < steps.length - 1 ? 'Next' : 'Finish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(
    <div className={`product-tour ${dayMode ? 'day-mode' : ''}`} role="dialog" aria-modal="true" aria-label={t('homePage.productTour.producttour.ariaProductTour', "Product tour")}>
      {/* Outside click dismisses - without a handler the backdrop ate the click
          and Escape was the only exit. */}
      <div
        className="product-tour-backdrop"
        onClick={onSkip}
        aria-hidden
      />
      {rect && (
        <>
          <div
            className="product-tour-spotlight"
            style={{
              top: rect.top,
              left: rect.left,
              width: Math.max(rect.width, 40),
              height: Math.max(rect.height, 40),
            }}
            aria-hidden
          />
          {tooltip}
        </>
      )}
    </div>,
    document.body
  )
}

export default ProductTour
export { TOUR_STEPS }
