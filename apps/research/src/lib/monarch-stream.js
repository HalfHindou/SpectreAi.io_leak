/**
 * monarch-stream — shared transport for `/api/monarch/chat`.
 *
 * This is the ONLY LLM chat endpoint that exists on both sides of the dev/prod
 * split: Express serves it directly, and `apps/research/vercel.json` rewrites it
 * to `/api/monarch-api?fn=chat`. Anything that needs an answer from Spectre
 * should stream through here rather than inventing a dev-only route.
 *
 * Wire format: plain `data: {...}\n\n` frames (no `event:` prefix) carrying
 * `{ type: 'meta' | 'text' | 'error', content? }`, terminated by `data: [DONE]`.
 * The server writes `:heartbeat` comment lines every 15s to keep the socket
 * warm; those carry no payload and are skipped.
 */

/**
 * Split a raw SSE buffer into complete frames, returning the unconsumed tail so
 * the caller can prepend it to the next chunk.
 * @param {string} buffer
 * @returns {{ frames: string[], tail: string }}
 */
export function parseSseFrames(buffer) {
  const frames = []
  let tail = buffer
  let boundary
  while ((boundary = tail.indexOf('\n\n')) !== -1) {
    const frame = tail.slice(0, boundary)
    tail = tail.slice(boundary + 2)
    const dataLines = []
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue // heartbeat comment
      if (line.startsWith('data: ')) dataLines.push(line.slice(6))
      else if (line.startsWith('data:')) dataLines.push(line.slice(5))
    }
    if (dataLines.length) frames.push(dataLines.join('\n'))
  }
  return { frames, tail }
}

/**
 * POST a message list to `/api/monarch/chat` and stream the answer back.
 *
 * `onText` receives the full accumulated answer on every token, so callers can
 * render straight into state without keeping their own accumulator.
 *
 * The timeout is per-chunk, not per-request: an LLM answer legitimately takes
 * longer than any single fixed deadline, but a stream that goes quiet is dead.
 * The server enforces its own 30s idle cut, so this is the client-side mirror.
 *
 * @param {Object} opts
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {Object} [opts.context] - optional `{ page, token, marketMode }` hints
 * @param {AbortSignal} [opts.signal]
 * @param {(text: string) => void} [opts.onText]
 * @param {number} [opts.idleTimeoutMs=35000]
 * @returns {Promise<string>} the final answer text
 */
export async function streamMonarchChat({ messages, context, signal, onText, idleTimeoutMs = 35_000 }) {
  // Compose the caller's signal with an idle watchdog. `AbortSignal.any` is not
  // safe to assume here, so we forward the external abort into our own
  // controller and let the watchdog abort the same one.
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', forwardAbort, { once: true })
  }

  let lastChunkAt = Date.now()
  let idleTripped = false
  const watchdog = setInterval(() => {
    if (Date.now() - lastChunkAt < idleTimeoutMs) return
    idleTripped = true
    controller.abort()
  }, 5_000)

  const cleanup = () => {
    clearInterval(watchdog)
    signal?.removeEventListener('abort', forwardAbort)
  }

  try {
    const res = await fetch('/api/monarch/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(context ? { messages, context } : { messages }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      // Gated routes answer 401/503 with a JSON body; surface that rather than
      // a bare status code the user can do nothing with.
      let detail = ''
      try { detail = (await res.json())?.error || '' } catch (_) { /* not JSON */ }
      throw new Error(detail || `Monarch unavailable (${res.status})`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let acc = ''
    let done = false

    while (!done) {
      let read
      try {
        read = await reader.read()
      } catch (err) {
        if (idleTripped) throw new Error('Monarch stream went quiet')
        throw err
      }
      if (read.done) break
      lastChunkAt = Date.now()
      buffer += decoder.decode(read.value, { stream: true })
      const { frames, tail } = parseSseFrames(buffer)
      buffer = tail
      for (const raw of frames) {
        if (raw === '[DONE]') { done = true; break }
        let parsed
        try { parsed = JSON.parse(raw) } catch (_) { continue }
        if (parsed.type === 'text' && typeof parsed.content === 'string') {
          acc += parsed.content
          onText?.(acc)
        } else if (parsed.type === 'error') {
          throw new Error(parsed.content || 'Monarch error')
        }
      }
    }

    try { await reader.cancel() } catch (_) { /* stream already closed */ }
    return acc
  } finally {
    cleanup()
  }
}
