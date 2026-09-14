/**
 * MobileScrollTop - a compact "back to top" button that fades in once the
 * token page has scrolled past a threshold and smooth-scrolls back up on tap.
 *
 * The token page has TWO scrollers: the outer `.app` container
 * (App.css: height:100vh; overflow-y:auto) scrolls the hero/chart off, and
 * the transactions table is its own capped scrollbox
 * (`.mdt .table-wrapper` max-height:420px; overflow-y:auto). A single
 * CAPTURE-phase scroll listener on `window` catches scroll from ANY of them
 * (scroll doesn't bubble, but capture still reaches every target), and we
 * take the max scrollTop so the button appears whichever the user scrolls.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import './MobileScrollTop.css'

const SHOW_AFTER = 160 // px scrolled (outer page OR inner table) before showing

function scrollTops() {
  const app = document.querySelector('.app')
  const table = document.querySelector('.mtp .mdt .table-wrapper')
  return {
    app,
    table,
    max: Math.max(
      app ? app.scrollTop : 0,
      window.scrollY || document.documentElement.scrollTop || 0,
      table ? table.scrollTop : 0,
    ),
  }
}

export default function MobileScrollTop({ hidden = false }) {
  const [scrolled, setScrolled] = useState(false)
  const rafRef = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        setScrolled(scrollTops().max > SHOW_AFTER)
      })
    }
    // capture:true so scroll from inner scrollers (the table box) is caught too
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const toTop = useCallback(() => {
    const { app, table } = scrollTops()
    app?.scrollTo({ top: 0, behavior: 'smooth' })
    table?.scrollTo({ top: 0, behavior: 'smooth' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const show = scrolled && !hidden

  return (
    <button
      type="button"
      className={`mstt${show ? ' mstt--show' : ''}`}
      onClick={toTop}
      aria-label="Scroll to top"
      tabIndex={show ? 0 : -1}
    >
      <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
    </button>
  )
}
