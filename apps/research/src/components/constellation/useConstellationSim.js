/**
 * useConstellationSim — owns the d3-force WEB WORKER and the shared position
 * buffers for the CONSTELLATION ENGINE.
 *
 * The contract that keeps the main thread free:
 *   - The worker (sim.worker.js) runs the physics and posts node positions
 *     back as a transferable Float32Array.
 *   - We write those into a ref (`targetsRef`) — NEVER React state. The render
 *     loop reads the ref and lerps toward it each animation frame.
 *   - `runningRef` flips true while the layout is moving; the engine watches it
 *     to call invalidate() (frameloop="demand") and stops when it settles.
 *   - On a fresh layout the worker posts the seeded positions immediately, so
 *     `targetsRef` is populated for the first frame.
 *
 * Returns an OBJECT (hook contract). Position state is exposed as refs so the
 * engine can read them inside useFrame without triggering re-renders.
 *
 * Worker URL uses the canonical Vite pattern:
 *   new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' })
 * which Vite turns into a hashed worker chunk in the prod build (worker.format
 * must be 'es' in vite.config — added there).
 */
import { useEffect, useRef, useCallback, useState } from 'react'

export function useConstellationSim() {
  const workerRef = useRef(null)
  const targetsRef = useRef(null)   // Float32Array [x0,y0,x1,y1,...] (hubs then bodies)
  const countRef = useRef(0)        // total node count (hubs + bodies)
  const runningRef = useRef(false)  // true while the sim is warm (needs frames)
  const onWakeRef = useRef(null)    // engine sets this to invalidate() on new positions
  const onSettleRef = useRef(null)  // engine sets this for a final settled invalidate()
  // bumps each time a fresh worker is created. The engine includes this in its
  // init-effect deps so it re-inits the (rebuilt) worker after a StrictMode
  // double-mount — otherwise a stale `lastSig` would downgrade the re-init to a
  // resize() against an unbuilt worker and the sim would never run.
  const [workerId, setWorkerId] = useState(0)

  // boot the worker (re-runs under StrictMode: terminate → recreate)
  useEffect(() => {
    const worker = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const msg = e.data
      // a worker-side throw is surfaced here so it isn't swallowed silently
      if (msg && msg.type === 'error') { console.error('[constellation worker]', msg.message, msg.stack) ; return }
      if (!msg || msg.type !== 'positions') return
      const arr = new Float32Array(msg.buffer)
      targetsRef.current = arr
      countRef.current = arr.length / 2
      if (msg.settled) {
        runningRef.current = false
        if (onSettleRef.current) onSettleRef.current()
      } else {
        runningRef.current = true
        if (onWakeRef.current) onWakeRef.current()
      }
    }
    workerRef.current = worker
    setWorkerId((n) => n + 1)
    return () => {
      try { worker.terminate() } catch { /* noop */ }
      workerRef.current = null
    }
  }, [])

  /* (re)build the simulation. `payload` is data-agnostic:
       { nodes:[{id,hubKey,r,seed,seed2}], links:[{source,target}],
         hubs:[{id,key,isHub}], anchors:{[key]:{x,y}}, w, h, settle } */
  const init = useCallback((payload) => {
    if (!workerRef.current) return
    runningRef.current = true
    workerRef.current.postMessage({ type: 'init', ...payload })
  }, [])

  const resize = useCallback((w, h, anchors) => {
    if (!workerRef.current) return
    runningRef.current = true
    workerRef.current.postMessage({ type: 'resize', w, h, anchors })
  }, [])

  const reheat = useCallback((alpha = 0.5) => {
    if (!workerRef.current) return
    runningRef.current = true
    workerRef.current.postMessage({ type: 'reheat', alpha })
  }, [])

  const setHidden = useCallback((hidden) => {
    if (!workerRef.current) return
    workerRef.current.postMessage({ type: hidden ? 'pause' : 'resume' })
  }, [])

  return { targetsRef, countRef, runningRef, onWakeRef, onSettleRef, workerId, init, resize, reheat, setHidden }
}
