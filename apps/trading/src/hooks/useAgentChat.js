/**
 * useAgentChat - SSE chat hook for the Spectre Agent panel.
 *
 * POST /api/agent/chat with the Privy JWT + a fresh context digest, then
 * consume the typed SSE stream (meta / text / tool_start / tool_result /
 * trade_proposal / order_ticket / error / [DONE]) via fetch +
 * res.body.getReader() - the proven MonarchContext pattern; text deltas
 * are rAF-batched so streaming never floods React.
 *
 * Sessions are token-scoped: module map keyed `${address}:${networkId}`
 * with sessionStorage write-through ('spectre-agent-chat-v1', 20 messages
 * per token, 5 tokens LRU) so close/reopen and token switches keep
 * context. getAccessToken goes through a ref (privy.md D2).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePrivySafe, useWalletsSafe, useSolanaWalletsSafe, requestPrivyMount } from '../lib/use-privy-safe'
import { getDemoToken } from '../services/demoSession'
import { track, Events } from '../services/analytics'

const SS_KEY = 'spectre-agent-chat-v1'
const MAX_MSGS = 20
const MAX_TOKENS_STORED = 5

// token key -> { messages, ts }
const _sessions = new Map()

function loadSessions() {
  if (_sessions.size) return
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (raw) {
      const obj = JSON.parse(raw)
      for (const [k, v] of Object.entries(obj)) _sessions.set(k, v)
    }
  } catch { /* ignore */ }
}

function persistSessions() {
  try {
    const entries = [..._sessions.entries()].sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0)).slice(0, MAX_TOKENS_STORED)
    sessionStorage.setItem(SS_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* quota */ }
}

function sessionKey(token) {
  return `${String(token?.address || '').toLowerCase()}:${token?.networkId}`
}

export function useAgentChat(token, { getDigest, surface = 'desktop' } = {}) {
  const privy = usePrivySafe()
  const { wallets: evmWallets } = useWalletsSafe()
  const { wallets: solWallets } = useSolanaWalletsSafe()

  const key = sessionKey(token)
  const [messages, setMessages] = useState(() => {
    loadSessions()
    return _sessions.get(key)?.messages || []
  })
  const [streaming, setStreaming] = useState(false)
  const [toolActivity, setToolActivity] = useState(null) // { name } while a tool runs
  const [meta, setMeta] = useState(null)

  const abortRef = useRef(null)
  const keyRef = useRef(key)
  const mountedRef = useRef(true)
  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])
  const getTokenRef = useRef(privy?.getAccessToken)
  useEffect(() => { getTokenRef.current = privy?.getAccessToken }, [privy?.getAccessToken])

  // The stream that is currently allowed to mutate messages. A token switch
  // mid-stream bumps keyRef - the old stream's flushes must then be dropped,
  // never bleed into the NEW token's session.
  const streamKeyRef = useRef(null)

  // rAF-batched streaming text: buffer deltas, flush once per frame.
  const bufRef = useRef('')
  const rafRef = useRef(0)
  const flush = useCallback(() => {
    rafRef.current = 0
    const chunk = bufRef.current
    if (!chunk) return
    bufRef.current = ''
    if (streamKeyRef.current !== keyRef.current) return // aborted stream from a previous token
    setMessages((msgs) => {
      const next = [...msgs]
      const last = next[next.length - 1]
      if (last && last.role === 'model' && last.streaming) {
        next[next.length - 1] = { ...last, text: last.text + chunk }
      }
      return next
    })
  }, [])

  // Token switch: abort in-flight stream, load the new token's session.
  useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    abortRef.current?.abort()
    setStreaming(false)
    setToolActivity(null)
    loadSessions()
    setMessages(_sessions.get(key)?.messages || [])
  }, [key])

  useEffect(() => () => {
    mountedRef.current = false
    abortRef.current?.abort()
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    // Panel closed mid-stream: setMessages updaters no longer run, so
    // persist what we have (streaming flags cleared + any buffered tail)
    // straight into the session map so reopen restores the exchange.
    const key = keyRef.current
    const tail = bufRef.current
    const msgs = (messagesRef.current || []).map((m) => {
      if (!m.streaming) return m
      return { ...m, streaming: false, text: m.text + (m.role === 'model' ? tail : '') }
    })
    if (msgs.length) {
      _sessions.set(key, { messages: msgs.slice(-MAX_MSGS), ts: Date.now() })
      persistSessions()
    }
  }, [])

  const commit = useCallback((msgs) => {
    _sessions.set(keyRef.current, { messages: msgs.slice(-MAX_MSGS), ts: Date.now() })
    persistSessions()
  }, [])

  // Wallet for the TOKEN'S chain - a Solana address is useless for EVM
  // quotes/balances and vice versa.
  const isSolanaToken = token?.networkId === 1399811149
  const solAddress = solWallets?.find((w) => w.standardWallet?.isPrivyWallet)?.address || null
  const evmAddress = evmWallets?.find((w) => w.walletClientType === 'privy')?.address || null
  const walletAddress = isSolanaToken ? solAddress : evmAddress

  // send SETTLES ALWAYS with { status: 'done'|'skipped'|'aborted'|'error',
  // text, proposal, ticket } - the voice loop awaits it as its turn-
  // serialization primitive, so a guard-eaten call must resolve 'skipped'
  // (caller may re-queue) and a token-switch abort must resolve 'aborted',
  // never hang. Existing text-mode callers ignore the return value.
  const send = useCallback(async (text, opts = {}) => {
    const trimmed = String(text || '').trim()
    if (!trimmed || streaming) return { status: 'skipped', reason: 'busy', text: null }
    if (!token?.address) return { status: 'skipped', reason: 'no-token', text: null }

    let accessToken = null
    try { accessToken = await getTokenRef.current?.() } catch { /* stub or dead session */ }
    // Research-iframe read-only tier: no Privy session in the embed, but a
    // signed demo token exists - chat runs with capability 'read' (server
    // excludes all trading tools; mutations stay JWT-only).
    const demoToken = !accessToken && surface === 'embed' ? getDemoToken() : null
    if (!accessToken && !demoToken) {
      // Privy not mounted / not signed in: mount it and ask the user to sign in.
      requestPrivyMount('agent-chat')
      setMessages((msgs) => {
        const next = [...msgs, { role: 'system', text: 'Sign in to use the agent - it needs your session to answer safely.', ts: Date.now() }]
        commit(next)
        return next
      })
      try { privy?.login?.() } catch { /* gate flow handles it */ }
      return { status: 'skipped', reason: 'auth', text: null }
    }

    const sendKey = keyRef.current
    streamKeyRef.current = sendKey
    // Voice turns are tagged: they stay in the session (the model's memory
    // spans modes) but the TEXT surface never renders them as typed chat -
    // spoken conversation is not transcript spam (Gleb, live test).
    const voiceTurn = opts.mode === 'voice'
    const userMsg = { role: 'user', text: trimmed, ts: Date.now(), ...(voiceTurn ? { voice: true } : {}) }
    const modelMsg = { role: 'model', text: '', ts: Date.now(), streaming: true, ...(voiceTurn ? { voice: true } : {}) }
    setMessages((msgs) => [...msgs, userMsg, modelMsg])
    setStreaming(true)
    setToolActivity(null)
    track(Events.AGENT_PROMPT_SENT, { surface, chain: token.networkId, symbol: token.symbol })

    const ctrl = new AbortController()
    abortRef.current = ctrl

    let sawError = false
    // Local accumulation for the settle-always result - independent of the
    // rAF-batched React state (which a token switch may never receive).
    let fullText = ''
    let turnProposal = null
    let turnTicket = null
    let turnVisuals = []
    // A re-run of the same tool replaces its own scene, never stacks a dupe.
    const mergeVisual = (list, v) => [
      ...list.filter((x) => !(x.kind === v.kind && (x.resolution ?? null) === (v.resolution ?? null))),
      v,
    ]
    try {
      const chatBody = JSON.stringify({
        message: trimmed,
        token: { address: token.address, networkId: token.networkId, symbol: token.symbol, name: token.name, cgId: token.cgId, decimals: token.decimals },
        digest: getDigest?.() || null,
        walletAddress,
        surface,
        ...(opts.mode === 'voice' ? { mode: 'voice' } : {}),
      })
      const doFetch = (tok) => fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tok ? { Authorization: `Bearer ${tok}` } : { 'x-demo-token': demoToken }),
        },
        body: chatBody,
        signal: ctrl.signal,
      })
      let res = await doFetch(accessToken)

      // Stale Privy token after a long idle 401s once; a fresh
      // getAccessToken() mints a valid one - retry a single time instead of
      // surfacing "Unauthorized" for a signed-in user (hit twice live
      // 2026-07-11). Demo tier (no accessToken) never retries.
      if (res.status === 401 && accessToken) {
        let fresh = null
        try { fresh = await getTokenRef.current?.() } catch { /* keep null */ }
        if (fresh && fresh !== accessToken) res = await doFetch(fresh)
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Agent request failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue // ignore :heartbeat comments
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') { buffer = ''; break }
          let evt
          try { evt = JSON.parse(payload) } catch { continue }
          switch (evt.type) {
            case 'meta':
              setMeta(evt)
              break
            case 'text':
              fullText += evt.content || ''
              bufRef.current += evt.content || ''
              if (!rafRef.current) rafRef.current = requestAnimationFrame(flush)
              break
            case 'tool_start':
              setToolActivity({ id: evt.id, name: evt.name })
              setMessages((msgs) => {
                const next = [...msgs]
                const last = next[next.length - 1]
                if (last?.streaming) {
                  const tools = [...(last.tools || []), { id: evt.id, name: evt.name, status: 'running' }]
                  next[next.length - 1] = { ...last, tools }
                }
                return next
              })
              break
            case 'tool_result':
              setToolActivity(null)
              setMessages((msgs) => {
                const next = [...msgs]
                const last = next[next.length - 1]
                if (last?.streaming && last.tools) {
                  const tools = last.tools.map((t) => t.id === evt.id ? { ...t, status: evt.ok ? 'done' : 'failed', summary: evt.summary } : t)
                  next[next.length - 1] = { ...last, tools }
                }
                return next
              })
              break
            case 'x_profiles':
              // Author chips (pfp/verified/followers) for @handle rendering.
              setMessages((msgs) => {
                const next = [...msgs]
                const last = next[next.length - 1]
                if (last?.streaming) next[next.length - 1] = { ...last, xProfiles: { ...(last.xProfiles || {}), ...(evt.profiles || {}) } }
                return next
              })
              break
            case 'trade_proposal':
              turnProposal = evt.proposal || null
              track(Events.AGENT_TRADE_PROPOSED, { surface, chain: token.networkId, symbol: token.symbol, side: evt.proposal?.side })
              setMessages((msgs) => {
                const next = [...msgs]
                const last = next[next.length - 1]
                if (last?.streaming) next[next.length - 1] = { ...last, proposal: evt.proposal }
                return next
              })
              break
            case 'visual':
              // Presentation side-channel: a visual scene (drawn chart, X
              // account cards, ...) the agent shows while it talks -
              // rendered as cards on the message and staged live in the
              // voice overlay, synced to the speech.
              if (evt.visual) {
                turnVisuals = mergeVisual(turnVisuals, evt.visual)
                setMessages((msgs) => {
                  const next = [...msgs]
                  const last = next[next.length - 1]
                  if (last?.streaming) next[next.length - 1] = { ...last, visuals: mergeVisual(last.visuals || [], evt.visual) }
                  return next
                })
              }
              break
            case 'order_ticket':
              turnTicket = evt.ticket || null
              track(Events.AGENT_ORDER_PROPOSED, { surface, chain: token.networkId, symbol: token.symbol, kind: evt.ticket?.kind })
              setMessages((msgs) => {
                const next = [...msgs]
                const last = next[next.length - 1]
                if (last?.streaming) next[next.length - 1] = { ...last, ticket: evt.ticket }
                return next
              })
              break
            case 'error':
              sawError = true
              bufRef.current += (bufRef.current ? '\n\n' : '') + (evt.content || 'Something went wrong.')
              if (!rafRef.current) rafRef.current = requestAnimationFrame(flush)
              break
            default:
              break
          }
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        sawError = true
        bufRef.current += `\n${err.message || 'Connection lost - try again.'}`
        if (!rafRef.current) rafRef.current = requestAnimationFrame(flush)
      } else {
        sawError = 'aborted'
      }
    } finally {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
      const stillCurrent = keyRef.current === sendKey && mountedRef.current
      if (stillCurrent) {
        flushSyncTail()
        setStreaming(false)
        setToolActivity(null)
        setMessages((msgs) => {
          const next = msgs.map((m) => (m.streaming ? { ...m, streaming: false, error: !!sawError || undefined } : m))
          _sessions.set(sendKey, { messages: next.slice(-MAX_MSGS), ts: Date.now() })
          persistSessions()
          return next
        })
      } else {
        // Token switched or panel closed mid-stream: never touch the NEW
        // session's UI state; just drop the buffered tail (the unmount
        // cleanup handles persistence for the close case).
        bufRef.current = ''
      }
    }

    // Settle-always result (both finally branches fall through to here).
    const aborted = sawError === 'aborted' || keyRef.current !== sendKey || !mountedRef.current
    return {
      status: aborted ? 'aborted' : sawError ? 'error' : 'done',
      text: fullText || null,
      proposal: turnProposal,
      ticket: turnTicket,
      visuals: turnVisuals.length ? turnVisuals : null,
    }

    function flushSyncTail() {
      const chunk = bufRef.current
      if (!chunk) return
      bufRef.current = ''
      setMessages((msgs) => {
        const next = [...msgs]
        const last = next[next.length - 1]
        if (last && last.role === 'model') next[next.length - 1] = { ...last, text: last.text + chunk }
        return next
      })
    }
  }, [token, streaming, getDigest, walletAddress, surface, flush, commit, privy])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    _sessions.delete(keyRef.current)
    persistSessions()
    setMessages([])
    // Best-effort server-side clear (fire and forget).
    ;(async () => {
      try {
        const t = await getTokenRef.current?.()
        if (t && token?.address) {
          fetch(`/api/agent/history?address=${encodeURIComponent(token.address)}&networkId=${token.networkId}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${t}` },
          }).catch(() => {})
        }
      } catch { /* ignore */ }
    })()
  }, [token])

  return {
    messages,
    send,
    clear,
    streaming,
    toolActivity,
    meta,
    authenticated: !!privy?.authenticated,
  }
}
