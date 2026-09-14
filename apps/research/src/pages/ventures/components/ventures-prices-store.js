/**
 * ventures-prices-store - shared /v1/prices fetch layer for the Ventures page.
 *
 * Both useVenturesPrices (full price map, polled) and vc-intel-hub's logo
 * lookup hit /data-api/v1/prices with overlapping symbol sets. Before this,
 * each kept its own cache and fired its own chunked fetches, so a symbol like
 * ETH that appears in both the project list AND a VC's portfolio was fetched
 * twice on first paint.
 *
 * This store dedupes at the per-symbol level: every caller asks for the raw
 * rows it needs, and any symbol already fetched (and still fresh) is served
 * from cache. Only the genuinely-missing symbols go out, chunked 75-per-call,
 * in parallel. A sessionStorage layer survives hard reloads (not new tabs).
 *
 * Returns RAW Spectre rows keyed by uppercased symbol. Callers map the rows
 * to whatever shape they need (full market data vs just .image logo).
 */
const ENDPOINT = '/data-api/v1/prices'
const CHUNK_SIZE = 75
const TTL = 60_000 // rows are price data - keep them fresh-ish
const SS_KEY = 'ventures-prices-rows-v1'
const SS_TTL = 6 * 60 * 60 * 1000

// { [SYM]: { row, ts } } - raw row + fetch timestamp, per symbol
const _rows = {}
// { [SYM]: Promise } - inflight dedup so concurrent callers share one request
const _inflight = {}

let _ssHydrated = false

function _hydrateFromSession() {
  if (_ssHydrated) return
  _ssHydrated = true
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.rows) return
    if (!parsed.ts || Date.now() - parsed.ts > SS_TTL) return
    for (const [sym, row] of Object.entries(parsed.rows)) {
      // Seed with the snapshot timestamp so seeded rows still expire on TTL.
      if (row) _rows[sym] = { row, ts: parsed.ts }
    }
  } catch {
    // Corrupt/unavailable storage - start cold.
  }
}

function _persistToSession() {
  try {
    const rows = {}
    for (const [sym, entry] of Object.entries(_rows)) {
      if (entry?.row) rows[sym] = entry.row
    }
    sessionStorage.setItem(SS_KEY, JSON.stringify({ ts: Date.now(), rows }))
  } catch {
    // Quota/private-mode - non-fatal, memory cache still works.
  }
}

async function _fetchChunk(symbols) {
  try {
    const url = `${ENDPOINT}?symbols=${encodeURIComponent(symbols.join(','))}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return {}
    const json = await res.json()
    return json?.data || json || {}
  } catch {
    return {}
  }
}

/**
 * Fetch raw rows for the given symbols, deduped per-symbol against the cache
 * and inflight requests. Returns { [SYM]: row } covering whatever resolved
 * (cached + freshly fetched). Never throws; missing symbols are simply absent.
 */
export async function getPriceRows(symbols) {
  _hydrateFromSession()
  const wanted = [...new Set((symbols || []).map((s) => String(s).toUpperCase()).filter(Boolean))]
  if (wanted.length === 0) return {}

  const now = Date.now()
  const out = {}
  const missing = []
  const awaiting = []

  for (const sym of wanted) {
    const entry = _rows[sym]
    if (entry && now - entry.ts <= TTL) {
      out[sym] = entry.row
    } else if (_inflight[sym]) {
      awaiting.push(sym) // someone else is already fetching this symbol
    } else {
      missing.push(sym)
    }
  }

  // Fire chunked fetches for the genuinely-missing symbols. Register a shared
  // inflight promise per symbol so concurrent callers reuse it.
  const chunks = []
  for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
    chunks.push(missing.slice(i, i + CHUNK_SIZE))
  }

  const chunkPromises = chunks.map((chunk) => {
    const p = _fetchChunk(chunk).then((payload) => {
      const ts = Date.now()
      for (const [sym, row] of Object.entries(payload)) {
        const upper = String(sym).toUpperCase()
        if (row) _rows[upper] = { row, ts }
      }
      return payload
    })
    // Register this promise as inflight for each symbol in the chunk so a
    // concurrent caller asking for the same symbol piggybacks instead of
    // re-fetching. Cleared once the whole batch settles (below).
    for (const sym of chunk) _inflight[sym] = p
    return p
  })

  // Wait for our own chunk fetches plus any in-progress fetches we piggyback on.
  const awaitingPromises = awaiting.map((sym) => _inflight[sym]).filter(Boolean)

  await Promise.allSettled([...chunkPromises, ...awaitingPromises])

  // Clear inflight markers we registered and persist the merged cache once.
  for (const chunk of chunks) {
    for (const sym of chunk) delete _inflight[sym]
  }
  if (chunks.length > 0) _persistToSession()

  // Assemble the final result from the now-populated cache.
  const final = { ...out }
  for (const sym of wanted) {
    if (final[sym] != null) continue
    const entry = _rows[sym]
    if (entry) final[sym] = entry.row
  }
  return final
}
