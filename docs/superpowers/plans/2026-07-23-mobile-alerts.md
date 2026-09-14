# Mobile Alerts (in-app + Web Push) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make trading-app price alerts fully work on mobile: create alerts from the mobile token page, never lose trigger events (KV-persisted), show triggered history in the Alerts tab, and deliver Web Push notifications when the app is closed.

**Architecture:** Stage 1 fixes the in-app loop: a new `MobileAlertSheet` (bottom sheet) reuses the existing `createAlert` flow; `api/webhook.js` persists trigger events to Upstash KV per user; `api/alerts.js` GET returns them; `useAlerts` drops its fragile "INACTIVE + created<10min" heuristic. Stage 2 adds a push-only service worker (NO caching), `/api/push` subscription CRUD, and `web-push` sending from the webhook receiver.

**Tech Stack:** React 18 + plain CSS (trading app conventions: relative imports, lucide-react, `body.theme-light` day mode), Vercel serverless + Upstash KV, Codex webhooks, `web-push` (VAPID).

**Spec:** `docs/superpowers/specs/2026-07-23-mobile-alerts-design.md`

## Global Constraints

- No TypeScript in app code (`.jsx`/`.js` only). Plain CSS paired with the component.
- Trading app: relative imports (no `@/` alias), icons from `lucide-react`, mobile component CSS prefixes are short and unique (`mas-` for the alert sheet).
- Day mode selector in trading is `body.theme-light ...` — NEVER `.app.app-day-mode`.
- No emojis anywhere. Single dash in comments.
- **Do NOT run `git commit` or `git push`** — the user approves every git operation manually (standing project rule). Checkpoints = green build instead of commits.
- No test infrastructure exists in this repo. Verification = `npm run build:trading` (check-critical-path must stay green) + curl + browser checks.
- Service worker must have NO fetch handler and NO caching logic (the research app's SW bundle-caching bug class is forbidden here).
- Every new/changed `/api` behavior needs a dev-parity note: dev Express proxies `/api` to `packages/server/index.js`.
- Codex calls the PROD webhook callback only — the trigger path (webhook → KV → push) can only be fully verified on Vercel preview/prod.

## File Map

| File | Action | Task |
|---|---|---|
| `apps/trading/src/components/mobile/MobileAlertSheet.jsx` (+`.css`) | Create | 1 |
| `apps/trading/src/components/mobile/MobilePriceHero.jsx` | Modify (bell button) | 1 |
| `apps/trading/src/components/mobile/MobileTokenPage.jsx` | Modify (accept alert props, mount sheet) | 1 |
| `apps/trading/api/webhook.js` | Modify (KV persist; later push send) | 2, 7 |
| `apps/trading/api/alerts.js` | Modify (GET `triggered`, DELETE `triggeredId`, richer meta) | 2 |
| `packages/server/index.js` (~line 20759) | Modify (dev parity: `triggered: []`, `/api/push` stub) | 2, 6 |
| `apps/trading/src/hooks/useAlerts.js` | Modify (consume server `triggered`) | 3 |
| `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` (+`.css`) | Modify (two sections, push toggle) | 4, 8 |
| `apps/trading/src/components/mobile/home/MobileHomeShell.jsx` | Modify (pass `triggered`, badge watermark) | 4 |
| `apps/trading/src/App.jsx` | Modify (thread new props) | 4 |
| `apps/trading/public/manifest.json` + icons | Create | 5 |
| `apps/trading/index.html` | Modify (manifest link) | 5 |
| `apps/trading/public/sw.js` | Create | 5 |
| `apps/trading/src/services/pushService.js` | Create | 6 |
| `apps/trading/api/push.js` | Create | 6 |
| `apps/trading/package.json` | Modify (add `web-push`) | 7 |

---

## STAGE 1 — reliable in-app

### Task 1: MobileAlertSheet + bell on the mobile token page

**Files:**
- Create: `apps/trading/src/components/mobile/MobileAlertSheet.jsx`
- Create: `apps/trading/src/components/mobile/MobileAlertSheet.css`
- Modify: `apps/trading/src/components/mobile/MobilePriceHero.jsx` (props + bell button in `.mph-row1` identity row, after the heart button)
- Modify: `apps/trading/src/components/mobile/MobileTokenPage.jsx` (accept `alerts`, `createAlert`, `deleteAlert` props — App.jsx ALREADY passes them at line ~1495; mount the sheet)

**Interfaces:**
- Consumes: `createAlert({ tokenAddress, networkId, priceTarget, direction, name, meta })` and `deleteAlert(id)` from `useAlerts` (already threaded through App.jsx); `useTokenAlerts(alerts, address, networkId)` from `../../hooks/useAlerts`; `useSharedTokenDetails()` from `../../contexts/TokenDetailsContext` (MobileTokenPage renders inside `TokenDetailsProvider`).
- Produces: `<MobileAlertSheet open onClose token alerts createAlert deleteAlert />`; `MobilePriceHero` gains props `alertCount` (number) and `onOpenAlerts` (fn).

- [ ] **Step 1: Create `MobileAlertSheet.jsx`**

Port the semantics of `AlertButton.jsx` (price OR mcap mode with K/M/B suffixes, above/below, active-alert list) into a bottom sheet styled like the other `Mobile*Sheet` components:

```jsx
/**
 * MobileAlertSheet - bottom-sheet price/mcap alert creation (prefix mas-).
 *
 * Same semantics as the desktop AlertButton: target by price or market cap
 * (K/M/B suffixes, converted to price via circulating supply), above/below,
 * plus the token's active alerts with delete. Uses the shared createAlert /
 * deleteAlert from useAlerts (threaded from App.jsx).
 */
import React, { useState, useCallback, useEffect } from 'react'
import { X, ArrowUp, ArrowDown } from 'lucide-react'
import { useTokenAlerts } from '../../hooks/useAlerts'
import { useSharedTokenDetails } from '../../contexts/TokenDetailsContext'
import { formatPrice, formatLargeNumber } from '../../services/codexApi'
import './MobileAlertSheet.css'

export default function MobileAlertSheet({ open, onClose, token, alerts, createAlert, deleteAlert }) {
  const [direction, setDirection] = useState('above')
  const [mode, setMode] = useState('price') // 'price' | 'mcap'
  const [inputValue, setInputValue] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(false)

  const tokenAlerts = useTokenAlerts(alerts, token?.address, token?.networkId)

  let liveData = null
  try { liveData = useSharedTokenDetails()?.tokenData } catch { /* outside provider */ }
  const currentPrice = parseFloat(liveData?.price || token?.price) || 0
  const circulatingSupply = parseFloat(liveData?.circulatingSupply || token?.circulatingSupply) || 0
  const currentMcap = parseFloat(liveData?.marketCap) || (currentPrice * circulatingSupply)

  useEffect(() => {
    if (open) { setInputValue(''); setError(null); setCreated(false) }
  }, [open, mode])

  const resolveTargetPrice = useCallback(() => {
    if (mode === 'price') return parseFloat(inputValue) || 0
    let raw = inputValue.trim().toUpperCase()
    let multiplier = 1
    if (raw.endsWith('B')) { multiplier = 1e9; raw = raw.slice(0, -1) }
    else if (raw.endsWith('M')) { multiplier = 1e6; raw = raw.slice(0, -1) }
    else if (raw.endsWith('K')) { multiplier = 1e3; raw = raw.slice(0, -1) }
    const mcapTarget = parseFloat(raw) * multiplier
    if (!mcapTarget || circulatingSupply <= 0) return 0
    return mcapTarget / circulatingSupply
  }, [inputValue, mode, circulatingSupply])

  const handleCreate = useCallback(async () => {
    const targetPrice = resolveTargetPrice()
    if (!targetPrice || !token?.address) return
    setCreating(true)
    setError(null)
    try {
      const label = mode === 'mcap'
        ? `${token.symbol} MCap ${direction} ${inputValue}`
        : `${token.symbol} ${direction} $${inputValue}`
      await createAlert({
        tokenAddress: token.address,
        networkId: token.networkId || 1,
        priceTarget: targetPrice,
        direction,
        name: label,
        meta: {
          symbol: token.symbol,
          logo: token.logo,
          mode,
          displayValue: inputValue,
          currentPrice,
          currentMcap,
          tokenAddress: token.address,
          networkId: token.networkId || 1,
        },
      })
      setCreated(true)
      setInputValue('')
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }, [resolveTargetPrice, token, direction, mode, inputValue, createAlert, currentPrice, currentMcap])

  if (!open) return null

  const currentDisplay = mode === 'price'
    ? formatPrice(currentPrice)
    : (currentMcap > 0 ? formatLargeNumber(currentMcap) : '-')

  return (
    <div className="mas-backdrop" onClick={onClose}>
      <div className="mas-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mas-head">
          <span className="mas-title">Price Alert</span>
          <span className="mas-current">Current: {currentDisplay}</span>
          <button type="button" className="mas-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mas-toggle">
          <button type="button" className={`mas-toggle-btn${mode === 'price' ? ' active' : ''}`} onClick={() => setMode('price')}>Price</button>
          <button type="button" className={`mas-toggle-btn${mode === 'mcap' ? ' active' : ''}`} onClick={() => setMode('mcap')}>MCap</button>
        </div>

        <div className="mas-toggle">
          <button type="button" className={`mas-toggle-btn${direction === 'above' ? ' active' : ''}`} onClick={() => setDirection('above')}>
            <ArrowUp size={13} strokeWidth={2.5} /> Above
          </button>
          <button type="button" className={`mas-toggle-btn${direction === 'below' ? ' active' : ''}`} onClick={() => setDirection('below')}>
            <ArrowDown size={13} strokeWidth={2.5} /> Below
          </button>
        </div>

        <div className="mas-input-wrap">
          <span className="mas-input-prefix">{mode === 'price' ? '$' : 'MC'}</span>
          <input
            className="mas-input"
            type="text"
            inputMode="decimal"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={mode === 'price' ? 'Target price' : 'e.g. 5M, 100K'}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>

        {mode === 'mcap' && resolveTargetPrice() > 0 && (
          <div className="mas-hint">= {formatPrice(resolveTargetPrice())} per token</div>
        )}

        {error && <div className="mas-error">{error}</div>}
        {created && <div className="mas-created">Alert set - it will land in the Alerts tab when it triggers.</div>}

        <button type="button" className="mas-create" onClick={handleCreate} disabled={creating || !inputValue}>
          {creating ? 'Creating...' : 'Set Alert'}
        </button>

        {tokenAlerts.length > 0 && (
          <div className="mas-active">
            <span className="mas-active-label">Active alerts</span>
            {tokenAlerts.map(a => (
              <div key={a.id} className="mas-active-row">
                <span className="mas-active-cond">
                  {a.direction === 'above' ? '↑' : '↓'} {formatPrice(a.priceTarget)}
                </span>
                <button type="button" className="mas-active-del" onClick={() => deleteAlert(a.id)} aria-label="Remove alert">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `MobileAlertSheet.css`**

Follow the existing bottom-sheet look (glass surface, safe-area padding). Include `body.theme-light` overrides:

```css
/* MobileAlertSheet - bottom sheet, prefix mas- */
.mas-backdrop {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: flex-end;
}
.mas-sheet {
  width: 100%;
  background: var(--bg-elevated, #18181b);
  border-radius: 16px 16px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  display: flex; flex-direction: column; gap: 10px;
  animation: masUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes masUp { from { transform: translateY(24px); opacity: 0 } to { transform: none; opacity: 1 } }

.mas-head { display: flex; align-items: center; gap: 10px; }
.mas-title { font-size: 15px; font-weight: 650; color: var(--text-primary, #f5f5f7); }
.mas-current { margin-left: auto; font-size: 12px; color: rgba(245, 245, 247, 0.5); }
.mas-close { background: none; border: none; color: rgba(245, 245, 247, 0.6); padding: 4px; display: flex; }

.mas-toggle { display: flex; gap: 6px; }
.mas-toggle-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
  padding: 9px 0; border-radius: 10px; font-size: 13px; font-weight: 550;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.05);
  color: rgba(245, 245, 247, 0.6);
}
.mas-toggle-btn.active {
  background: rgba(255, 255, 255, 0.1);
  color: #f5f5f7;
  border-color: rgba(255, 255, 255, 0.12);
}

.mas-input-wrap {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px; padding: 0 12px;
}
.mas-input-prefix { font-size: 13px; color: rgba(245, 245, 247, 0.45); }
.mas-input {
  flex: 1; background: none; border: none; outline: none;
  color: #f5f5f7; font-size: 16px; padding: 12px 0;
}
.mas-hint { font-size: 12px; color: rgba(245, 245, 247, 0.5); }
.mas-error { font-size: 12px; color: var(--bear, #EF4444); }
.mas-created { font-size: 12px; color: var(--bull, #10B981); }

.mas-create {
  padding: 13px 0; border-radius: 12px; border: none;
  background: #f5f5f7; color: #09090b; font-size: 14px; font-weight: 650;
}
.mas-create:disabled { opacity: 0.45; }

.mas-active { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.mas-active-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(245, 245, 247, 0.4); }
.mas-active-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}
.mas-active-cond { font-size: 13px; color: #f5f5f7; }
.mas-active-del { background: none; border: none; color: rgba(245, 245, 247, 0.45); padding: 4px; display: flex; }

/* Day mode (trading = body.theme-light, NOT .app-day-mode) */
body.theme-light .mas-sheet { background: #ffffff; border-top-color: rgba(0, 0, 0, 0.06); }
body.theme-light .mas-title { color: #0f172a; }
body.theme-light .mas-current, body.theme-light .mas-hint { color: #64748b; }
body.theme-light .mas-close, body.theme-light .mas-active-del { color: #64748b; }
body.theme-light .mas-toggle-btn { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.06); color: #475569; }
body.theme-light .mas-toggle-btn.active { background: rgba(0, 0, 0, 0.08); color: #0f172a; border-color: rgba(0, 0, 0, 0.12); }
body.theme-light .mas-input-wrap { background: rgba(0, 0, 0, 0.03); border-color: rgba(0, 0, 0, 0.08); }
body.theme-light .mas-input { color: #0f172a; }
body.theme-light .mas-active-row { background: rgba(0, 0, 0, 0.03); }
body.theme-light .mas-active-cond { color: #0f172a; }
body.theme-light .mas-active-label { color: #94a3b8; }
body.theme-light .mas-create { background: #0f172a; color: #ffffff; }
```

- [ ] **Step 3: Add the bell to `MobilePriceHero.jsx`**

Add props `alertCount = 0` and `onOpenAlerts` to the signature. Import `Bell` from `lucide-react` (file may need the import added). Render right AFTER the `.mph-heart` button inside `.mph-nameline`:

```jsx
{onOpenAlerts && (
  <button
    type="button"
    className={`mph-bell${alertCount > 0 ? ' has-alerts' : ''}`}
    onClick={onOpenAlerts}
    aria-label="Price alerts"
  >
    <Bell size={15} strokeWidth={2} />
    {alertCount > 0 && <span className="mph-bell-badge">{alertCount}</span>}
  </button>
)}
```

Add to `MobilePriceHero.css` (match the `.mph-heart` sizing — read its rule and mirror padding/color, plus):

```css
.mph-bell { position: relative; background: none; border: none; color: rgba(245, 245, 247, 0.55); padding: 4px; display: flex; }
.mph-bell.has-alerts { color: #f5f5f7; }
.mph-bell-badge {
  position: absolute; top: -3px; right: -4px;
  min-width: 13px; height: 13px; border-radius: 7px;
  background: #f5f5f7; color: #09090b;
  font-size: 9px; font-weight: 700; line-height: 13px; text-align: center; padding: 0 3px;
}
body.theme-light .mph-bell { color: #64748b; }
body.theme-light .mph-bell.has-alerts { color: #0f172a; }
body.theme-light .mph-bell-badge { background: #0f172a; color: #ffffff; }
```

- [ ] **Step 4: Wire it in `MobileTokenPage.jsx`**

Add to the destructured props: `alerts, createAlert, deleteAlert` (App.jsx already passes them). Add state + count and mount the sheet:

```jsx
import MobileAlertSheet from './MobileAlertSheet'
import { useTokenAlerts } from '../../hooks/useAlerts'
// ...
const [alertOpen, setAlertOpen] = useState(false)
const tokenAlertCount = useTokenAlerts(alerts, token?.address, token?.networkId).length
```

Include `alertOpen` in `overlaysOpen` (`const overlaysOpen = drawerOpen || swapOpen || agentOpen || alertOpen`). Pass to the hero: `<MobilePriceHero ... alertCount={tokenAlertCount} onOpenAlerts={() => setAlertOpen(true)} />`. Mount next to the other sheets:

```jsx
<MobileAlertSheet
  open={alertOpen}
  onClose={() => setAlertOpen(false)}
  token={token}
  alerts={alerts}
  createAlert={createAlert}
  deleteAlert={deleteAlert}
/>
```

- [ ] **Step 5: Build + browser check**

Run: `npm run build:trading` — expect green incl. `[check-critical-path]`.
Browser (mobile viewport or device): open a token page → bell visible in hero → sheet opens → signed-out create shows the sign-in error; signed-in create adds to the sheet's active list and the Alerts tab.

### Task 2: Persist triggers server-side (webhook.js + alerts.js + dev parity)

**Files:**
- Modify: `apps/trading/api/webhook.js`
- Modify: `apps/trading/api/alerts.js`
- Modify: `packages/server/index.js` `/api/alerts` route (~line 20759)

**Interfaces:**
- Produces (KV): list `alerts:triggered:{userId}` of JSON records `{ id, webhookId, tokenAddress, networkId, priceUsd, priceTarget, direction, name, triggeredAt }` (`id` = `t_{webhookId}_{triggeredAt}`), LTRIM-capped to 50, newest first (LPUSH).
- Produces (API): GET `/api/alerts` → `{ alerts: [...], triggered: [...] }`; DELETE `/api/alerts?triggeredId=...` → `{ ok: true }`.
- Consumes: existing KV keys `alerts:meta:{webhookId}` (gains `priceTarget`, `direction`, `name` fields at creation).

- [ ] **Step 1: Enrich ownership meta in `alerts.js`**

In the POST case, extend the `recordAlertOwnership` call so the webhook receiver can build a display-ready trigger record without client localStorage:

```js
await recordAlertOwnership(userId, alert.id, {
  tokenAddress: alert.tokenAddress,
  networkId: alert.networkId,
  priceTarget: alert.priceTarget,
  direction: alert.direction,
  name: alert.name,
})
```

- [ ] **Step 2: Persist triggers in `webhook.js`**

Add a KV helper (same lazy pattern as `alerts.js`) at module level:

```js
let _kvPromise = null
async function getKv() {
  if (_kvPromise) return _kvPromise
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (!url || !token) { _kvPromise = Promise.resolve(null); return _kvPromise }
  _kvPromise = import('@upstash/redis').then(m => new m.Redis({ url, token })).catch(() => null)
  return _kvPromise
}

async function persistTrigger(webhookId, data) {
  const kv = await getKv()
  if (!kv) return null
  try {
    const raw = await kv.get(`alerts:meta:${webhookId}`)
    const meta = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
    if (!meta?.userId) return null
    const record = {
      id: `t_${webhookId}_${Date.now()}`,
      webhookId,
      tokenAddress: data.address || meta.tokenAddress || '',
      networkId: data.networkId || meta.networkId || 0,
      priceUsd: parseFloat(data.priceUsd) || 0,
      priceTarget: meta.priceTarget || 0,
      direction: meta.direction || 'above',
      name: meta.name || 'Price alert',
      triggeredAt: Date.now(),
    }
    const key = `alerts:triggered:${meta.userId}`
    await kv.lpush(key, JSON.stringify(record))
    await kv.ltrim(key, 0, 49)
    return { record, userId: meta.userId }
  } catch (err) {
    console.warn('[webhook] persistTrigger failed:', err?.message)
    return null
  }
}
```

In `handlePriceAlert`, the handler is sync today — make the flow async: change the `case 'TOKEN_PRICE_EVENT':` branch to `result = handlePriceAlert(body); await persistTrigger(body.webhookId, body.data || {})`. (Keep the existing in-memory/SSE broadcast as-is; KV is the durable path.) Codex requires a response within 3s — the two KV ops fit; do NOT add retries here.

- [ ] **Step 3: Return + delete triggers in `alerts.js`**

Add helpers next to the ownership helpers:

```js
async function listTriggeredForUser(userId) {
  const kv = await getKv()
  if (!kv) return []
  try {
    const rows = await kv.lrange(`alerts:triggered:${userId}`, 0, 49)
    return (rows || []).map(r => { try { return typeof r === 'string' ? JSON.parse(r) : r } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

async function removeTriggered(userId, triggeredId) {
  const kv = await getKv()
  if (!kv) return
  try {
    const key = `alerts:triggered:${userId}`
    const rows = await kv.lrange(key, 0, 49)
    const keep = (rows || []).filter(r => {
      try { const p = typeof r === 'string' ? JSON.parse(r) : r; return p?.id !== triggeredId } catch { return false }
    })
    await kv.del(key)
    if (keep.length) await kv.rpush(key, ...keep.map(r => (typeof r === 'string' ? r : JSON.stringify(r))))
  } catch (err) {
    console.warn('[alerts] removeTriggered failed:', err?.message)
  }
}
```

GET case becomes:

```js
case 'GET': {
  try {
    const [alerts, triggered] = await Promise.all([
      listAlertsForUser(userId),
      listTriggeredForUser(userId),
    ])
    return res.json({ alerts, triggered })
  } catch (err) {
    console.error('[alerts] list failed:', err.message)
    return res.json({ alerts: [], triggered: [], fallback: true })
  }
}
```

DELETE case gains a branch BEFORE the webhook delete:

```js
case 'DELETE': {
  const { id, triggeredId } = req.query
  if (triggeredId) {
    await removeTriggered(userId, triggeredId)
    return res.json({ ok: true })
  }
  if (!id) return res.status(400).json({ error: 'id required' })
  const result = await deleteAlert(id, userId)
  return res.json(result)
}
```

- [ ] **Step 4: Dev parity in `packages/server/index.js`**

In the `/api/alerts` route (~line 20759): add `triggered: []` to both success and degraded GET responses (`return res.json({ alerts, triggered: [] })` and `res.status(200).json({ alerts: [], triggered: [], degraded: true, reason: msg })`), and make DELETE with `?triggeredId=` return `res.json({ ok: true, dev: true })` without calling Codex. Dev has no per-user KV trigger store — empty list is the documented fail-safe.

- [ ] **Step 5: Verify**

Run: `npm run build:trading` — green.
Dev curl (server running): `curl -s localhost:3001/api/alerts | head` → response contains `"triggered":[]`.
Full trigger-path verification happens in Task 9 (preview/prod).

### Task 3: useAlerts consumes server `triggered`

**Files:**
- Modify: `apps/trading/src/hooks/useAlerts.js`

**Interfaces:**
- Produces (hook return): adds `triggered` (array of server records, meta-merged) and `deleteTriggered(id)`. Keeps `alerts`, `triggeredAlerts` (session toasts), `createAlert`, `deleteAlert`, `refresh`, `dismissTriggered`, `loading`.
- Consumed by: `App.jsx` (Task 4 threads `triggered` + `deleteTriggered` down).

- [ ] **Step 1: Rewrite `refresh()` detection**

Replace the "INACTIVE + created<600s" heuristic entirely. New logic inside `refresh()` after fetching:

```js
const data = await res.json()
const all = data.alerts || []
const serverTriggered = Array.isArray(data.triggered) ? data.triggered : []

// Merge display meta stored at creation time (device-local best effort)
const storedMeta = (() => { try { return JSON.parse(localStorage.getItem('spectre-alert-meta') || '{}') } catch { return {} } })()
const merged = serverTriggered.map(t => {
  const meta = storedMeta[t.webhookId] || {}
  return {
    ...t,
    symbol: meta.symbol || '',
    logo: meta.logo || '',
    mode: meta.mode || 'price',
    displayValue: meta.displayValue || '',
  }
})
setTriggered(merged)

// Toast any trigger this client hasn't shown yet
const fresh = merged.filter(t => !shownTriggeredRef.current.has(t.id))
if (fresh.length > 0) {
  for (const t of fresh) shownTriggeredRef.current.add(t.id)
  try { localStorage.setItem('spectre-alerts-shown', JSON.stringify([...shownTriggeredRef.current])) } catch {}
  setTriggeredAlerts(prev => [...fresh.map(t => ({
    type: 'price_alert',
    webhookId: t.webhookId,
    name: t.name,
    symbol: t.symbol,
    logo: t.logo,
    mode: t.mode,
    displayValue: t.displayValue,
    direction: t.direction,
    currentPrice: t.priceUsd,
    currentMcap: 0,
    tokenAddress: t.tokenAddress,
    networkId: t.networkId,
    triggeredAt: t.triggeredAt,
  })), ...prev].slice(0, 20))
}

setAlerts(all.filter(a => a.status === 'ACTIVE'))
```

Add state `const [triggered, setTriggered] = useState([])`. Note the shown-set now stores trigger `id`s (`t_...`), not webhook ids — the localStorage key `spectre-alerts-shown` keeps working (old entries just never match again).

Keep the `createAlert` "instant trigger" client-side check as-is (it covers the already-past-target case where Codex may fire slowly or not at all).

- [ ] **Step 2: Add `deleteTriggered`**

```js
const deleteTriggered = useCallback(async (id) => {
  const headers = await buildAuthHeaders()
  if (!headers) return
  try {
    await fetch(`${ALERTS_API}?triggeredId=${encodeURIComponent(id)}`, {
      method: 'DELETE', headers, signal: AbortSignal.timeout(10000),
    })
  } catch { /* best effort */ }
  setTriggered(prev => prev.filter(t => t.id !== id))
}, [buildAuthHeaders])
```

Export both in the return object: `triggered, deleteTriggered`.

- [ ] **Step 3: Poll condition fix**

The 30s poll currently runs only when `alerts.length > 0`. Change the effect condition to `if (alerts.length === 0 && triggered.length === 0) return` deps `[alerts.length, triggered.length, refresh]` — a user with only history still gets refreshes while the tab is open.

- [ ] **Step 4: Build**

Run: `npm run build:trading` — green.

### Task 4: Alerts tab shows history + unseen badge

**Files:**
- Modify: `apps/trading/src/App.jsx` (~line 1465: pass `triggered={triggered}` and `deleteTriggered={deleteTriggered}` to `MobileHomeShell`; destructure them from `useAlerts()` at ~line 663)
- Modify: `apps/trading/src/components/mobile/home/MobileHomeShell.jsx`
- Modify: `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` + `.css`

**Interfaces:**
- Consumes: `triggered` records `{ id, name, direction, priceTarget, priceUsd, tokenAddress, networkId, symbol, triggeredAt }`, `deleteTriggered(id)` from Task 3.
- Produces: `MobileAlertsScreen` new props `triggered`, `deleteTriggered`, `onSeen`; `MobileHomeShell` computes `alertsBadge` (unseen triggered count) for `MobileHomeNav`'s existing `alertsCount` prop.

- [ ] **Step 1: MobileHomeShell watermark**

Localstorage watermark `spectre-alerts-seen-ts` (ms). Compute badge + mark seen when the tab opens:

```js
const [alertsSeenTs, setAlertsSeenTs] = useState(() => {
  try { return parseInt(localStorage.getItem('spectre-alerts-seen-ts') || '0', 10) } catch { return 0 }
})
const unseenTriggered = (Array.isArray(triggered) ? triggered : []).filter(t => t.triggeredAt > alertsSeenTs).length
const markAlertsSeen = useCallback(() => {
  const now = Date.now()
  setAlertsSeenTs(now)
  try { localStorage.setItem('spectre-alerts-seen-ts', String(now)) } catch {}
}, [])
```

Pass `triggered`, `deleteTriggered`, `onSeen={markAlertsSeen}` into `MobileAlertsScreen`; change the nav prop to `alertsCount={unseenTriggered}` (badge now means "new triggers", not "active alerts" — matches the Watchlist badge semantics of "things to look at").

- [ ] **Step 2: MobileAlertsScreen two sections**

Call `onSeen?.()` in a mount effect. Render Triggered section above Active (newest events are the actionable thing). Empty state only when BOTH lists are empty. Triggered row: direction arrow, `name`, "Hit {formatPrice(priceUsd)}" + relative time, tap → `selectToken`, delete → `deleteTriggered(t.id)`:

```jsx
useEffect(() => { onSeen?.() }, [onSeen])
// ...
{trigList.length > 0 && (
  <div className="mal-section">
    <span className="mal-section-label">Triggered</span>
    {trigList.map(t => (
      <div key={t.id} className="mal-row mal-row--fired">
        <button type="button" className="mal-row-main" onClick={() => openAlertToken(t)}>
          <span className={`mal-dir ${t.direction === 'above' ? 'up' : 'down'}`}>
            {t.direction === 'above' ? <ArrowUp size={14} strokeWidth={2.5} /> : <ArrowDown size={14} strokeWidth={2.5} />}
          </span>
          <span className="mal-body">
            <span className="mal-name">{t.name || 'Price alert'}</span>
            <span className="mal-cond">Hit <b>{formatPrice(t.priceUsd)}</b> · {relTime(t.triggeredAt)}</span>
          </span>
        </button>
        <button type="button" className="mal-del" onClick={() => deleteTriggered?.(t.id)} aria-label="Dismiss">
          <Trash2 size={16} strokeWidth={2} />
        </button>
      </div>
    ))}
  </div>
)}
```

`relTime` helper (local to the file): `const relTime = (ts) => { const m = Math.max(1, Math.round((Date.now() - ts) / 60000)); if (m < 60) return \`${m}m ago\`; const h = Math.round(m / 60); if (h < 24) return \`${h}h ago\`; return \`${Math.round(h / 24)}d ago\` }`. `openAlertToken` already handles records with `tokenAddress`/`networkId`/`symbol`. Update the empty-state copy to drop "Sign in to sync them" when signed in (keep as-is otherwise — copy change optional). Add CSS: `.mal-section-label` (uppercase 11px, muted), `.mal-row--fired .mal-dir` tinted with `--bull`/`--bear` as the existing `.mal-dir.up/.down` already does — verify in the CSS file and extend only if missing. Include `body.theme-light` counterparts for any new rule.

- [ ] **Step 3: Build + browser check**

Run: `npm run build:trading` — green.
Browser: Alerts tab shows both sections (dev shows empty triggered — expected); badge logic testable by temporarily seeding `triggered` state in devtools or via preview after Task 9.

---

## STAGE 2 — Web Push

### Task 5: PWA minimum — manifest, icons, push-only service worker

**Files:**
- Create: `apps/trading/public/manifest.json`
- Copy: `apps/research/public/icon-192x192.png`, `icon-512x512.png`, `apple-touch-icon.png` → `apps/trading/public/`
- Create: `apps/trading/public/sw.js`
- Modify: `apps/trading/index.html` (add `<link rel="manifest" href="/manifest.json" />` in `<head>`; keep existing theme-color if present, else add `<meta name="theme-color" content="#09090b" />`)

**Interfaces:**
- Produces: `/manifest.json`, `/sw.js` (registered lazily by `pushService.js` in Task 6 — NOT auto-registered at boot).

- [ ] **Step 1: Copy icons**

Run: `cp apps/research/public/icon-192x192.png apps/research/public/icon-512x512.png apps/research/public/apple-touch-icon.png apps/trading/public/`

- [ ] **Step 2: `manifest.json`**

```json
{
  "name": "Spectre Trade",
  "short_name": "Spectre",
  "description": "Spectre AI trading terminal",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#09090b",
  "theme_color": "#09090b",
  "orientation": "portrait-primary",
  "categories": ["finance", "business"],
  "icons": [
    { "src": "/icon-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 3: `sw.js` — push only, NO fetch handler, NO caching**

```js
/*
 * Spectre trading - push-only service worker.
 * DELIBERATELY no fetch handler and no caching: a caching SW served stale
 * bundles on the research app once. This file must never grow a fetch
 * listener or a Cache API call.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* non-JSON push */ }
  const title = data.title || 'Spectre alert'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if ('focus' in client) {
        client.navigate(url)
        return client.focus()
      }
    }
    return self.clients.openWindow(url)
  }))
})
```

- [ ] **Step 4: Build + check**

Run: `npm run build:trading` — green; confirm `dist/manifest.json`, `dist/sw.js`, `dist/icon-192x192.png` exist (`ls apps/trading/dist | grep -E 'manifest|sw.js|icon'`).

### Task 6: Push subscription client + `/api/push`

**Files:**
- Create: `apps/trading/src/services/pushService.js`
- Create: `apps/trading/api/push.js`
- Modify: `packages/server/index.js` (dev stub route)
- Env: add `VITE_VAPID_PUBLIC_KEY` to root `.env` (Task 7 generates keys)

**Interfaces:**
- Produces (client): `isPushSupported()`, `isStandaloneIOSRequired()` (true when iOS Safari not installed to home screen), `getPushStatus()` → `'unsupported' | 'ios-needs-install' | 'default' | 'granted-subscribed' | 'granted-unsubscribed' | 'denied'`, `enablePush(getAccessToken)` → boolean, `disablePush(getAccessToken)` → boolean.
- Produces (API): POST `/api/push` body = PushSubscription JSON (Privy JWT) → `{ ok: true }`; DELETE `/api/push` body = `{ endpoint }` → `{ ok: true }`.
- Produces (KV): hash `push:subs:{userId}`, field = subscription endpoint URL, value = full subscription JSON string. Consumed by Task 7 sender.

- [ ] **Step 1: `pushService.js`**

```js
/**
 * pushService - Web Push subscription management (trading app).
 * SW registration happens HERE, lazily, only when the user enables push -
 * the app never auto-registers a service worker at boot.
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function isPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
    && !!VAPID_PUBLIC_KEY
}

// iOS Safari supports Web Push only for home-screen-installed apps (16.4+).
export function isStandaloneIOSRequired() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  return isIOS && !standalone
}

export async function getPushStatus() {
  if (!isPushSupported()) return isStandaloneIOSRequired() ? 'ios-needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'default') return 'default'
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = reg ? await reg.pushManager.getSubscription() : null
    return sub ? 'granted-subscribed' : 'granted-unsubscribed'
  } catch {
    return 'granted-unsubscribed'
  }
}

export async function enablePush(getAccessToken) {
  if (!isPushSupported()) return false
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }
  const token = await getAccessToken()
  if (!token) return false
  const res = await fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(sub.toJSON()),
    signal: AbortSignal.timeout(10000),
  })
  return res.ok
}

export async function disablePush(getAccessToken) {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (!sub) return true
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    const token = await getAccessToken()
    if (token) {
      await fetch('/api/push', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint }),
        signal: AbortSignal.timeout(10000),
      })
    }
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 2: `api/push.js`**

Mirror the auth/gate/rate-limit skeleton of `api/alerts.js`:

```js
/**
 * Vercel Serverless Function - Web Push subscription CRUD
 *
 * POST /api/push   - store the caller's PushSubscription (Privy JWT required)
 * DELETE /api/push - remove a subscription by endpoint
 *
 * KV: hash push:subs:{userId}  field = subscription endpoint, value = JSON.
 */
import { isAuthGateValid } from './auth-gate.js'
import { verifyPrivyToken } from './_lib/auth.js'
import { userRateLimit } from './_lib/ratelimit.js'

let _kvPromise = null
async function getKv() {
  if (_kvPromise) return _kvPromise
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (!url || !token) { _kvPromise = Promise.resolve(null); return _kvPromise }
  _kvPromise = import('@upstash/redis').then(m => new m.Redis({ url, token })).catch(() => null)
  return _kvPromise
}

const ALLOWED_ORIGINS = ['http://localhost:5180', 'http://localhost:5181']

export default async function handler(req, res) {
  const origin = req.headers?.origin
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (!isAuthGateValid(req)) return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' })
  const userId = await verifyPrivyToken(req)
  if (!userId) return res.status(401).json({ error: 'Privy auth required', code: 'PRIVY_REQUIRED' })
  if (await userRateLimit(res, { bucket: 'push', userId, max: 20, windowMs: 60_000 })) return

  const kv = await getKv()
  if (!kv) return res.status(503).json({ error: 'KV not configured' })

  try {
    if (req.method === 'POST') {
      const sub = req.body
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        return res.status(400).json({ error: 'Invalid subscription' })
      }
      await kv.hset(`push:subs:${userId}`, { [sub.endpoint]: JSON.stringify(sub) })
      return res.status(201).json({ ok: true })
    }
    if (req.method === 'DELETE') {
      const { endpoint } = req.body || {}
      if (!endpoint) return res.status(400).json({ error: 'endpoint required' })
      await kv.hdel(`push:subs:${userId}`, endpoint)
      return res.json({ ok: true })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[push] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
```

- [ ] **Step 3: Dev stub in `packages/server/index.js`**

Next to the `/api/alerts` route add:

```js
// Dev stub - push subscriptions are a prod/KV concern; keep the UI happy locally.
app.all('/api/push', (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end()
  res.json({ ok: true, dev: true })
})
```

- [ ] **Step 4: Build**

Run: `npm run build:trading` — green (`VITE_VAPID_PUBLIC_KEY` may be empty locally; `isPushSupported()` then returns false, which is the correct degraded state).

### Task 7: Send push from the webhook receiver

**Files:**
- Modify: `apps/trading/package.json` (dependency `"web-push": "^3.6.7"`)
- Modify: `apps/trading/api/webhook.js`
- Env (user action, documented in Step 3): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `VITE_VAPID_PUBLIC_KEY`

**Interfaces:**
- Consumes: `persistTrigger()` return `{ record, userId }` from Task 2; KV hash `push:subs:{userId}` from Task 6.
- Produces: push payload JSON `{ title, body, url, tag }` consumed by `sw.js` (Task 5).

- [ ] **Step 1: Add dependency**

Run: `npm install web-push@^3.6.7 --workspace apps/trading` (or add to `apps/trading/package.json` dependencies and `npm install` from root). Vercel bundles serverless deps from the app package.json.

- [ ] **Step 2: Send in `webhook.js`**

```js
async function sendPushForTrigger(userId, record) {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return
  const kv = await getKv()
  if (!kv) return
  let subs
  try { subs = await kv.hgetall(`push:subs:${userId}`) } catch { return }
  if (!subs || Object.keys(subs).length === 0) return

  const { default: webpush } = await import('web-push')
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@spectreai.io', pub, priv)

  const payload = JSON.stringify({
    title: record.name || 'Price alert',
    body: `Triggered at $${record.priceUsd}`,
    url: `/#token/${record.tokenAddress}`,
    tag: record.id,
  })

  await Promise.allSettled(Object.entries(subs).map(async ([endpoint, raw]) => {
    let sub
    try { sub = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return }
    try {
      await webpush.sendNotification(sub, payload, { TTL: 3600 })
    } catch (err) {
      const code = err?.statusCode
      if (code === 404 || code === 410) {
        try { await kv.hdel(`push:subs:${userId}`, endpoint) } catch { /* noop */ }
      } else {
        console.warn('[webhook] push send failed:', code, err?.message)
      }
    }
  }))
}
```

Call it after persisting, in the `TOKEN_PRICE_EVENT` branch:

```js
case 'TOKEN_PRICE_EVENT': {
  result = handlePriceAlert(body)
  const persisted = await persistTrigger(body.webhookId, body.data || {})
  if (persisted) await sendPushForTrigger(persisted.userId, persisted.record)
  break
}
```

Note the 3s Codex response requirement: sending to a handful of subscriptions fits; if send volume ever grows, move sending after `res.json()` (Vercel allows post-response work only with `waitUntil` — do NOT prematurely optimize now).

- [ ] **Step 3: Generate + set VAPID keys (USER ACTION — document, do not fake)**

Run once locally: `npx web-push generate-vapid-keys`. Then:
- Root `.env`: `VAPID_PUBLIC_KEY=...`, `VAPID_PRIVATE_KEY=...`, `VAPID_SUBJECT=mailto:info@spectreai.io`, `VITE_VAPID_PUBLIC_KEY=<same public key>`
- Vercel (trading project, Production + Preview): same four vars (`VITE_VAPID_PUBLIC_KEY` requires a redeploy to bake into the bundle).

- [ ] **Step 4: Build**

Run: `npm run build:trading` — green.

### Task 8: Permission UX — sheet prompt + Alerts-tab toggle

**Files:**
- Modify: `apps/trading/src/components/mobile/MobileAlertSheet.jsx` + `.css`
- Modify: `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` + `.css`

**Interfaces:**
- Consumes: `getPushStatus()`, `enablePush(getAccessToken)`, `disablePush(getAccessToken)`, `isStandaloneIOSRequired()` from `../../services/pushService` (`../../../services/pushService` from `home/`); `usePrivySafe` from `../../lib/use-privy-safe` for `getAccessToken`.

- [ ] **Step 1: Post-create prompt in `MobileAlertSheet`**

After a successful create (`created === true`), show one contextual block (never on open, never on page load):

```jsx
import { usePrivySafe as usePrivy } from '../../lib/use-privy-safe'
import { getPushStatus, enablePush, isStandaloneIOSRequired } from '../../services/pushService'
// ...
const { getAccessToken } = usePrivy()
const [pushStatus, setPushStatus] = useState(null)
useEffect(() => {
  if (!created) return
  let cancelled = false
  getPushStatus().then(s => { if (!cancelled) setPushStatus(s) })
  return () => { cancelled = true }
}, [created])
```

Render below `.mas-created`:

```jsx
{created && pushStatus === 'ios-needs-install' && (
  <div className="mas-push-hint">To get alerts when the app is closed, add Spectre to your Home Screen (Share - Add to Home Screen), then enable notifications here.</div>
)}
{created && (pushStatus === 'default' || pushStatus === 'granted-unsubscribed') && (
  <button
    type="button"
    className="mas-push-btn"
    onClick={async () => {
      const ok = await enablePush(getAccessToken)
      setPushStatus(ok ? 'granted-subscribed' : await getPushStatus())
    }}
  >
    Notify me when it triggers
  </button>
)}
{created && pushStatus === 'granted-subscribed' && (
  <div className="mas-push-hint mas-push-hint--on">Push notifications are on.</div>
)}
```

CSS: `.mas-push-btn` styled like `.mas-toggle-btn.active` full-width; `.mas-push-hint` 12px muted; `--on` variant in `--bull`. Plus `body.theme-light` counterparts.

- [ ] **Step 2: Toggle in `MobileAlertsScreen` header**

Bell-ring icon button in `.mal-head` (import `BellRing` from lucide-react). On mount resolve `getPushStatus()`; tap toggles `enablePush`/`disablePush` (needs `getAccessToken` — get it via `usePrivySafe` inside this component, import path `../../../lib/use-privy-safe`). Status `denied` renders the button disabled with title "Notifications blocked in browser settings"; `ios-needs-install` shows the A2HS hint line under the header instead of the button.

- [ ] **Step 3: Build + browser check**

Run: `npm run build:trading` — green.
Browser (desktop Chrome mobile viewport is fine — Chrome supports Web Push): create alert → prompt appears → permission dialog → after grant, `navigator.serviceWorker.getRegistration('/sw.js')` resolves in console; `/api/push` POST visible in Network (dev returns the stub `{ ok: true, dev: true }`).

### Task 9: End-to-end verification on Vercel preview/prod

No file changes — a verification checklist. Codex webhooks only call the prod `WEBHOOK_CALLBACK_URL`, so the full loop is verified on the deployed trading app.

- [ ] **Step 1: Deploy env preconditions**

Confirm on Vercel (trading project): `CODEX_WEBHOOK_SECRET`, `WEBHOOK_CALLBACK_URL`, KV vars, plus the four VAPID vars from Task 7 Step 3. Redeploy after `VITE_VAPID_PUBLIC_KEY` is added.

- [ ] **Step 2: Trigger-path smoke test (Stage 1)**

On the deployed app, signed in: note that an already-met condition (e.g. "above" with a target below the current price) fires the CLIENT-side instant path, not the webhook — it does not test this task. For the WEBHOOK path pick a liquid token and set a target within ~0.5-1% of the live price in the direction the market is currently moving, then wait. Expect within minutes: (a) KV list `alerts:triggered:{userId}` gains a record (verify via GET `/api/alerts` returning it), (b) the Alerts tab shows it under Triggered after refresh, (c) badge appears on the tab icon.

- [ ] **Step 3: Push smoke test (Stage 2)**

Same flow with push enabled on a phone (Android Chrome or iOS home-screen install): background/close the app → wait for trigger → system notification appears; tapping opens the app on the token page (`/#token/<address>` — verify the hash deep-link resolves to the right token; if the app requires `#token/<address>` without leading slash handling, adjust the `url` in `sendPushForTrigger` accordingly during this step).

- [ ] **Step 4: Cleanup checks**

Delete the triggered record (trash icon) → GET no longer returns it. Disable push via the Alerts-tab toggle → KV hash entry removed (subsequent triggers arrive in-app only).

---

## Self-review notes (done at plan time)

- Spec coverage: 1.1→Task 1, 1.2→Tasks 2-3, 1.3→Task 4, 2.1→Task 5, 2.2→Task 6, 2.3→Task 7, 2.4→Task 8, parity/verification→Tasks 2/6 dev stubs + Task 9. Badge watermark (spec 1.3) → Task 4 Step 1.
- Type consistency: trigger record `id`/`triggeredAt`/`priceUsd` names match across webhook.js (produce), alerts.js (list), useAlerts (consume), MobileAlertsScreen (render). Push status enum matches between pushService and both consumers.
- Known judgment calls: badge semantics changed from "active count" to "unseen triggered count" (matches spec); `AlertNotification` toast path preserved via `triggeredAlerts`; SSE/in-memory webhook code left untouched (KV is the durable path).
