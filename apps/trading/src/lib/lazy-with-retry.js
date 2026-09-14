import { lazy } from 'react'
import { isChunkLoadError, triggerChunkRecovery } from './chunk-recovery'

/**
 * React.lazy wrapper with stale-deploy recovery.
 *
 *   1. First attempt — normal dynamic import.
 *   2. Retry the same URL once after 250ms (handles Vite dev re-optimize
 *      and tiny CDN blips).
 *   3. If both attempts fail with a chunk-load error, fall through to the
 *      shared chunk-recovery layer which purges PWA caches + reloads once.
 *
 * Without step 3, an Error Boundary catches the failed lazy before any
 * window-level handler can run, leaving the user staring at "Something went
 * wrong" until they hard-refresh.
 */
export default function lazyWithRetry(factory) {
  return lazy(() =>
    factory().catch((err) => {
      if (!isChunkLoadError(err)) throw err
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          factory().then(resolve, (err2) => {
            if (!isChunkLoadError(err2)) return reject(err2)
            triggerChunkRecovery(err2).then(resolve, reject)
          })
        }, 250)
      })
    })
  )
}
