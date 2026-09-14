/**
 * MobileFilterSheet — iOS-style bottom sheet holding every transactions-table
 * filter. On mobile the per-column header funnels are hidden; this sheet is the
 * single entry point.
 *
 * Keeps a LOCAL draft (seeded from the currently-applied filters when it opens)
 * and only commits to the real DataTabs state on "Apply". "Reset" clears the
 * draft. Shares the slide-up + drag-to-dismiss UX with the other mobile sheets
 * (mis-/mss-/mwd-); prefix: mfs-.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import './MobileFilterSheet.css'

const EMPTY_RANGE = { min: '', max: '' }
const EMPTY_PRICE = { min: '', max: '', minUnit: 1000000, maxUnit: 1000000 }

const truncAddr = (a) => (!a ? '' : a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`)

const isSet = (r) => !!r && (r.min !== '' || r.max !== '')

/* USD presets - the floor a trader actually reaches for ("show me the
   whales"). Each sets `min` only and leaves `max` open. */
const USD_PRESETS = [
  { label: '$100+', min: '100' },
  { label: '$1K+', min: '1000' },
  { label: '$10K+', min: '10000' },
  { label: '$50K+', min: '50000' },
]

const MAKERS_COLLAPSED = 4

/* One number field. The currency prefix lives INSIDE the box as an
   adornment - as a sibling it stole width from the Min input and the
   two fields stopped lining up. */
function Field({ value, onChange, placeholder, prefix }) {
  return (
    <label className={`mfs-field${prefix ? ' mfs-field--prefixed' : ''}`}>
      {prefix && <span className="mfs-field-prefix" aria-hidden="true">{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        className="mfs-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function RangeRow({ value, onChange, prefix }) {
  return (
    <div className="mfs-range">
      <Field prefix={prefix} placeholder="Min" value={value.min} onChange={(v) => onChange({ ...value, min: v })} />
      <span className="mfs-range-dash" aria-hidden="true">–</span>
      <Field prefix={prefix} placeholder="Max" value={value.max} onChange={(v) => onChange({ ...value, max: v })} />
    </div>
  )
}

/* Section head. When the section carries a value it gets a dot + its own
   clear button, so the user can drop one filter without hunting through
   inputs or nuking everything with "Reset all". */
function SectionHead({ label, active, onClear, children }) {
  return (
    <div className="mfs-label-row">
      <span className={`mfs-label${active ? ' mfs-label--active' : ''}`}>
        {active && <span className="mfs-label-dot" aria-hidden="true" />}
        {label}
      </span>
      <div className="mfs-label-tools">
        {children}
        {active && (
          <button type="button" className="mfs-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

export default function MobileFilterSheet({
  open,
  onClose,
  focusSection = null,
  nativeTokenSymbol = 'ETH',
  filters,
}) {
  const {
    typeFilter, setTypeFilter, typeFilterOptions = [],
    priceFilter, setPriceFilter, showPriceMode, setShowPriceMode, unitOptions = [],
    amountFilter, setAmountFilter, showAmountMode, setShowAmountMode,
    ethFilter, setEthFilter,
    valueFilter, setValueFilter,
    makerFilter, setMakerFilter, uniqueMakers = [],
  } = filters || {}

  const sheetRef = useRef(null)
  const startYRef = useRef(null)
  const sectionRefs = useRef({})
  const [dragOffset, setDragOffset] = useState(0)

  /* ── Local draft, seeded from applied state on open ──────────────── */
  const [dType, setDType] = useState(null)
  const [dPrice, setDPrice] = useState(EMPTY_PRICE)
  const [dPriceMode, setDPriceMode] = useState(true)
  const [dAmount, setDAmount] = useState(EMPTY_RANGE)
  const [dAmountMode, setDAmountMode] = useState(true)
  const [dEth, setDEth] = useState(EMPTY_RANGE)
  const [dValue, setDValue] = useState(EMPTY_RANGE)
  const [dMaker, setDMaker] = useState('')
  const [makersOpen, setMakersOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setDragOffset(0)
    setDType(typeFilter ?? null)
    setDPrice(priceFilter ? { ...priceFilter } : EMPTY_PRICE)
    setDPriceMode(showPriceMode)
    setDAmount(amountFilter ? { ...amountFilter } : EMPTY_RANGE)
    setDAmountMode(showAmountMode)
    setDEth(ethFilter ? { ...ethFilter } : EMPTY_RANGE)
    setDValue(valueFilter ? { ...valueFilter } : EMPTY_RANGE)
    setDMaker(makerFilter || '')
    setMakersOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* Lock the page behind while the sheet is open. MobileTokenPage locks the
     scroller for its own overlays (drawer/swap/agent/alert), but this sheet is
     portalled out of DataTabs so it was never in that set: the page kept
     scrolling under the sheet, and the momentum that leaves behind eats the
     next tap on iOS - the close button then needs a second press and the sheet
     reads as taking seconds to dismiss. `.app` is the real scroller; body is
     locked too for the browsers that scroll the document instead. */
  useEffect(() => {
    if (!open) return undefined
    const scroller = document.querySelector('.app')
    const prevBody = document.body.style.overflow
    const prevScroller = scroller?.style.overflow
    const top = scroller?.scrollTop ?? 0
    document.body.style.overflow = 'hidden'
    if (scroller) scroller.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      if (scroller) {
        scroller.style.overflow = prevScroller || ''
        // overflow:hidden can drop the offset on some engines - put it back.
        if (scroller.scrollTop !== top) scroller.scrollTop = top
      }
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /* Opened from a per-column header funnel → scroll that section into view and
     pulse it so the user sees which filter the funnel jumped to. */
  useEffect(() => {
    if (!open || !focusSection) return
    const el = sectionRefs.current[focusSection]
    if (!el) return
    const id = requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.add('mfs-section--flash')
      setTimeout(() => el.classList.remove('mfs-section--flash'), 1100)
    })
    return () => cancelAnimationFrame(id)
  }, [open, focusSection])

  const draftCount = useMemo(() => {
    let n = 0
    if (dType) n++
    if (dPrice.min !== '' || dPrice.max !== '') n++
    if (dAmount.min !== '' || dAmount.max !== '') n++
    if (dEth.min !== '' || dEth.max !== '') n++
    if (dValue.min !== '' || dValue.max !== '') n++
    if (dMaker) n++
    return n
  }, [dType, dPrice, dAmount, dEth, dValue, dMaker])

  /* Collapsed by default - the full list used to eat half the sheet. The
     picked maker is always kept in view, even if it ranks below the cut. */
  const visibleMakers = useMemo(() => {
    if (makersOpen) return uniqueMakers
    const head = uniqueMakers.slice(0, MAKERS_COLLAPSED)
    if (!dMaker || head.some(([addr]) => addr === dMaker)) return head
    const picked = uniqueMakers.find(([addr]) => addr === dMaker)
    return picked ? [picked, ...head.slice(0, MAKERS_COLLAPSED - 1)] : head
  }, [uniqueMakers, makersOpen, dMaker])

  /* Drag-to-dismiss. Bound to the grabber AND the header - the grabber strip
     alone is 18px tall, which is a miss on a phone. A touch that starts on a
     control (the X, the count badge's row) is not a drag. */
  const handleTouchStart = (e) => {
    if (e.target?.closest?.('button')) { startYRef.current = null; return }
    startYRef.current = e.touches?.[0]?.clientY ?? null
  }
  const handleTouchMove = (e) => {
    if (startYRef.current == null) return
    const dy = (e.touches?.[0]?.clientY ?? startYRef.current) - startYRef.current
    if (dy > 0) setDragOffset(dy)
  }
  const handleTouchEnd = () => {
    if (dragOffset > 120) onClose?.()
    else setDragOffset(0)
    startYRef.current = null
  }
  const dragHandlers = {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
  }

  const handleApply = () => {
    setTypeFilter?.(dType)
    setShowPriceMode?.(dPriceMode)
    setPriceFilter?.({ ...dPrice })
    setShowAmountMode?.(dAmountMode)
    setAmountFilter?.({ ...dAmount })
    setEthFilter?.({ ...dEth })
    setValueFilter?.({ ...dValue })
    setMakerFilter?.(dMaker.trim())
    onClose?.()
  }

  const handleReset = () => {
    setDType(null)
    setDPrice(EMPTY_PRICE)
    setDAmount(EMPTY_RANGE)
    setDEth(EMPTY_RANGE)
    setDValue(EMPTY_RANGE)
    setDMaker('')
  }

  if (!open) return null

  return (
    <div className="mfs-root" role="dialog" aria-modal="true" aria-label="Filters">
      <button type="button" className="mfs-backdrop" aria-label="Close filters" onClick={onClose} />

      <div
        ref={sheetRef}
        className="mfs-sheet"
        /* `mfsSheetIn` uses fill-mode `both`, and a CSS animation's computed
           value BEATS an inline style - so the entrance keyframe's
           translateY(0) pinned the sheet and the drag never moved it (verified
           in-page: the inline transform was ignored outright). Drop the
           animation for the duration of the drag. Same fix as mmk-. */
        style={dragOffset ? { transform: `translateY(${dragOffset}px)`, animation: 'none' } : undefined}
      >
        <div className="mfs-grabber-region" {...dragHandlers}>
          <div className="mfs-grabber" aria-hidden="true" />
        </div>

        <header className="mfs-header" {...dragHandlers}>
          <h2 className="mfs-title">
            Filters
            {draftCount > 0 && <span className="mfs-count">{draftCount}</span>}
          </h2>
          <button type="button" className="mfs-close-btn" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        <div className="mfs-body">
          {/* Type */}
          <section className="mfs-section" ref={(el) => { sectionRefs.current.type = el }}>
            <SectionHead label="Type" active={!!dType} onClear={() => setDType(null)} />
            <div className="mfs-seg">
              {typeFilterOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  className={`mfs-seg-btn${(dType ?? null) === opt.value ? ' mfs-seg-btn--active' : ''}`}
                  onClick={() => setDType(opt.value)}
                >
                  {opt.color && <span className="mfs-seg-dot" style={{ background: opt.color }} />}
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Price / MCap */}
          <section className="mfs-section" ref={(el) => { sectionRefs.current.price = el }}>
            <SectionHead
              label={dPriceMode ? 'Price (USD)' : 'Market Cap'}
              active={isSet(dPrice)}
              onClear={() => setDPrice({ ...EMPTY_PRICE, minUnit: dPrice.minUnit, maxUnit: dPrice.maxUnit })}
            >
              <div className="mfs-toggle">
                <button type="button" className={`mfs-toggle-opt${dPriceMode ? ' active' : ''}`} onClick={() => setDPriceMode(true)}>Price</button>
                <button type="button" className={`mfs-toggle-opt${!dPriceMode ? ' active' : ''}`} onClick={() => setDPriceMode(false)}>MCap</button>
              </div>
            </SectionHead>
            <RangeRow value={dPrice} onChange={(v) => setDPrice({ ...dPrice, ...v })} prefix={dPriceMode ? '$' : null} />
            {!dPriceMode && unitOptions.length > 0 && (
              <div className="mfs-units">
                {unitOptions.filter((u) => u.label !== '-').map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`mfs-unit${dPrice.minUnit === opt.value ? ' active' : ''}`}
                    onClick={() => setDPrice({ ...dPrice, minUnit: opt.value, maxUnit: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Amount */}
          <section className="mfs-section" ref={(el) => { sectionRefs.current.amount = el }}>
            <SectionHead
              label={dAmountMode ? 'Amount' : 'Amount (%)'}
              active={isSet(dAmount)}
              onClear={() => setDAmount(EMPTY_RANGE)}
            >
              <div className="mfs-toggle">
                <button type="button" className={`mfs-toggle-opt${dAmountMode ? ' active' : ''}`} onClick={() => setDAmountMode(true)}>Amount</button>
                <button type="button" className={`mfs-toggle-opt${!dAmountMode ? ' active' : ''}`} onClick={() => setDAmountMode(false)}>%</button>
              </div>
            </SectionHead>
            <RangeRow value={dAmount} onChange={setDAmount} />
          </section>

          {/* Native token */}
          <section className="mfs-section" ref={(el) => { sectionRefs.current.native = el }}>
            <SectionHead label={nativeTokenSymbol} active={isSet(dEth)} onClear={() => setDEth(EMPTY_RANGE)} />
            <RangeRow value={dEth} onChange={setDEth} />
          </section>

          {/* USD value */}
          <section className="mfs-section" ref={(el) => { sectionRefs.current.value = el }}>
            <SectionHead label="USD Value" active={isSet(dValue)} onClear={() => setDValue(EMPTY_RANGE)} />
            <div className="mfs-presets">
              {USD_PRESETS.map((p) => {
                const on = dValue.min === p.min && dValue.max === ''
                return (
                  <button
                    key={p.label}
                    type="button"
                    className={`mfs-preset${on ? ' active' : ''}`}
                    onClick={() => setDValue(on ? EMPTY_RANGE : { min: p.min, max: '' })}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
            <RangeRow value={dValue} onChange={setDValue} prefix="$" />
          </section>

          {/* Maker */}
          <section className="mfs-section" ref={(el) => { sectionRefs.current.maker = el }}>
            <SectionHead label="Maker address" active={!!dMaker} onClear={() => setDMaker('')} />
            <input
              type="text"
              className="mfs-input mfs-input--full"
              placeholder="0x…"
              value={dMaker}
              onChange={(e) => setDMaker(e.target.value)}
            />
            {visibleMakers.length > 0 && (
              <>
                <div className="mfs-makers">
                  {visibleMakers.map(([addr, stats]) => (
                    <button
                      key={addr}
                      type="button"
                      className={`mfs-maker${dMaker === addr ? ' active' : ''}`}
                      onClick={() => setDMaker(dMaker === addr ? '' : addr)}
                    >
                      <span className="mfs-maker-addr">{truncAddr(addr)}</span>
                      {/* uniqueMakers entries are [addr, { count, lean }] - render
                          the numeric count, not the whole object (React child). */}
                      <span className="mfs-maker-count">{stats && typeof stats === 'object' ? stats.count : stats}</span>
                    </button>
                  ))}
                </div>
                {uniqueMakers.length > MAKERS_COLLAPSED && (
                  <button type="button" className="mfs-more" onClick={() => setMakersOpen((v) => !v)}>
                    {makersOpen ? 'Show less' : `Show all ${uniqueMakers.length} makers`}
                  </button>
                )}
              </>
            )}
          </section>
        </div>

        <footer className="mfs-footer">
          <button
            type="button"
            className="mfs-btn mfs-btn--ghost"
            onClick={handleReset}
            disabled={draftCount === 0}
          >
            Reset all
          </button>
          <button type="button" className="mfs-btn mfs-btn--primary" onClick={handleApply}>
            Apply{draftCount > 0 ? ` (${draftCount})` : ''}
          </button>
        </footer>
      </div>
    </div>
  )
}
