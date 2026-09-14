import React, { useState, useCallback, useRef, useEffect } from 'react'
import { MATCH_QUESTIONS, CAMPAIGN_RESULTS } from './data/match-questions'

/* Inline SVG icon renderer for option cards */
function OptionIcon({ path }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pulse-match-opt-icon"
    >
      <path d={path} />
    </svg>
  )
}

/* Animates a number from 0 to target over duration ms */
function useCountUp(target, duration = 800, active = false) {
  const [value, setValue] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    if (!active) { setValue(0); return }
    const start = performance.now()
    const tick = (now) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(target * eased))
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration, active])

  return value
}

function MetricCard({ label, value, prefix = '', suffix = '', delay = 0 }) {
  const numericVal = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, ''))
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  const animated = useCountUp(numericVal, 800, visible)

  const formatted = numericVal >= 1000
    ? animated.toLocaleString()
    : numericVal < 1
      ? animated === numericVal ? numericVal.toFixed(2) : (animated / 100 * numericVal).toFixed(2)
      : String(animated)

  // For CPA, format differently
  const display = prefix === '$' && numericVal < 1
    ? `$${numericVal.toFixed(2).replace(/^0/, '')}`
    : `${prefix}${formatted}${suffix}`

  return (
    <div className={`pulse-match-metric-card ${visible ? 'pulse-match-metric-card--visible' : ''}`}>
      <div className="pulse-match-metric-label">{label}</div>
      <div className="pulse-match-metric-value pulse-mono">
        {visible ? display : '\u2014'}
      </div>
    </div>
  )
}

function DistributionBar({ label, pct, index }) {
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setAnimate(true), 200 + index * 120)
    return () => clearTimeout(t)
  }, [index])

  return (
    <div className="pulse-match-channel">
      <span className="pulse-match-channel-name">{label}</span>
      <div className="pulse-match-channel-bar">
        <div
          className="pulse-match-channel-fill"
          style={{
            width: animate ? `${pct}%` : '0%',
            opacity: 0.5 + (pct / 100) * 0.5,
          }}
        />
      </div>
      <span className="pulse-match-channel-pct pulse-mono">{pct}%</span>
    </div>
  )
}

/**
 * MatchMaker - Premium 4-step campaign wizard.
 * Slides through questions, outputs a tailored campaign plan.
 */
export default function MatchMaker() {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [direction, setDirection] = useState(1) // 1 = forward, -1 = back
  const [animating, setAnimating] = useState(false)
  const contentRef = useRef(null)

  const totalSteps = MATCH_QUESTIONS.length

  const handleSelect = useCallback((optionId) => {
    if (animating) return
    const q = MATCH_QUESTIONS[step]
    const nextAnswers = { ...answers, [q.id]: optionId }
    setAnswers(nextAnswers)
    setDirection(1)
    setAnimating(true)

    if (step < totalSteps - 1) {
      setTimeout(() => {
        setStep(step + 1)
        setAnimating(false)
      }, 250)
    } else {
      // Determine campaign result from first answer
      const promoteAnswer = nextAnswers.promote || 'token-launch'
      const campaign = CAMPAIGN_RESULTS[promoteAnswer] || CAMPAIGN_RESULTS['token-launch']
      setTimeout(() => {
        setResult(campaign)
        setAnimating(false)
      }, 250)
    }
  }, [answers, step, totalSteps, animating])

  const handleBack = useCallback(() => {
    if (step <= 0 || animating) return
    setDirection(-1)
    setAnimating(true)
    setTimeout(() => {
      setStep(step - 1)
      setAnimating(false)
    }, 250)
  }, [step, animating])

  const reset = useCallback(() => {
    setDirection(-1)
    setAnimating(true)
    setTimeout(() => {
      setStep(0)
      setAnswers({})
      setResult(null)
      setAnimating(false)
    }, 250)
  }, [])

  const progressPct = result
    ? 100
    : ((step + 1) / totalSteps) * 100

  // --- Result view ---
  if (result) {
    return (
      <div className="pulse-match">
        {/* Progress bar - full */}
        <div className="pulse-match-progress-track">
          <div
            className="pulse-match-progress-fill"
            style={{ width: '100%' }}
          />
        </div>

        <div className="pulse-match-result pulse-match-slide-enter">
          <div className="pulse-match-result-header">
            <h2 className="pulse-match-result-title">Campaign Plan</h2>
            <span className="pulse-match-step-indicator pulse-mono">
              Complete
            </span>
          </div>

          {/* Key metrics */}
          <div className="pulse-match-metrics">
            <MetricCard
              label="Matched Wallets"
              value={result.wallets}
              delay={100}
            />
            <MetricCard
              label="Intelligence Surfaces"
              value={result.surfaces}
              delay={200}
            />
            <MetricCard
              label="Est. CPA"
              value={result.cpa}
              prefix="$"
              delay={300}
            />
          </div>

          {/* Distribution */}
          <div className="pulse-match-distribution">
            <div className="pulse-match-dist-label">Distribution Mix</div>
            {result.distribution.map((ch, i) => (
              <DistributionBar
                key={ch.label}
                label={ch.label}
                pct={ch.pct}
                index={i}
              />
            ))}
          </div>

          {/* AI Recommendation */}
          <div className="pulse-match-recommendation">
            <div className="pulse-match-rec-header">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="pulse-match-rec-icon">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" />
                <path d="M2 17L12 22L22 17" />
                <path d="M2 12L12 17L22 12" />
              </svg>
              <span className="pulse-match-rec-title">AI Recommendation</span>
            </div>
            <p className="pulse-match-rec-body">{result.recommendation}</p>
          </div>

          {/* Actions */}
          <button className="pulse-match-cta" type="button">
            Start Campaign
          </button>
          <button className="pulse-match-reset-link" type="button" onClick={reset}>
            Start over
          </button>
        </div>
      </div>
    )
  }

  // --- Question view ---
  const q = MATCH_QUESTIONS[step]
  const slideClass = animating
    ? direction === 1
      ? 'pulse-match-slide-exit-left'
      : 'pulse-match-slide-exit-right'
    : 'pulse-match-slide-enter'

  return (
    <div className="pulse-match">
      {/* Progress bar */}
      <div className="pulse-match-progress-track">
        <div
          className="pulse-match-progress-fill"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div ref={contentRef} className={`pulse-match-content ${slideClass}`}>
        {/* Step header */}
        <div className="pulse-match-step-row">
          <span className="pulse-match-step-indicator pulse-mono">
            Step {step + 1} of {totalSteps}
          </span>
          {step > 0 && (
            <button
              className="pulse-match-back"
              type="button"
              onClick={handleBack}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19L5 12L12 5" />
              </svg>
              Back
            </button>
          )}
        </div>

        {/* Question */}
        <h2 className="pulse-match-question">{q.question}</h2>
        <p className="pulse-match-subtitle">{q.subtitle}</p>

        {/* Option grid */}
        <div className="pulse-match-options">
          {q.options.map((opt) => {
            const isSelected = answers[q.id] === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                className={`pulse-match-option ${isSelected ? 'pulse-match-option--selected' : ''}`}
                onClick={() => handleSelect(opt.id)}
              >
                <OptionIcon path={opt.icon} />
                <span className="pulse-match-opt-label">{opt.label}</span>
                {isSelected && (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="pulse-match-opt-check">
                    <path d="M20 6L9 17L4 12" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
