/**
 * Your wallpapers — a SET of user-supplied backdrops, not just one.
 *
 * The existing custom-background path (storeCustomBg in lite-backdrops.js)
 * holds exactly one image in localStorage as base64. That is the right shape
 * for "set my photo" and the wrong shape for "build me a themed section": a
 * 1600px JPEG is ~400KB, base64 inflates it by a third, and localStorage caps
 * out around 5MB — three or four wallpapers and the next write throws.
 *
 * So this uses IndexedDB and stores Blobs directly: no base64 inflation, tens
 * of MB of headroom, and object URLs the CSS can point at. Enough for a real
 * set of wallpapers.
 *
 * Everything here is the USER'S OWN content, held on the user's own device. It
 * is never uploaded, never bundled into the app, and never shipped to anyone
 * else — which is exactly what makes it the right home for artwork we have no
 * licence to redistribute ourselves.
 */

const DB_NAME = 'spectre-lite-wallpapers'
const STORE = 'bg'
const DB_VERSION = 1

/** id -> object URL, for the synchronous CSS resolvers. */
const URLS = new Map()
const listeners = new Set()

/**
 * The last loaded set. Subscribers read THIS rather than calling
 * loadWallpapers() again: a read that re-triggers the change event it is
 * reacting to is an infinite loop (a listener re-loads, the load emits, the
 * listener re-loads...). It ran ~1800 rounds/second, re-rendering the whole
 * LITE tree and pinning a CPU core, and it was invisible: the loop is async
 * through IndexedDB so React never warns, and with an empty set the rendered
 * output never changes so the DOM never mutates.
 */
let ITEMS = []

/** The set as of the last load. Synchronous, for change subscribers. */
export function getWallpapers() { return ITEMS }

function emit() { listeners.forEach((fn) => { try { fn() } catch { /* consumer fault */ } }) }

/** Subscribe to wallpaper-set changes. Returns an unsubscribe. */
export function onWallpapersChanged(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The live object URL for a stored wallpaper, or null before load completes. */
export function wallpaperUrl(id) { return URLS.get(id) || null }

/** The CSS a backdrop layer wants for one. */
export function wallpaperCss(id) {
  const u = wallpaperUrl(id)
  return u ? `url('${u}') center/cover no-repeat #0a0a0e` : null
}

function openDb() {
  return new Promise((resolve, reject) => {
    let req
    try { req = indexedDB.open(DB_NAME, DB_VERSION) } catch (e) { reject(e); return }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('indexeddb open failed'))
  })
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

/** Read every stored wallpaper and (re)build the id -> object URL map. */
export async function loadWallpapers() {
  let db
  try { db = await openDb() } catch { return [] }
  const rows = await new Promise((resolve) => {
    const req = tx(db, 'readonly').getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => resolve([])
  })
  // Revoking first keeps a long session from leaking a URL per reload.
  URLS.forEach((u) => { try { URL.revokeObjectURL(u) } catch { /* already gone */ } })
  URLS.clear()
  const items = rows
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map((r) => {
      let url = null
      try { url = URL.createObjectURL(r.blob) } catch { /* blob lost */ }
      if (url) URLS.set(r.id, url)
      return { id: r.id, name: r.name, url }
    })
    .filter((r) => r.url)
  ITEMS = items
  return items
}

/**
 * Store one image. Downscaled to a sane ceiling first — a 4K JPEG is ~4MB and
 * a backdrop never needs more than a 2560px longest edge, so this keeps a set
 * of a dozen comfortably inside IndexedDB without touching visible quality.
 */
export async function addWallpaper(file, name) {
  if (!file) throw new Error('No file selected')
  if (file.type && !/^image\//.test(file.type)) throw new Error('That file is not an image')

  const blob = await downscale(file).catch(() => file)
  const id = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').put({
      id,
      name: (name || file.name || 'Wallpaper').replace(/\.[a-z0-9]+$/i, '').slice(0, 28),
      blob,
      ts: Date.now(),
    })
    req.onsuccess = resolve
    req.onerror = () => reject(req.error || new Error('could not save'))
  })
  await loadWallpapers()
  emit()
  return id
}

export async function removeWallpaper(id) {
  const db = await openDb()
  await new Promise((resolve) => {
    const req = tx(db, 'readwrite').delete(id)
    req.onsuccess = resolve
    req.onerror = resolve
  })
  const u = URLS.get(id)
  if (u) { try { URL.revokeObjectURL(u) } catch { /* already gone */ } URLS.delete(id) }
  await loadWallpapers()
  emit()
}

const MAX_EDGE = 2560
const QUALITY = 0.86

function downscale(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode failed'))
      img.onload = () => {
        const longest = Math.max(img.width, img.height) || 1
        // Already small enough: keep the original bytes rather than re-encoding
        // a JPEG through canvas and losing a generation for nothing.
        if (longest <= MAX_EDGE) { resolve(file); return }
        const scale = MAX_EDGE / longest
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(file); return }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((b) => resolve(b || file), 'image/jpeg', QUALITY)
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
