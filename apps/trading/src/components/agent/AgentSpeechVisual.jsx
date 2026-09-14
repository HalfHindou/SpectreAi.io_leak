/**
 * AgentSpeechVisual - the speech HUD. While Jarvis talks, the overlay does
 * NOT mirror his prose as a static caption (that reads as "TTS feature");
 * it shows what an organic copilot would project:
 *
 *   1. STAT CHIPS - the key figures extracted from the reply ("$10,114",
 *      "VOLUME") materialize as terminal callouts, timed to WHEN the voice
 *      reaches them. Listen to the sentence, watch the number.
 *   2. A karaoke line - only the CURRENT sentence, its words lighting up
 *      in pace with the voice, cross-fading to the next.
 *
 * Pacing: proportional character position across the known audio duration
 * (Chirp has no word timestamps; even distribution tracks closely at
 * sentence granularity). Reduced motion renders everything statically.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import './AgentSpeechVisual.css'

const LABEL_WORDS = [
  ['market cap', 'MARKET CAP'], ['mcap', 'MARKET CAP'], ['fdv', 'FDV'],
  ['volume', 'VOLUME'], ['liquidity', 'LIQUIDITY'], ['price', 'PRICE'],
  ['holders', 'HOLDERS'], ['supply', 'SUPPLY'], ['tax', 'TAX'],
  ['mentions', 'MENTIONS'], ['followers', 'FOLLOWERS'], ['days', 'AGE'],
  ['concentration', 'TOP HOLDERS'], ['impact', 'IMPACT'],
]

/** Spoken figures -> terminal chips: "3.67 million dollar" -> $3.67M,
    "10114 dollars" -> $10,114, "3.4 percent" -> 3.4%. */
function extractStats(text) {
  const stats = []
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand)?\s*(dollars?|percent|%)?/gi
  let m
  while ((m = re.exec(text)) && stats.length < 4) {
    const [raw, numStr, scale, unit] = m
    if (!unit && !scale) {
      // Bare numbers only qualify with a strong label nearby (e.g. holders).
      const back = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase()
      if (!/(holders|mentions|followers|days|supply)\s*$/.test(back.trimEnd() + ' ')) {
        if (!/(holders|mentions|followers|days)/.test(back)) continue
      }
    }
    const num = parseFloat(numStr.replace(/,/g, ''))
    if (!Number.isFinite(num) || num === 0) continue

    let value
    if (unit && /percent|%/.test(unit)) {
      value = `${num}%`
    } else if (unit && /dollar/.test(unit)) {
      if (scale === 'billion') value = `$${num}B`
      else if (scale === 'million') value = `$${num}M`
      else if (scale === 'thousand') value = `$${num}K`
      else value = `$${num.toLocaleString('en-US')}`
    } else if (scale) {
      value = `${num}${scale === 'billion' ? 'B' : scale === 'million' ? 'M' : 'K'}`
    } else {
      value = num.toLocaleString('en-US')
    }

    // Label: nearest keyword around the figure - English puts it on either
    // side ("volume ... is 10114 dollars" / "3.67 million dollar market cap").
    const before = text.slice(Math.max(0, m.index - 60), m.index).toLowerCase()
    const after = text.slice(m.index + raw.length, m.index + raw.length + 30).toLowerCase()
    let label = null
    let best = -1
    for (const [needle, out] of LABEL_WORDS) {
      const atBefore = before.lastIndexOf(needle)
      if (atBefore > best) { best = atBefore; label = out }
      const atAfter = after.indexOf(needle)
      if (atAfter >= 0) {
        // Following labels sit right next to the figure - closeness score
        // beats a distant preceding keyword.
        const score = 60 - atAfter
        if (score > best) { best = score; label = out }
      }
    }
    if (!label) continue
    if (stats.some((s) => s.label === label)) continue
    stats.push({ label, value, at: m.index + raw.length / 2 })
  }
  return stats
}

export default function AgentSpeechVisual({ text, durationMs, hideStats = false }) {
  const clean = String(text || '').trim()
  const total = Math.max(1500, Number(durationMs) || clean.length * 62)

  const { sentences, stats } = useMemo(() => {
    const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean)
    let acc = 0
    const sentences = parts.map((s) => {
      const start = acc / Math.max(1, clean.length)
      acc += s.length + 1
      const end = acc / Math.max(1, clean.length)
      return { text: s, start, end }
    })
    return { sentences, stats: extractStats(clean) }
  }, [clean])

  const [now, setNow] = useState(0) // 0..1 progress through the speech
  const startRef = useRef(0)
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

  useEffect(() => {
    startRef.current = performance.now()
    setNow(0)
    if (reduced) { setNow(1); return undefined }
    let raf = 0
    const tick = () => {
      const p = (performance.now() - startRef.current) / total
      setNow(Math.min(1, p))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clean, total])

  if (!clean) return null

  const current = sentences.find((s) => now >= s.start && now < s.end) || sentences[sentences.length - 1]
  const sentProgress = current ? Math.min(1, Math.max(0, (now - current.start) / Math.max(0.001, current.end - current.start))) : 1
  const words = current ? current.text.split(/\s+/) : []
  const litCount = Math.ceil(words.length * sentProgress)

  return (
    <div className="saspeech">
      {!hideStats && stats.length > 0 && (
        <div className="saspeech__stats">
          {stats.map((s) => {
            const revealed = reduced || now >= (s.at / Math.max(1, clean.length)) * 0.92
            return (
              <div key={s.label} className={`saspeech__chip${revealed ? ' is-on' : ''}`}>
                <span className="saspeech__chip-value">{s.value}</span>
                <span className="saspeech__chip-label">{s.label}</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="saspeech__line" key={current?.text}>
        {words.map((w, i) => (
          <span key={`${i}-${w}`} className={`saspeech__word${i < litCount ? ' is-lit' : ''}`}>{w} </span>
        ))}
      </div>
    </div>
  )
}
