import { useCallback, useEffect, useRef, useState } from 'react'
import { computeGtmProposal, buildGtmContext, GTM_DIRECTIVE } from './xd-gtm-engine'
import { parseSseFrames } from '@/lib/monarch-stream'

/**
 * use-gtm-proposal — powers the X Dash "Institutions" GTM engine. Imperatively
 * compute a go-to-market proposal for a brand + goal, then (on demand) stream an
 * LLM proposal narrative via /api/monarch/chat.
 *
 * Mirrors use-hype-forensics.js for the LLM transport (parseSseFrames + reader loop +
 * AbortController) so the streaming behavior is identical across the X Dash tabs.
 */

export function useGtmProposal() {
  const [proposal, setProposal] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [narrative, setNarrative] = useState('')
  const [narrativeState, setNarrativeState] = useState('idle') // idle | streaming | done | error

  const genAbortRef = useRef(null) // aborts in-flight generate (async-tolerant enrichment)
  const llmAbortRef = useRef(null) // aborts in-flight narrative stream
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      genAbortRef.current?.abort()
      llmAbortRef.current?.abort()
    }
  }, [])

  const generate = useCallback(async (brand, goal, subjectType) => {
    const name = String(brand || '').trim()
    if (!name) {
      // Gentle no-op: surface guidance, don't compute against an empty subject.
      setError(subjectType === 'creator' ? 'Enter a creator to build a plan.' : 'Enter a brand to build a proposal.')
      return
    }

    // Replace any in-flight generate + abort any running narrative stream.
    genAbortRef.current?.abort()
    llmAbortRef.current?.abort()
    const controller = new AbortController()
    genAbortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      // Async-tolerant so live-data enrichment can be added later; resolves fast today.
      const computed = await computeGtmProposal({ brand: name, subject: name, subjectType, goal })
      if (controller.signal.aborted || !mountedRef.current) return
      setProposal(computed || null)
      setNarrative('')
      setNarrativeState('idle')
      setLoading(false)
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError' || !mountedRef.current) return
      setError('Could not build the proposal.')
      setLoading(false)
    }
  }, [])

  const runNarrative = useCallback(async () => {
    if (!proposal) return
    const context = buildGtmContext(proposal)
    if (!context) return
    const brand = proposal.brand
    const subjectType = proposal.subjectType

    llmAbortRef.current?.abort()
    const controller = new AbortController()
    llmAbortRef.current = controller
    setNarrative('')
    setNarrativeState('streaming')

    try {
      const res = await fetch('/api/monarch/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Write the crypto GTM ${subjectType === 'creator' ? 'plan' : 'proposal'} for ${brand}. ${GTM_DIRECTIVE(brand, subjectType)}` }],
          context,
        }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) throw new Error(`Proposal unavailable (${res.status})`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''
      let done = false
      while (!done) {
        const { done: d, value } = await reader.read()
        if (d) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, tail } = parseSseFrames(buffer)
        buffer = tail
        for (const raw of frames) {
          if (raw === '[DONE]') { done = true; break }
          let parsed
          try { parsed = JSON.parse(raw) } catch (_) { continue }
          if (parsed.type === 'text' && typeof parsed.content === 'string') {
            acc += parsed.content
            if (!controller.signal.aborted && mountedRef.current) setNarrative(acc)
          } else if (parsed.type === 'error') {
            throw new Error(parsed.content || 'Proposal error')
          }
        }
      }
      if (controller.signal.aborted || !mountedRef.current) return
      setNarrativeState('done')
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError' || !mountedRef.current) return
      setNarrativeState('error')
      // Keep any partial narrative; only fall back to a readable message if empty.
      setNarrative((prev) => prev || (err.message || 'Proposal failed.'))
    }
  }, [proposal])

  return { proposal, loading, error, generate, narrative, narrativeState, runNarrative }
}
