/**
 * Equity snapshots — the series behind every spark and the takeover curve.
 *
 * The endpoint answers with 5-minute snapshots, newest last, capped at 500 rows
 * and honouring `?limit=`. The roster therefore asks for SIXTY per book (17KB)
 * instead of five hundred (140KB): twelve sparks at full depth is 1.7MB of
 * payload to draw twelve 120px shapes. The takeover asks for the full series,
 * because there the series IS the content.
 *
 * Every field arrives as a string. Nothing leaves here unconverted, and a row
 * whose total_equity will not parse is dropped rather than plotted as zero.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { brainGet } from '@/pages/brain/components/brain-fetch'

const POLL_MS = 5 * 60_000
const SPARK_POINTS = 60
const CONCURRENCY = 3

const parseSeries = (rows) => {
  if (!Array.isArray(rows)) return null
  const points = []
  const stamps = []
  for (const r of rows) {
    const v = parseFloat(r?.total_equity)
    if (!Number.isFinite(v)) continue
    points.push(v)
    stamps.push(r.ts || null)
  }
  if (!points.length) return null
  return { points, stamps, n: points.length, from: stamps[0], to: stamps[stamps.length - 1] }
}

async function pool(items, worker, limit = CONCURRENCY) {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      // eslint-disable-next-line no-await-in-loop
      await worker(item)
    }
  })
  await Promise.all(runners)
}

/** id → series, for the roster's sparks. Books with no leaderboard id are not
 *  requested at all — there is nothing published to request. */
export function useRosterEquity(ids) {
  const key = useMemo(() => (ids || []).filter(Boolean).join(','), [ids])
  const [series, setSeries] = useState({})
  const [ready, setReady] = useState(false)
  const aliveRef = useRef(true)

  const load = useCallback(async (idList) => {
    if (!idList.length) { setReady(true); return }
    await pool(idList, async (id) => {
      const rows = await brainGet(`/data-api/v1/paper-trading/${encodeURIComponent(id)}/equity?limit=${SPARK_POINTS}`)
      if (!aliveRef.current) return
      const s = parseSeries(rows)
      // A failed poll leaves the previous series alone — a spark that blanks
      // for one tick reads as a book that stopped reporting.
      if (s) setSeries((prev) => ({ ...prev, [id]: s }))
    })
    if (aliveRef.current) setReady(true)
  }, [])

  useEffect(() => {
    aliveRef.current = true
    const idList = key ? key.split(',') : []
    load(idList)
    const t = setInterval(() => { if (!document.hidden) load(idList) }, POLL_MS)
    return () => { aliveRef.current = false; clearInterval(t) }
  }, [key, load])

  return { series, ready }
}

/** The full series for one book, plus its published detail (positions, peak,
 *  config). Both are takeover-only — nothing on the board needs them. */
export function useTraderDetail(id) {
  const [equity, setEquity] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    if (!id) { setLoading(false); return undefined }
    setLoading(true)
    setFailed(false)
    setEquity(null)
    setDetail(null)
    Promise.all([
      brainGet(`/data-api/v1/paper-trading/${encodeURIComponent(id)}/equity`),
      brainGet(`/data-api/v1/paper-trading/${encodeURIComponent(id)}`),
    ]).then(([rows, d]) => {
      if (!alive) return
      const s = parseSeries(rows)
      setEquity(s)
      setDetail(d && typeof d === 'object' ? d : null)
      setFailed(!s && !d)
      setLoading(false)
    })
    return () => { alive = false }
  }, [id])

  return { equity, detail, loading, failed }
}
