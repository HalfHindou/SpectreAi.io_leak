# Trading Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the trading app's existing alert engine a desktop surface — an unlocked header bell with an unseen badge, a right-side notification drawer with triggered history, active rules and honest channel controls, plus a signed-out path that offers sign-in instead of an error.

**Architecture:** A new `Notifications/` component folder renders a right-side overlay drawer fed by the `useAlerts()` call App.jsx already makes — no second data source, no second poll. App.jsx owns the drawer's open state and one shared `useAlertsSeen` watermark, passing it to both the header bell and the mobile shell so the two badges cannot disagree. The alert engine (webhooks, cron, push/Telegram fan-out, service worker) is not touched.

**Tech Stack:** React 18 functional components, plain CSS, `lucide-react` icons, relative imports (no `@/` alias in this app), Zustand untouched.

## Global Constraints

- **App scope:** `apps/trading` only. Do not edit `apps/research` or `packages/server`.
- **Do not touch the engine:** `api/alerts.js`, `api/cron/check-alert-rules.js`, `api/_lib/alert-notify.js`, `api/_lib/alert-rules.js`, `public/sw.js`, `src/services/pushService.js`, `src/services/telegramLink.js` are read-only for this plan. Consume them, do not modify them.
- **Day mode selector is `body.theme-light`.** `.app.app-day-mode` is dead code in the trading app — never write it. Every new rule that sets a colour, background or border gets a `body.theme-light` counterpart.
- **CSS class prefix:** `nd-` for everything in the drawer. Never introduce a class containing `glass-` (`app-store-ready.css` glass-ifies any `[class*="glass-"]`).
- **Icons:** `lucide-react` only.
- **Imports:** relative paths only (`../hooks/useAlerts`), never `@/`.
- **No new event types.** Only price and pct alerts, which already exist. Swap/watchlist/Brain events are a later effort.
- **No "Install app" CTA and no `beforeinstallprompt` handling.** Deferred to its own task.
- **localStorage key `spectre-alerts-seen-ts`** is existing and in use — reuse the exact string so no user's watermark resets.
- **No commits pushed to origin.** Local commits per task are fine; pushing and PRs need a separate explicit go from Evgeniy.

## Testing note — read before Task 1

**This repo has no test runner.** There are no test files in either app and no vitest/jest config; `.claude/rules/coding-standards.md` states this explicitly. Adding a test framework is not in scope for this plan and would be a large unrequested change.

So the test cycle for every task below is:

1. `npm run build:trading` from the monorepo root — must finish clean and print `[check-critical-path] OK`.
2. A scripted browser check with the stated expected result, run against `npm run dev:trading` (port 5181) using the Claude Chrome extension (`mcp__claude-in-chrome__*`) — **not Playwright**.

Browser checks are written as concrete steps with a concrete expected observation. Treat a failed observation exactly like a failing test: do not proceed to the commit step.

**Two measurement traps that will waste your time:**
- A Chrome-MCP tab often reports `document.hidden === true` (backgrounded/occluded window). `useAlerts` skips its 30s poll in that state (`useAlerts.js:290`) and rAF-driven animation is frozen. Before trusting any observation, evaluate `document.hidden` and raise the window if it is true.
- React synthesises `onMouseEnter` from `mouseover`/`mouseout`, and a synthetic `MouseEvent` does not drive React handlers reliably. Use real pointer input via the extension's `computer` tool for clicks, not dispatched events.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `apps/trading/src/hooks/useAlertsSeen.js` | The unseen-triggered watermark: count + markSeen, backed by localStorage. Nothing else. |
| `apps/trading/src/components/Notifications/NotificationChannels.jsx` | The "where alerts reach you" block: browser-push row and Telegram row, including every device state. Self-contained — owns its own push/Telegram status effects. |
| `apps/trading/src/components/Notifications/NotificationDrawer.jsx` | The drawer shell and its lists: signed-out screen, triggered section, active-rules section, empty state. Mounts NotificationChannels. |
| `apps/trading/src/components/Notifications/NotificationDrawer.css` | All `nd-` styles for both components, dark and `body.theme-light`. |

**Modified:**

| File | Change |
|---|---|
| `apps/trading/src/components/mobile/home/MobileHomeShell.jsx:68-79` | Drop the local watermark state; take `unseenCount` / `markSeen` as props. |
| `apps/trading/src/App.jsx:724` (useAlerts), `:1581` (AlertNotification), `:1596` (Header), `:1634` (MobileHomeShell) | Own drawer open state + the shared watermark; wire both shells; mount the drawer. |
| `apps/trading/src/components/Header.jsx:521-538, :551-560` | Remove the locked settings row; unlock the bell, add the badge. |
| `apps/trading/src/components/Header.css` | Bell badge + active state styles. |
| `apps/trading/src/components/AlertButton.jsx` | Signed-out gating and pending-submit-after-login. |

Why the drawer is split in two files: the Telegram link flow is a small state machine (start link → poll for confirmation → linked/timeout) and the push toggle has five device states. Keeping that in its own component leaves `NotificationDrawer.jsx` as list rendering only, and both files stay small enough to hold in context while editing.

---

### Task 1: Shared unseen-alerts watermark

Behaviour must not change anywhere. This task only moves the watermark out of the mobile shell so two surfaces can share one instance.

**Files:**
- Create: `apps/trading/src/hooks/useAlertsSeen.js`
- Modify: `apps/trading/src/components/mobile/home/MobileHomeShell.jsx:30` (delete the const), `:68-79` (delete local state), `:147`, `:157`, `:166` (prop plumbing)
- Modify: `apps/trading/src/App.jsx:724`, `:1634`

**Interfaces:**
- Consumes: `triggered[]` from the existing `useAlerts()` in App.jsx. Each record has a numeric `triggeredAt` (ms epoch).
- Produces: `useAlertsSeen(triggered) -> { unseenCount: number, markSeen: () => void }`, default export. Tasks 3 and 4 consume both fields.

- [ ] **Step 1: Create the hook**

Create `apps/trading/src/hooks/useAlertsSeen.js`:

```js
/**
 * useAlertsSeen - shared "unseen triggered alerts" watermark.
 *
 * One localStorage timestamp per device. A triggered record is unseen when its
 * triggeredAt is newer than the watermark. Extracted from MobileHomeShell so
 * the desktop header bell badge and the mobile Alerts tab badge are computed
 * from one definition and can never disagree.
 *
 * Mount this ONCE (App.jsx) and pass the result down - two instances would
 * hold separate React state and only one would re-render on markSeen().
 */

import { useState, useCallback, useMemo } from 'react'

// Pre-existing key - do not rename, it would reset every user's watermark
// and re-badge alerts they have already read.
const ALERTS_SEEN_KEY = 'spectre-alerts-seen-ts'

function readSeenTs() {
  try {
    return parseInt(localStorage.getItem(ALERTS_SEEN_KEY) || '0', 10) || 0
  } catch {
    return 0 // private mode / storage disabled
  }
}

export default function useAlertsSeen(triggered) {
  const [seenTs, setSeenTs] = useState(readSeenTs)

  const unseenCount = useMemo(() => (
    (Array.isArray(triggered) ? triggered : [])
      .filter(t => (t?.triggeredAt || 0) > seenTs)
      .length
  ), [triggered, seenTs])

  const markSeen = useCallback(() => {
    const now = Date.now()
    setSeenTs(now)
    try { localStorage.setItem(ALERTS_SEEN_KEY, String(now)) } catch { /* private mode */ }
  }, [])

  return { unseenCount, markSeen }
}
```

- [ ] **Step 2: Mount it in App.jsx**

`App.jsx:724` currently reads:

```jsx
const { alerts, rules, triggered, triggeredAlerts, createAlert, updateAlert, deleteAlert, deleteTriggered, dismissTriggered } = useAlerts()
```

Add the import next to the other hook imports at the top of the file:

```jsx
import useAlertsSeen from './hooks/useAlertsSeen'
```

and immediately after the `useAlerts()` line:

```jsx
const { unseenCount: unseenAlerts, markSeen: markAlertsSeen } = useAlertsSeen(triggered)
```

- [ ] **Step 3: Convert MobileHomeShell to props**

In `MobileHomeShell.jsx`, delete the `ALERTS_SEEN_KEY` const at line 30, delete the `alertsSeenTs` state (lines 68-71), the `unseenTriggered` derivation (line 73) and the local `markAlertsSeen` callback (lines 75-79).

Add `unseenAlerts` and `markAlertsSeen` to the component's destructured props (the list starting around line 60), then replace the three usages:

```jsx
// line ~147, inside the alerts screen render
onSeen={markAlertsSeen}

// lines ~157 and ~166, the nav badges
alertsCount={unseenAlerts}
```

`switchTab` at line ~89 already calls `markAlertsSeen()` when `id === 'alerts'` — it now calls the prop. Leave that line as-is and remove `markAlertsSeen` from its dependency array only if the prop is not stable; App.jsx's `markAlertsSeen` is a `useCallback` with an empty dep array, so it is stable — keep the dep.

Pass both from App.jsx at the `<MobileHomeShell` mount (`App.jsx:1634`):

```jsx
unseenAlerts={unseenAlerts}
markAlertsSeen={markAlertsSeen}
```

- [ ] **Step 4: Build**

Run from the monorepo root: `npm run build:trading`
Expected: completes with no errors and prints `[check-critical-path] OK`.

- [ ] **Step 5: Browser check — mobile badge unchanged**

With `npm run dev:trading` running, open `http://localhost:5181` in a 440px-wide window so the mobile shell mounts. In the console:

```js
localStorage.setItem('spectre-alerts-seen-ts', '0')
```

Reload. If the signed-in account has any triggered history, the Alerts item in the bottom nav shows its badge exactly as before this task. Open the Alerts tab, switch away, and confirm the badge is gone and stays gone after a reload.

Expected: identical behaviour to before the change. If the account has no triggered history, confirm instead that `localStorage.getItem('spectre-alerts-seen-ts')` updates to a fresh timestamp when the Alerts tab is opened.

- [ ] **Step 6: Commit**

```bash
git add apps/trading/src/hooks/useAlertsSeen.js apps/trading/src/components/mobile/home/MobileHomeShell.jsx apps/trading/src/App.jsx
git commit -m "refactor(trading): lift the unseen-alerts watermark into a shared hook"
```

---

### Task 2: Channel rows (browser push + Telegram)

**Files:**
- Create: `apps/trading/src/components/Notifications/NotificationChannels.jsx`
- Create: `apps/trading/src/components/Notifications/NotificationDrawer.css` (channel rules only in this task; the drawer shell adds to it in Task 3)

**Interfaces:**
- Consumes: `getPushStatus()`, `enablePush(getAccessToken)`, `disablePush(getAccessToken)` from `../../services/pushService`; `getTelegramStatus`, `startTelegramLink`, `unlinkTelegram` from `../../services/telegramLink`; `usePrivySafe` from `../../lib/use-privy-safe`.
- Produces: `<NotificationChannels />`, default export, takes no props. Task 3 renders it inside the drawer footer.

`getPushStatus()` resolves to exactly one of: `'unsupported' | 'ios-needs-install' | 'denied' | 'default' | 'granted-subscribed' | 'granted-unsubscribed'`. Handle all six.

- [ ] **Step 1: Create the component**

Create `apps/trading/src/components/Notifications/NotificationChannels.jsx`:

```jsx
/**
 * NotificationChannels - the "where alerts reach you" block (prefix nd-).
 *
 * Renders only what the device can actually do. Web Push works in a plain
 * browser tab on desktop Chrome/Edge/Firefox, macOS Safari 16+, and Android
 * Chrome/Firefox; it requires a home-screen install ONLY on iOS/iPadOS. So the
 * home-screen copy is gated on pushService's 'ios-needs-install' status and can
 * never appear on a platform where push already works.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { BellRing, Check } from 'lucide-react'
import TelegramGlyph from '../ui/TelegramGlyph'
import { usePrivySafe as usePrivy } from '../../lib/use-privy-safe'
import { getPushStatus, enablePush, disablePush } from '../../services/pushService'
import { getTelegramStatus, startTelegramLink, unlinkTelegram } from '../../services/telegramLink'

const TG_POLL_MS = 3000
const TG_MAX_POLLS = 20

export default function NotificationChannels() {
  const { authenticated, getAccessToken } = usePrivy()
  const [pushStatus, setPushStatus] = useState(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [tgStatus, setTgStatus] = useState(null)
  const [tgError, setTgError] = useState(false)
  const tgPollRef = useRef(null)

  // privy.md D2: getAccessToken gets a new identity on every Privy re-render.
  // Keep it in a ref so effects depend on `authenticated` alone.
  const getAccessTokenRef = useRef(getAccessToken)
  useEffect(() => { getAccessTokenRef.current = getAccessToken }, [getAccessToken])

  const clearTgPoll = useCallback(() => {
    if (tgPollRef.current) { clearInterval(tgPollRef.current); tgPollRef.current = null }
  }, [])

  useEffect(() => {
    let cancelled = false
    getPushStatus().then(s => { if (!cancelled) setPushStatus(s) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!authenticated) { clearTgPoll(); setTgStatus(null); return }
    let cancelled = false
    getTelegramStatus((...a) => getAccessTokenRef.current(...a))
      .then(s => { if (!cancelled) setTgStatus(s) })
    return () => { cancelled = true }
  }, [authenticated, clearTgPoll])

  useEffect(() => () => clearTgPoll(), [clearTgPoll])

  const togglePush = useCallback(async () => {
    if (pushBusy) return
    if (pushStatus === 'denied' || pushStatus === 'unsupported' || pushStatus === 'ios-needs-install') return
    setPushBusy(true)
    try {
      if (pushStatus === 'granted-subscribed') {
        const ok = await disablePush(getAccessTokenRef.current)
        setPushStatus(ok ? 'granted-unsubscribed' : await getPushStatus())
      } else {
        const ok = await enablePush(getAccessTokenRef.current)
        setPushStatus(ok ? 'granted-subscribed' : await getPushStatus())
      }
    } finally {
      setPushBusy(false)
    }
  }, [pushStatus, pushBusy])

  const connectTelegram = useCallback(async () => {
    setTgError(false)
    const result = await startTelegramLink((...a) => getAccessTokenRef.current(...a))
    if (!result?.url) { setTgError(true); return }
    window.open(result.url, '_blank')
    setTgStatus('waiting')
    clearTgPoll()
    let attempts = 0
    tgPollRef.current = setInterval(async () => {
      attempts += 1
      if (attempts > TG_MAX_POLLS) { clearTgPoll(); setTgStatus('unlinked'); return }
      if (document.hidden) return
      const s = await getTelegramStatus((...a) => getAccessTokenRef.current(...a))
      if (s === 'linked') { clearTgPoll(); setTgStatus('linked') }
    }, TG_POLL_MS)
  }, [clearTgPoll])

  const disconnectTelegram = useCallback(async () => {
    const ok = await unlinkTelegram((...a) => getAccessTokenRef.current(...a))
    if (ok) setTgStatus('unlinked')
  }, [])

  const pushOn = pushStatus === 'granted-subscribed'
  const pushBlocked = pushStatus === 'denied'

  return (
    <div className="nd-channels">
      <span className="nd-channels-label">Where alerts reach you</span>

      {pushStatus === 'ios-needs-install' ? (
        <div className="nd-channel nd-channel--hint">
          <span className="nd-channel-icon"><BellRing size={15} strokeWidth={1.9} /></span>
          <span className="nd-channel-body">
            <span className="nd-channel-name">Browser</span>
            <span className="nd-channel-sub">
              On iPhone and iPad, add Spectre to your Home Screen (Share &rarr; Add to Home Screen)
              to receive notifications.
            </span>
          </span>
        </div>
      ) : pushStatus && pushStatus !== 'unsupported' ? (
        <button
          type="button"
          className={`nd-channel nd-channel--action${pushOn ? ' is-on' : ''}`}
          onClick={togglePush}
          disabled={pushBusy || pushBlocked}
          aria-pressed={pushOn}
        >
          <span className="nd-channel-icon"><BellRing size={15} strokeWidth={1.9} /></span>
          <span className="nd-channel-body">
            <span className="nd-channel-name">Browser</span>
            <span className="nd-channel-sub">
              {pushBlocked
                ? 'Blocked in your browser settings'
                : pushOn ? 'Alerts arrive even when Spectre is closed' : 'Get alerts outside the app'}
            </span>
          </span>
          <span className={`nd-toggle${pushOn ? ' is-on' : ''}`}><span className="nd-toggle-thumb" /></span>
        </button>
      ) : null}

      {authenticated && (tgStatus === 'unlinked' || tgStatus === 'waiting' || tgStatus === 'linked') && (
        <div className="nd-channel">
          <span className="nd-channel-icon"><TelegramGlyph size={15} /></span>
          <span className="nd-channel-body">
            <span className="nd-channel-name">Telegram</span>
            <span className="nd-channel-sub">
              {tgStatus === 'linked' && 'Connected'}
              {tgStatus === 'waiting' && 'Waiting for Telegram...'}
              {tgStatus === 'unlinked' && (tgError ? 'Could not start linking - try again' : 'Get alerts as a message')}
            </span>
          </span>
          {tgStatus === 'linked' && (
            <>
              <span className="nd-channel-check"><Check size={14} strokeWidth={2.4} /></span>
              <button type="button" className="nd-channel-btn" onClick={disconnectTelegram}>Disconnect</button>
            </>
          )}
          {tgStatus === 'unlinked' && (
            <button type="button" className="nd-channel-btn" onClick={connectTelegram}>Connect</button>
          )}
        </div>
      )}
    </div>
  )
}
```

Note `TelegramGlyph` lives at `src/components/ui/TelegramGlyph` — from `components/Notifications/` that is `../ui/TelegramGlyph`. Confirm the file exists before building; mobile imports it as `../../ui/TelegramGlyph` from `components/mobile/home/`.

- [ ] **Step 2: Create the stylesheet with the channel rules**

Create `apps/trading/src/components/Notifications/NotificationDrawer.css`:

```css
/* Notification drawer + channels (prefix nd-).
   Day mode in this app is body.theme-light - .app.app-day-mode never matches
   here and is dead code. Every colour rule below has a light counterpart. */

.nd-channels {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px 16px;
  border-top: 1px solid var(--border-default);
}

.nd-channels-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 2px;
}

.nd-channel {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  background: var(--ob-surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  text-align: left;
  color: var(--text-1);
  transition: border-color var(--duration-base, 250ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.nd-channel--action { cursor: pointer; }
.nd-channel--action:hover:not(:disabled) { border-color: var(--border-strong); }
.nd-channel--action:disabled { cursor: default; opacity: 0.55; }

.nd-channel-icon { display: flex; color: var(--text-2); flex-shrink: 0; }
.nd-channel-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.nd-channel-name { font-size: 0.8125rem; font-weight: 600; color: var(--text-1); }
.nd-channel-sub { font-size: 0.75rem; color: var(--text-3); line-height: 1.35; }

.nd-channel-check { display: flex; color: var(--up); flex-shrink: 0; }

.nd-channel-btn {
  flex-shrink: 0;
  padding: 5px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-2);
  background: var(--ob-surface-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.nd-channel-btn:hover { color: var(--text-1); border-color: var(--border-strong); }

.nd-toggle {
  flex-shrink: 0;
  width: 34px;
  height: 20px;
  padding: 2px;
  background: rgba(255, 255, 255, 0.10);
  border-radius: var(--radius-full);
  transition: background 200ms var(--ease-out, ease);
}
.nd-toggle.is-on { background: var(--up); }
.nd-toggle-thumb {
  display: block;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  transition: transform 200ms var(--ease-out, ease);
}
.nd-toggle.is-on .nd-toggle-thumb { transform: translateX(14px); }

/* ── Day mode ─────────────────────────────────────────────────────────── */
body.theme-light .nd-channels { border-top-color: rgba(15, 23, 42, 0.08); }
body.theme-light .nd-channels-label { color: #64748b; }
body.theme-light .nd-channel {
  background: #fff;
  border-color: rgba(15, 23, 42, 0.08);
  color: #0f172a;
}
body.theme-light .nd-channel--action:hover:not(:disabled) { border-color: rgba(15, 23, 42, 0.16); }
body.theme-light .nd-channel-icon { color: #475569; }
body.theme-light .nd-channel-name { color: #0f172a; }
body.theme-light .nd-channel-sub { color: #64748b; }
body.theme-light .nd-channel-btn {
  color: #475569;
  background: #f5f5f7;
  border-color: rgba(15, 23, 42, 0.08);
}
body.theme-light .nd-channel-btn:hover { color: #0f172a; border-color: rgba(15, 23, 42, 0.16); }
body.theme-light .nd-toggle { background: rgba(15, 23, 42, 0.14); }
```

- [ ] **Step 3: Build**

Run: `npm run build:trading`
Expected: clean, `[check-critical-path] OK`. The component is not mounted yet, so this only proves it compiles and every import resolves.

- [ ] **Step 4: Commit**

```bash
git add apps/trading/src/components/Notifications/
git commit -m "feat(trading): notification channel rows - browser push and telegram"
```

---

### Task 3: The drawer

**Files:**
- Create: `apps/trading/src/components/Notifications/NotificationDrawer.jsx`
- Modify: `apps/trading/src/components/Notifications/NotificationDrawer.css` (append the shell/list rules)

**Interfaces:**
- Consumes: `<NotificationChannels />` from Task 2.
- Produces: `<NotificationDrawer />`, default export, props:
  `{ open: boolean, onClose: () => void, rules: array, alerts: array, triggered: array, seenTs: number, updateAlert: (id, updates) => Promise, deleteAlert: (id) => Promise, deleteTriggered: (id) => void, onSelectToken: (record) => void, onGoScreener: () => void }`
  Task 4 mounts it with exactly these props.

Row semantics mirror `MobileAlertsScreen.jsx` deliberately — a pct rule must read the same on both surfaces.

- [ ] **Step 1: Create the component**

Create `apps/trading/src/components/Notifications/NotificationDrawer.jsx`:

```jsx
/**
 * NotificationDrawer - desktop notification centre (prefix nd-).
 *
 * Right-side overlay over the app, including the swap panel - hence the scrim,
 * so the state reads as "a panel is open" rather than "the layout moved".
 * Closes on Esc, scrim click, and the close button.
 *
 * Read + manage only. Creation stays on the token page (AlertButton), the same
 * split the mobile Alerts tab uses.
 */

import React, { useEffect, useCallback, useState } from 'react'
import { Bell, X, ArrowUp, ArrowDown, Trash2, Pause, Play, Repeat } from 'lucide-react'
import { usePrivySafe as usePrivy } from '../../lib/use-privy-safe'
import { formatPrice } from '../../services/codexApi'
import NotificationChannels from './NotificationChannels'
import './NotificationDrawer.css'

const relTime = (ts) => {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000))
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function NotificationDrawer({
  open,
  onClose,
  rules,
  alerts,
  triggered,
  seenTs,
  updateAlert,
  deleteAlert,
  deleteTriggered,
  onSelectToken,
  onGoScreener,
}) {
  const { authenticated, login } = usePrivy()
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const togglePause = useCallback(async (rule) => {
    const paused = rule.status === 'paused'
    setBusyId(rule.id)
    try { await updateAlert(rule.id, { status: paused ? 'active' : 'paused' }) }
    catch { /* row stays as-is; the next poll reconciles */ }
    finally { setBusyId(null) }
  }, [updateAlert])

  const remove = useCallback(async (id) => {
    setBusyId(id)
    try { await deleteAlert(id) } finally { setBusyId(null) }
  }, [deleteAlert])

  if (!open) return null

  // Prefer the v2 rules list; fall back to the legacy alerts array, exactly as
  // MobileAlertsScreen does, so both surfaces show the same set.
  const list = Array.isArray(rules) && rules.length > 0
    ? rules.filter(r => r.type === 'price' || r.type === 'pct')
    : (Array.isArray(alerts) ? alerts : [])
  const trigList = Array.isArray(triggered) ? triggered : []
  const activeCount = list.filter(r => r.status !== 'paused').length

  return (
    <>
      <div className="nd-scrim" onClick={onClose} />
      <aside className="nd" role="dialog" aria-label="Notifications" aria-modal="true">
        <header className="nd-head">
          <span className="nd-title">Notifications</span>
          {authenticated && activeCount > 0 && <span className="nd-count">{activeCount}</span>}
          <button type="button" className="nd-close" onClick={onClose} aria-label="Close notifications">
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        {!authenticated ? (
          <div className="nd-signin">
            <div className="nd-signin-icon"><Bell size={24} strokeWidth={1.5} /></div>
            <p className="nd-signin-title">Price alerts</p>
            <p className="nd-signin-sub">
              Set a price or market-cap target on any token and Spectre tells you when it hits -
              in your browser and on Telegram, even when the app is closed.
            </p>
            <button type="button" className="nd-signin-btn" onClick={() => { try { login() } catch { /* modal already open */ } }}>
              Sign in
            </button>
          </div>
        ) : (list.length === 0 && trigList.length === 0) ? (
          <div className="nd-empty">
            <div className="nd-empty-icon"><Bell size={22} strokeWidth={1.6} /></div>
            <p className="nd-empty-title">No alerts yet</p>
            <p className="nd-empty-sub">Open any token and press the bell in its header to set one.</p>
            <button type="button" className="nd-empty-btn" onClick={onGoScreener}>Find a token</button>
          </div>
        ) : (
          <div className="nd-scroll">
            {trigList.length > 0 && (
              <section className="nd-section">
                <span className="nd-section-label">Triggered</span>
                {trigList.map(t => (
                  <div key={t.id} className={`nd-row nd-row--fired${(t.triggeredAt || 0) > seenTs ? ' is-unseen' : ''}`}>
                    <button type="button" className="nd-row-main" onClick={() => onSelectToken(t)}>
                      <span className={`nd-dir ${t.direction === 'above' ? 'up' : 'down'}`}>
                        {t.direction === 'above'
                          ? <ArrowUp size={13} strokeWidth={2.5} />
                          : <ArrowDown size={13} strokeWidth={2.5} />}
                      </span>
                      <span className="nd-row-body">
                        <span className="nd-row-name">{t.name || 'Price alert'}</span>
                        <span className="nd-row-cond">
                          {t.changePct != null
                            ? <>Moved {t.changePct > 0 ? '+' : ''}{t.changePct}% &middot; hit {formatPrice(t.priceUsd)} &middot; {relTime(t.triggeredAt)}</>
                            : <>Hit <b>{formatPrice(t.priceUsd)}</b> &middot; {relTime(t.triggeredAt)}</>}
                        </span>
                      </span>
                    </button>
                    <button type="button" className="nd-row-btn" onClick={() => deleteTriggered(t.id)} aria-label="Dismiss">
                      <Trash2 size={15} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </section>
            )}

            {list.length > 0 && (
              <section className="nd-section">
                <span className="nd-section-label">Active</span>
                {list.map(a => {
                  const isPct = a.type === 'pct'
                  const paused = a.status === 'paused'
                  const pctDir = a.condition?.direction ?? 'both'
                  const dirClass = isPct
                    ? (pctDir === 'up' ? 'up' : pctDir === 'down' ? 'down' : 'both')
                    : (a.direction === 'above' ? 'up' : 'down')
                  const windowLabel = a.condition?.windowMin === 60 ? '1h' : '24h'
                  return (
                    <div key={a.id} className={`nd-row${paused ? ' is-paused' : ''}`}>
                      <span className={`nd-dir ${dirClass}`}>
                        {isPct
                          ? (pctDir === 'up' ? <ArrowUp size={13} strokeWidth={2.5} />
                            : pctDir === 'down' ? <ArrowDown size={13} strokeWidth={2.5} />
                            : <span className="nd-dir-glyph">&plusmn;</span>)
                          : (a.direction === 'above' ? <ArrowUp size={13} strokeWidth={2.5} /> : <ArrowDown size={13} strokeWidth={2.5} />)}
                      </span>
                      <span className="nd-row-body">
                        <span className="nd-row-name">
                          {a.name || 'Price alert'}
                          {a.repeat === 'recurring' && (
                            <span className="nd-repeat" title="Repeats"><Repeat size={11} strokeWidth={2.2} /></span>
                          )}
                        </span>
                        <span className="nd-row-cond">
                          {isPct
                            ? <>Moves {pctDir === 'both' ? '' : pctDir === 'up' ? 'up ' : 'down '}{a.condition?.pct}% in {windowLabel}</>
                            : <>{a.direction === 'above' ? 'Above' : 'Below'} <b>{formatPrice(a.priceTarget)}</b></>}
                          {paused && ' · paused'}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="nd-row-btn"
                        onClick={() => togglePause(a)}
                        disabled={busyId === a.id}
                        aria-label={paused ? 'Resume alert' : 'Pause alert'}
                      >
                        {paused ? <Play size={15} strokeWidth={2} /> : <Pause size={15} strokeWidth={2} />}
                      </button>
                      <button
                        type="button"
                        className="nd-row-btn"
                        onClick={() => remove(a.id)}
                        disabled={busyId === a.id}
                        aria-label="Delete alert"
                      >
                        <Trash2 size={15} strokeWidth={2} />
                      </button>
                    </div>
                  )
                })}
              </section>
            )}
          </div>
        )}

        {authenticated && <NotificationChannels />}
      </aside>
    </>
  )
}
```

- [ ] **Step 2: Append the shell styles**

Append to `apps/trading/src/components/Notifications/NotificationDrawer.css` (above the existing day-mode block is fine; keep all `body.theme-light` rules together at the end of the file):

```css
.nd-scrim {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgba(0, 0, 0, 0.45);
  animation: ndFade 180ms var(--ease-out, ease) both;
}

.nd {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 901;
  display: flex;
  flex-direction: column;
  width: 420px;
  max-width: 92vw;
  height: 100vh;
  background: var(--ob-surface-1);
  border-left: 1px solid var(--border-default);
  box-shadow: -24px 0 60px rgba(0, 0, 0, 0.45);
  animation: ndSlide 240ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
}

@keyframes ndFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes ndSlide { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }

@media (prefers-reduced-motion: reduce) {
  .nd, .nd-scrim { animation: none; }
}

.nd-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-bottom: 1px solid var(--border-default);
}
.nd-title { font-size: 0.9375rem; font-weight: 600; color: var(--text-1); }
.nd-count {
  padding: 1px 7px;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-2);
  background: var(--ob-surface-3);
  border-radius: var(--radius-full);
}
.nd-close {
  margin-left: auto;
  display: flex;
  padding: 4px;
  color: var(--text-3);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.nd-close:hover { color: var(--text-1); background: var(--ob-surface-3); }

.nd-scroll { flex: 1; overflow-y: auto; padding: 4px 0; }

.nd-section { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px 6px; }
.nd-section-label {
  padding: 0 4px;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}

.nd-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  background: var(--ob-surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.nd-row.is-paused { opacity: 0.55; }
.nd-row.is-unseen { border-color: var(--border-strong); background: var(--ob-surface-3); }

.nd-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding: 0;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
}

.nd-dir {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
}
.nd-dir.up { color: var(--up); background: rgba(52, 232, 158, 0.10); }
.nd-dir.down { color: var(--down); background: rgba(255, 81, 105, 0.10); }
.nd-dir.both { color: var(--text-2); background: rgba(255, 255, 255, 0.06); }
.nd-dir-glyph { font-size: 0.8125rem; font-weight: 700; line-height: 1; }

.nd-row-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.nd-row-name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nd-repeat { display: flex; color: var(--text-3); }
.nd-row-cond { font-size: 0.75rem; color: var(--text-3); }
.nd-row-cond b { font-weight: 600; color: var(--text-2); }

.nd-row-btn {
  display: flex;
  flex-shrink: 0;
  padding: 5px;
  color: var(--text-3);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.nd-row-btn:hover:not(:disabled) { color: var(--text-1); background: var(--ob-surface-3); }
.nd-row-btn:disabled { opacity: 0.4; cursor: default; }

.nd-signin, .nd-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 28px;
  text-align: center;
}
.nd-signin-icon, .nd-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 4px;
  color: var(--text-3);
  background: var(--ob-surface-2);
  border-radius: 50%;
}
.nd-signin-title, .nd-empty-title { font-size: 0.9375rem; font-weight: 600; color: var(--text-1); }
.nd-signin-sub, .nd-empty-sub { font-size: 0.8125rem; line-height: 1.5; color: var(--text-3); }
.nd-signin-btn, .nd-empty-btn {
  margin-top: 8px;
  padding: 9px 20px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--ob-surface-1);
  background: var(--text-1);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.nd-signin-btn:hover, .nd-empty-btn:hover { opacity: 0.88; }

/* ── Day mode ─────────────────────────────────────────────────────────── */
body.theme-light .nd { background: #fff; border-left-color: rgba(15, 23, 42, 0.08); }
body.theme-light .nd-head { border-bottom-color: rgba(15, 23, 42, 0.08); }
body.theme-light .nd-title { color: #0f172a; }
body.theme-light .nd-count { color: #475569; background: #f5f5f7; }
body.theme-light .nd-close { color: #64748b; }
body.theme-light .nd-close:hover { color: #0f172a; background: #f5f5f7; }
body.theme-light .nd-section-label { color: #64748b; }
body.theme-light .nd-row { background: #fff; border-color: rgba(15, 23, 42, 0.08); }
body.theme-light .nd-row.is-unseen { background: #f5f5f7; border-color: rgba(15, 23, 42, 0.16); }
body.theme-light .nd-row-name { color: #0f172a; }
body.theme-light .nd-row-cond { color: #64748b; }
body.theme-light .nd-row-cond b { color: #475569; }
body.theme-light .nd-row-btn { color: #64748b; }
body.theme-light .nd-row-btn:hover:not(:disabled) { color: #0f172a; background: #f5f5f7; }
body.theme-light .nd-dir.both { color: #475569; background: rgba(15, 23, 42, 0.06); }
body.theme-light .nd-signin-icon, body.theme-light .nd-empty-icon { color: #64748b; background: #f5f5f7; }
body.theme-light .nd-signin-title, body.theme-light .nd-empty-title { color: #0f172a; }
body.theme-light .nd-signin-sub, body.theme-light .nd-empty-sub { color: #64748b; }
body.theme-light .nd-signin-btn, body.theme-light .nd-empty-btn { color: #fff; background: #0f172a; }
```

- [ ] **Step 3: Build**

Run: `npm run build:trading`
Expected: clean, `[check-critical-path] OK`.

- [ ] **Step 4: Commit**

```bash
git add apps/trading/src/components/Notifications/
git commit -m "feat(trading): notification drawer - triggered history, active rules, sign-in screen"
```

---

### Task 4: Unlock the bell and wire the drawer

This is the task that makes everything above reachable.

**Files:**
- Modify: `apps/trading/src/App.jsx` — drawer state, `<NotificationDrawer>` mount, Header props, toast suppression
- Modify: `apps/trading/src/components/Header.jsx:521-538` (delete the locked row), `:551-560` (unlock the bell)
- Modify: `apps/trading/src/components/Header.css` (badge + active state)

**Interfaces:**
- Consumes: `useAlertsSeen` (Task 1), `<NotificationDrawer>` (Task 3).
- Produces: Header gains two props — `unseenAlerts: number` and `onOpenNotifications: () => void`.

- [ ] **Step 1: App.jsx — state and mount**

Add the import beside the other component imports:

```jsx
import NotificationDrawer from './components/Notifications/NotificationDrawer'
```

Add state next to the other view state (near the `paletteOpen` state):

```jsx
const [notifOpen, setNotifOpen] = useState(false)
```

Replace the `<AlertNotification .../>` block at `App.jsx:1581` with the toast plus the drawer. The toast is suppressed while the drawer is open — the same event would otherwise be on screen twice:

```jsx
{!notifOpen && (
  <AlertNotification
    triggeredAlerts={triggeredAlerts}
    onDismiss={dismissTriggered}
    onNavigate={(address, networkId, symbol, logo) => {
      if (address) {
        selectToken({ address, networkId: networkId || 1, symbol: symbol || '', logo: logo || '' }, 'alert')
      }
    }}
  />
)}
{!isEmbedded && !isMobile && (
  <NotificationDrawer
    open={notifOpen}
    onClose={() => setNotifOpen(false)}
    rules={rules}
    alerts={alerts}
    triggered={triggered}
    seenTs={alertsSeenTs}
    updateAlert={updateAlert}
    deleteAlert={deleteAlert}
    deleteTriggered={deleteTriggered}
    onSelectToken={(t) => {
      if (!t.tokenAddress) return
      selectToken({
        address: t.tokenAddress,
        networkId: t.networkId || 1,
        symbol: t.symbol || (t.name || '').split(' ')[0] || '',
        logo: t.logo || '',
      }, 'notification-drawer')
      setNotifOpen(false)
    }}
    onGoScreener={() => { setNotifOpen(false); navigateTo('welcome') }}
  />
)}
```

The drawer needs the raw watermark to mark rows unseen, which `useAlertsSeen` does not currently return. Extend the hook (`useAlertsSeen.js`) to also return it — one line in the return object:

```js
return { unseenCount, markSeen, seenTs }
```

and destructure it in App.jsx:

```jsx
const { unseenCount: unseenAlerts, markSeen: markAlertsSeen, seenTs: alertsSeenTs } = useAlertsSeen(triggered)
```

Note the ordering subtlety: opening the drawer calls `markAlertsSeen()`, which moves `seenTs` to now, which would clear the unseen highlight on the rows the user just opened the drawer to read. Capture the watermark at open time instead:

```jsx
const [notifOpen, setNotifOpen] = useState(false)
const [notifSeenAtOpen, setNotifSeenAtOpen] = useState(0)

const openNotifications = useCallback(() => {
  setNotifSeenAtOpen(alertsSeenTs)  // freeze the highlight for this session
  setNotifOpen(true)
  markAlertsSeen()                  // clears the bell badge
}, [alertsSeenTs, markAlertsSeen])
```

and pass `seenTs={notifSeenAtOpen}` to the drawer rather than `alertsSeenTs`. The badge clears immediately; the rows stay highlighted until the drawer is closed and reopened.

- [ ] **Step 2: App.jsx — Header props**

At the `<Header` mount (`App.jsx:1596`), add:

```jsx
unseenAlerts={unseenAlerts}
onOpenNotifications={openNotifications}
```

- [ ] **Step 3: Header.jsx — delete the locked settings row**

Delete the whole locked "Notifications" `<button>` block at `Header.jsx:521-538` (the one with `is-locked`, the `Lock` glyph and `triggerCopyToast?.('Coming Soon')`). The Workspace group keeps only the Info Tooltips row.

- [ ] **Step 4: Header.jsx — unlock the bell**

Add the two props to the component's destructured props (the list containing `navigateTo` at line 145):

```jsx
unseenAlerts = 0,
onOpenNotifications,
```

Replace the locked bell button at `Header.jsx:551-560` with:

```jsx
<button
  type="button"
  className="header-icon-btn header-icon-btn--notifications"
  title="Notifications"
  aria-label={unseenAlerts > 0 ? `Notifications, ${unseenAlerts} unread` : 'Notifications'}
  aria-haspopup="dialog"
  onClick={() => onOpenNotifications?.()}
>
  <Bell size={14} strokeWidth={2} />
  {unseenAlerts > 0 && (
    <span className="header-icon-btn__badge">{unseenAlerts > 9 ? '9+' : unseenAlerts}</span>
  )}
</button>
```

If `Lock` is now unused in `Header.jsx`, remove it from the `lucide-react` import to keep the build lint-clean. Grep first — it is used by other locked rows.

- [ ] **Step 5: Header.css — badge**

Append:

```css
.header-icon-btn--notifications { position: relative; }

.header-icon-btn__badge {
  position: absolute;
  top: 1px;
  right: 1px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.5625rem;
  font-weight: 700;
  line-height: 1;
  color: var(--ob-surface-1);
  background: var(--up);
  border-radius: var(--radius-full);
  pointer-events: none;
}

body.theme-light .header-icon-btn__badge { color: #fff; background: #0f172a; }
```

- [ ] **Step 6: Build**

Run: `npm run build:trading`
Expected: clean, `[check-critical-path] OK`.

- [ ] **Step 7: Browser check — the full desktop loop**

Dev server up, desktop-width window, signed in. Confirm `document.hidden === false` first.

1. Click the header bell. Expected: the drawer slides in from the right over the swap panel, with a scrim behind it.
2. Press Esc. Expected: it closes. Reopen, click the scrim. Expected: it closes.
3. On a token page, set an alert just above the current price via the token-header bell so it fires quickly. Expected, when it triggers: the toast appears, the bell shows a badge, and opening the drawer shows the record under Triggered with the unseen marker.
4. With the drawer open, wait for a second trigger (or re-open the drawer while a toast is live). Expected: no toast renders while the drawer is open.
5. Close the drawer and reload. Expected: the badge is gone and stays gone.
6. Click a Triggered row. Expected: the app navigates to that token and the drawer closes.
7. Open the settings menu. Expected: no "Notifications" row, no lock icon.

- [ ] **Step 8: Commit**

```bash
git add apps/trading/src/App.jsx apps/trading/src/components/Header.jsx apps/trading/src/components/Header.css apps/trading/src/hooks/useAlertsSeen.js
git commit -m "feat(trading): unlock the header bell and wire the notification drawer"
```

---

### Task 5: Signed-out alert creation

**Files:**
- Modify: `apps/trading/src/components/AlertButton.jsx` (imports, `handleCreate`, the create button, a pending-submit effect)

**Interfaces:**
- Consumes: `usePrivySafe` → `{ authenticated, login }`.
- Produces: no new exports. `AlertButton`'s props are unchanged.

- [ ] **Step 1: Add auth state and the pending flag**

Add the import:

```jsx
import { usePrivySafe as usePrivy } from '../lib/use-privy-safe'
```

Inside the component, next to the other state (after line 25):

```jsx
const { authenticated, login } = usePrivy()
// Set when a signed-out user presses the gated create button. The effect below
// submits the alert they already filled in once Privy reports them signed in,
// so nothing has to be typed a second time.
const [pendingCreate, setPendingCreate] = useState(false)
```

- [ ] **Step 2: Gate the create handler**

Change the top of `handleCreate` (line 87) from:

```jsx
const handleCreate = useCallback(async () => {
  const targetPrice = resolveTargetPrice()
  if (!targetPrice || !token?.address) return
```

to:

```jsx
const handleCreate = useCallback(async () => {
  const targetPrice = resolveTargetPrice()
  if (!targetPrice || !token?.address) return
  if (!authenticated) {
    // Keep the typed target, open Privy, and let the effect below finish the job.
    setPendingCreate(true)
    try { login() } catch { /* modal already open / privy not ready */ }
    return
  }
```

and add `authenticated` and `login` to its dependency array.

- [ ] **Step 3: Submit the pending alert after login**

Add after `handleCreate`:

```jsx
// Fires once, on the transition to authenticated, only if the user actually
// pressed create while signed out and the dropdown is still open with a value.
useEffect(() => {
  if (!pendingCreate || !authenticated) return
  setPendingCreate(false)
  if (open && inputValue) handleCreate()
}, [pendingCreate, authenticated, open, inputValue, handleCreate])
```

Also clear the flag when the token changes, so a login that lands after the user has navigated away does not file an alert against the wrong token. In the existing `alertTokenKey` effect (lines 65-69) add:

```jsx
setPendingCreate(false)
```

- [ ] **Step 4: Gate the button**

Replace the create button (lines 208-214) with:

```jsx
<button
  className="alert-create-btn"
  onClick={handleCreate}
  disabled={creating || !inputValue}
>
  {creating ? 'Creating...' : authenticated ? 'Set Alert' : 'Sign in to save'}
</button>
```

The button stays enabled when signed out — it is the sign-in entry point. It is still disabled with no value typed, so the label cannot be pressed on an empty form.

- [ ] **Step 5: Build**

Run: `npm run build:trading`
Expected: clean, `[check-critical-path] OK`.

- [ ] **Step 6: Browser check — the signed-out path**

Sign out first (or use a fresh profile).

1. Open a token page and click the bell in the token header. Expected: the dropdown opens, Price/MCap and Above/Below toggles work, the input accepts a value.
2. Expected: the create button reads "Sign in to save", not "Set Alert".
3. Type a target and press it. Expected: the Privy login modal opens. No red error text appears at any point.
4. Complete sign-in. Expected: the alert is created with the value already typed, and the dropdown closes. It appears under Active in the notification drawer.
5. Click the header bell while signed out. Expected: the drawer shows the sign-in screen with its Sign in button, and no lists or channel rows.

- [ ] **Step 7: Commit**

```bash
git add apps/trading/src/components/AlertButton.jsx
git commit -m "feat(trading): offer sign-in instead of an error when creating an alert signed out"
```

---

### Task 6: Theme, channel states and final sweep

**Files:**
- Modify: `apps/trading/src/components/Notifications/NotificationDrawer.css` (only if the sweep finds a gap)

**Interfaces:** none — verification task.

- [ ] **Step 1: Day-mode sweep**

With the drawer open in each state (sign-in screen, empty, triggered list, active list), toggle the theme with the header's sun/moon control and screenshot both.

In the console, list any new rule that sets a colour without a light counterpart:

```js
[...document.styleSheets]
  .flatMap(s => { try { return [...s.cssRules] } catch { return [] } })
  .filter(r => r.selectorText && r.selectorText.includes('.nd-') && !r.selectorText.includes('theme-light'))
  .map(r => r.selectorText)
```

Expected: every selector printed that sets `color`, `background` or `border-color` has a `body.theme-light` twin in the file. Add any that are missing.

Also confirm no text is invisible: nothing should render warm-white on white. The known trap is that the trading obsidian tokens (`--text-1..4`, `--ob-surface-*`) are NOT remapped under `body.theme-light`, which is exactly why every light rule sets explicit colours rather than relying on tokens.

- [ ] **Step 2: Channel-state check**

Desktop Chrome, signed in, drawer open:
- Expected: the Browser row renders with a toggle. Turning it on shows the OS permission prompt, then the toggle reads on, and `await navigator.serviceWorker.getRegistration('/sw.js')` resolves to a registration.
- Expected: the "Add to Home Screen" copy does NOT appear.
- Block notifications in site settings and reload. Expected: the toggle is disabled and reads "Blocked in your browser settings".
- Expected: the Telegram row renders with Connect.

If a real iPhone is available, open the site in Safari without installing. Expected: no toggle, and the Home Screen copy appears. If no device is available, simulate by evaluating `pushService`'s condition — do not fake it in the component.

- [ ] **Step 3: Mobile regression check**

At a 440px width, confirm the Alerts tab still lists rules and triggered history, its badge still behaves, and the drawer does NOT mount (it is gated on `!isMobile`).

- [ ] **Step 4: Production VAPID check — needs Evgeniy**

Confirm `VITE_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` exist in the trading Vercel project (Production). If the public key is missing, `isPushSupported()` returns false, `getPushStatus()` returns `'unsupported'`, and the Browser row silently does not render for anyone — with no error in the console and nothing in the logs.

This cannot be verified from the repo. Report it as a release blocker rather than assuming it is set.

- [ ] **Step 5: Final build**

Run: `npm run build:trading`
Expected: clean, `[check-critical-path] OK`.

- [ ] **Step 6: Commit any fixes**

```bash
git add apps/trading/src/components/Notifications/NotificationDrawer.css
git commit -m "fix(trading): day-mode counterparts for the notification drawer"
```

Do not push. Pushing and opening a PR need a separate explicit go.

---

## Self-review notes

Checked against `docs/superpowers/specs/2026-08-12-trading-notifications-design.md`:

| Spec section | Task |
|---|---|
| C1 new drawer component | 3 |
| C2 header bell unlock, badge, locked row removed | 4 |
| C3 shared unseen watermark | 1 (extended in 4 to expose `seenTs`) |
| C4 drawer content — signed out, triggered, active, channels, empty | 3 (lists) + 2 (channels) |
| C5 channel states, all six | 2 |
| C6 toast unchanged, suppressed while drawer open | 4 |
| C7 signed-out create path | 5 |
| E risks — VAPID, day mode, drawer over swap panel | 6 (VAPID, day mode), 3 (scrim/Esc) |
| F verification | 4, 5, 6 |

One deviation from the spec worth flagging at execution time: the spec's `useAlertsSeen` contract was `{ unseenCount, markSeen }`, and Task 4 adds `seenTs` so the drawer can mark rows unseen without the badge-clearing race. The design intent is unchanged.

---

## Post-implementation status (2026-08-12)

**Code complete on branch `evgeniy-notifications` — 8 commits, 10 files, +960/-131. NOT pushed.**
Every task passed its own scoped review; the whole-branch review found 1 Critical + 5 Important + 8 Minor, all fixed in one wave (`3be2f40a`) and confirmed ADDRESSED by a scoped re-review, with no new breakage.

### Two defects the plan itself caused — recorded so the pattern is not repeated

1. **The pending-create flag could never fire (`8fba0c4f`).** The plan's post-login effect guarded on `if (open && inputValue)`. AlertButton's pre-existing document-wide outside-click handler closes the dropdown on the first click inside Privy's login modal — which is a same-document sibling portal, not a descendant — so `open` was always false by the time auth resolved and no alert was ever filed, silently. Confirmed in a browser: one click in the modal's email field removes `.alert-dropdown` from the DOM. Replaced with a payload snapshotted at press time and filed independently of live form state, which also removed the wrong-token and stale-target risks.
2. **Every price alert would have rendered wrong (`3be2f40a`).** The plan's drawer read `a.direction` / `a.priceTarget` off v2 rules, which store `condition.direction` / `condition.targetPrice`. `MobileAlertsScreen.jsx` carries `?? ` fallbacks for exactly this; the plan dropped them when adapting. Every desktop-created alert would have read "↓ Below $0.00". Only visible signed in — which is precisely where verification never reached.

**The lesson for the next plan in this area:** when adapting a mobile surface, port its defensive fallbacks, not just its layout. And a verification gate that cannot be exercised (here: signed-out browser) hides exactly the class of defect that lives behind it.

### Outstanding before this ships

**A. Signed-in verification — nobody has run this code signed in.** The drawer's lists and both channel rows only render when authenticated.
1. Create a price alert, open the drawer: the Active row must show the correct arrow and the real target price (this is the C1 regression check).
2. Force a trigger: toast fires, bell badge increments, Triggered row appears highlighted; opening the drawer clears the badge while the row stays highlighted; highlight clears on close+reopen; badge stays cleared after reload.
3. Trigger with the drawer open: exactly one surface shows it.
4. Triggered-row click navigates to the right token and closes the drawer; dismiss removes the row.
5. Pause/resume and delete an Active row; the header count tracks.
6. Both channel rows render. Turn browser push on, confirm a real OS notification on the next trigger. Link Telegram and leave the tab for >60s, then return — it must still read connected.
7. Signed-out create → login: the alert files exactly once, on the right token, at the right price, and the user gets a confirmation.
8. Triggered and Active rows on screen together render in the same typeface.
9. Resize below 768px with the drawer open, then trigger an alert — the toast must still appear.
10. Day mode with a real triggered row and both channel rows present.

**B. Production VAPID keys — release blocker, needs Vercel dashboard access.** Confirm `VITE_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` exist in the trading project. Without the public key `isPushSupported()` returns false, `getPushStatus()` returns `unsupported`, and the browser-push row silently does not render for anyone, with no error.

**C. Known follow-ups, deliberately not done.** `ThemeToggle`'s `locked` prop and `.header-theme-toggle.is-locked` are an unused capability (a live prop its caller never passes), not orphaned CSS — removing it is its own cleanup. Active rows are not clickable, unlike mobile's. A `pendingAlert` survives an abandoned Privy modal and would file on a later unrelated sign-in, bounded to the same token and page. The drawer has initial focus and focus restore but no focus trap.

**D. Repo-knowledge correction found during review.** `.claude/rules/design-system.md` section H states the trading app's obsidian tokens (`--text-1..4`, `--ob-surface-*`) are NOT remapped under `body.theme-light`. Two reviewers independently verified they ARE, in `apps/trading/src/index.css` around line 178. That claim is stale and should be corrected — it causes redundant explicit overrides in new CSS.

### Update — VAPID checked 2026-08-12 (item B resolved, with caveats)

`vercel env ls production` on `spectre-ai/spectre-trading` shows all four keys present, added ~20 days ago: `VITE_VAPID_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Both halves matter — the client reads the `VITE_` one, `api/_lib/alert-notify.js` reads the unprefixed pair. **Item B is no longer a release blocker.**

Two things it did surface:

1. **Preview has NO VAPID variables at all.** On a Vercel preview deployment `isPushSupported()` returns false and the browser-push row silently does not render. Do not test push on a preview and conclude the feature is broken — test locally, or on production after merge.
2. **Cannot confirm the two production public keys match.** Both are marked Sensitive, so Vercel never returns their values. Locally they are identical (87 chars). If they have diverged in production, the browser subscribes against one key while the server signs with another and push fails silently with nothing in any log. The only real check is enabling push on production after deploy and waiting for a live trigger — add that to the post-deploy pass.
