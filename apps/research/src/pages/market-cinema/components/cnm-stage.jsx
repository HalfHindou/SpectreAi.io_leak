import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { createScene } from './cnm-scene'

/**
 * cnm-stage — the canvas host. It owns the scene's lifetime and the first two
 * beats of the entry choreography; everything else about the stage lives in
 * cnm-scene.js, which never imports React.
 *
 * This component is NEVER mounted under prefers-reduced-motion. The reduced
 * path is cnm-static.jsx, and it is a first-class reading of the same events,
 * not a fallback.
 */
const CnmStage = forwardRef(function CnmStage({ tape, intensity, paused, onLane, onStats }, ref) {
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)
  const cbRef = useRef(null)
  cbRef.current = { onLane, onStats }

  useEffect(() => {
    const scene = createScene(canvasRef.current, {
      onLane: (l) => cbRef.current?.onLane?.(l),
      onStats: (s) => cbRef.current?.onStats?.(s),
    })
    sceneRef.current = scene
    if (!scene) return undefined

    // Entry beats 1 and 2: 0–0.8s black (a beat of emptiness), then 0.8–2.0s
    // the tape draws itself left to right, once. This is the only true reveal
    // in the product and it is spent here.
    let raf = 0
    const t0 = performance.now()
    const step = (now) => {
      const x = (now - t0 - 800) / 1200
      if (x >= 1) { scene.setReveal(1); return }
      scene.setReveal(x <= 0 ? 0 : 1 - (1 - x) ** 2)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      scene.destroy()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => { sceneRef.current?.setTape(tape) }, [tape])
  useEffect(() => { sceneRef.current?.setIntensity(intensity) }, [intensity])
  useEffect(() => { sceneRef.current?.setPaused(paused) }, [paused])

  useImperativeHandle(ref, () => ({
    spawn(events) { sceneRef.current?.spawn(events) },
  }), [])

  return <canvas ref={canvasRef} className="cnm-canvas" aria-hidden="true" />
})

export default CnmStage
