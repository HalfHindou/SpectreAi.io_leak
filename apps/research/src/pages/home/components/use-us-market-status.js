/**
 * useUsMarketStatus - US stock market open/close status with countdown
 * Computes status from ET timezone, refreshes every 60s.
 * Returns { isOpen, statusLabel, timeMain, timeSub, countdown }
 */
import { useState, useEffect, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const INITIAL = {
  isOpen: false,
  statusLabel: 'Closed',
  timeMain: '9:30 AM ET',
  timeSub: 'OPENS',
  countdown: '',
}

export default function useUsMarketStatus() {
  const [usMarketStatus, setUsMarketStatus] = useState(INITIAL)

  const getStatus = useCallback(() => {
    const now = new Date()
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = et.getDay()
    const hrs = et.getHours()
    const mins = et.getMinutes()
    const isWeekday = day >= 1 && day <= 5
    const openMins = 9 * 60 + 30
    const closeMins = 16 * 60 + 0
    const currentMins = hrs * 60 + mins

    let isOpen = false
    let statusLabel = 'Closed'
    let timeMain = '9:30 AM ET'
    let timeSub = 'OPENS'
    let countdown = ''

    if (isWeekday) {
      if (currentMins >= openMins && currentMins < closeMins) {
        isOpen = true
        statusLabel = 'Trading Active'
        timeSub = 'CLOSES'
        timeMain = '4:00 PM ET'
        const closeIn = closeMins - currentMins
        const closeH = Math.floor(closeIn / 60)
        const closeM = closeIn % 60
        countdown = closeH > 0 ? `Closes in ${closeH}h ${closeM}m` : `Closes in ${closeM}m`
      } else if (currentMins < openMins) {
        timeMain = '9:30 AM ET'
        const openIn = openMins - currentMins
        const openH = Math.floor(openIn / 60)
        const openM = openIn % 60
        countdown = openH > 0 ? `Opens in ${openH}h ${openM}m` : `Opens in ${openM}m`
      } else {
        // After close - compute actual time until next open
        if (day === 5) {
          timeMain = 'Monday 9:30 AM ET'
          const minsLeft = (24 * 60 - currentMins) + 2 * 24 * 60 + openMins
          const d = Math.floor(minsLeft / (24 * 60))
          const h = Math.floor((minsLeft % (24 * 60)) / 60)
          const m = minsLeft % 60
          countdown = `Opens in ${d}d ${h}h ${m}m`
        } else {
          timeMain = 'Tomorrow 9:30 AM ET'
          const minsLeft = (24 * 60 - currentMins) + openMins
          const h = Math.floor(minsLeft / 60)
          const m = minsLeft % 60
          countdown = h > 0 ? `Opens in ${h}h ${m}m` : `Opens in ${m}m`
        }
      }
    } else {
      // Weekend - compute actual time until Monday 9:30 AM ET
      timeMain = 'Monday 9:30 AM ET'
      const daysToMon = day === 0 ? 1 : 2
      const minsLeft = (24 * 60 - currentMins) + (daysToMon - 1) * 24 * 60 + openMins
      const d = Math.floor(minsLeft / (24 * 60))
      const h = Math.floor((minsLeft % (24 * 60)) / 60)
      const m = minsLeft % 60
      if (d > 0) {
        countdown = `Opens in ${d}d ${h}h ${m}m`
      } else {
        countdown = h > 0 ? `Opens in ${h}h ${m}m` : `Opens in ${m}m`
      }
    }

    // perf: this runs on a 60s poll and is read directly in AppShell. Bail when
    // nothing changed so a tick doesn't force a full shell re-render every minute
    // (most off-hours ticks produce an identical object).
    setUsMarketStatus(prev =>
      (prev &&
        prev.isOpen === isOpen &&
        prev.statusLabel === statusLabel &&
        prev.timeMain === timeMain &&
        prev.timeSub === timeSub &&
        prev.countdown === countdown)
        ? prev
        : { isOpen, statusLabel, timeMain, timeSub, countdown })
  }, [])

  // Initial computation on mount
  useEffect(() => { getStatus() }, [getStatus])

  useAdaptivePolling(getStatus, { interval: 60000 })

  return usMarketStatus
}
