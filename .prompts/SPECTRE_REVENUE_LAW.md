# SPECTRE REVENUE LAW — Read This Before Touching ANY Auth, Payment, or Tier Logic

> **This is not a suggestion. This is the law. Every session that touches authentication, subscriptions, payments, feature gates, or user tiers must read this file in full before writing a single line of code.**

---

## RULE 0: READ BEFORE YOU BUILD

Before writing ANY auth, payment, or gating logic, read these files in this exact order:

1. `SPECTRE_DESIGN_LAW.md` — visual law, all UI must follow it
2. `SPECTRE_REVENUE_LAW.md` — this file, business logic law
3. `src/hooks/useTier.js` — the single source of truth for user tier
4. `src/components/UpgradeModal.jsx` — the reusable gate component

If these files do not exist yet, your first task is to create them correctly before doing anything else.

---

## THE PRODUCT

**Spectre AI** — crypto, stocks, and AI intelligence terminal
- App: `app.spectreai.io`
- Token: `$SPECT`
- Contract: `0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6` (Ethereum)
- Team size: 7 (CEO, CTO Alaa, Frontend Evgeniy, 5 moderators)
- Monthly burn: ~$17-18K

---

## PART 1 — TIER SYSTEM

### The Four Tiers

| Tier | Monthly | Yearly | Token Threshold |
|---|---|---|---|
| FREE | $0 | $0 | 0–499 SPECT |
| PRO | $29/mo | $232/yr ($19.33/mo) | 1,000–6,999 SPECT |
| ELITE | $99/mo | $792/yr ($66/mo) | 7,000+ SPECT |
| INSTITUTIONAL | $499/mo | Custom | Not available via tokens |

Token holder label: instead of "Pro" or "Elite", show "Token Holder — Pro" or "Token Holder — Elite" so they understand the source of their access.

Starter tier (500–999 SPECT): same access as Pro, labeled "Token Holder — Starter". This is a soft tier — do not display it on the pricing page, only resolve it via wallet.

---

## PART 2 — TIER RESOLUTION LOGIC

**Priority order — always resolve in this exact sequence:**

```
1. Check for active Stripe subscription → use that tier
2. If no active Stripe subscription, check NOWPayments subscription → use that tier
3. If no paid subscription, check connected wallet SPECT balance:
   - 0–499    → Free
   - 500–999  → Starter (Pro-level access, Token Holder label)
   - 1,000–6,999 → Pro (Token Holder label)
   - 7,000+   → Elite (Token Holder label)
4. If no wallet connected and no subscription → Free
```

**The useTier() hook — this is the single source of truth:**

```js
// src/hooks/useTier.js
// Returns: { tier, source, spect_balance, subscription_end, loading }
// tier: 'free' | 'starter' | 'pro' | 'elite' | 'institutional'
// source: 'stripe' | 'nowpayments' | 'wallet' | 'none'

const { tier, source } = useTier()
```

Every single feature gate in the app calls `useTier()`. Nothing else. No hardcoded tier checks anywhere.

**Wallet balance check:**
- Read ERC-20 balance at contract `0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6`
- Cache balance in DB table `wallet_tiers`, refresh every 30 minutes
- If wallet disconnects, fall back to next priority (paid subscription or free)

---

## PART 3 — FEATURE GATE MATRIX

This is law. Do not change what is gated without updating this file first.

### FREE (no login required)
- Top Coins table: top 20 only
- Basic market overview (Fear & Greed, dominance)
- AI Search: 3 queries per day
- Intelligence Hub: public articles only
- Price charts: basic view

### REQUIRES LOGIN (Free tier with account)
- Top Coins table: top 100
- On-Chain: basic view
- Watchlist: up to 5 tokens
- AI Search: 10 queries per day

### PRO ($29/mo or 1,000 SPECT)
- AI Screener: full access
- AI Search: unlimited
- Prediction Markets: full access
- Watchlist: unlimited
- AI Brief Voice Mode (ElevenLabs)
- Whisper Search (voice queries)
- AI Agents: basic access
- Top Coins: full table
- On-Chain: full access
- Stocks: basic view

### ELITE ($99/mo or 7,000 SPECT)
- Everything in Pro
- Trading Terminal
- Deep Thesis reports
- AI Agents: full access including x402 payments
- Custom price alerts (email + Telegram)
- API key access
- AI Market Cap / AI Models: full table
- Stocks: full access including arbitrage detection
- AI Agents marketplace: full

### INSTITUTIONAL ($499/mo — no token equivalent)
- Everything in Elite
- Team seats: up to 10 users
- White-label widgets
- Data export (CSV, JSON)
- Priority support channel
- Custom intelligence reports
- Dedicated account manager

---

## PART 4 — GATE BEHAVIOR

When a user hits a gated feature:

1. **Do NOT redirect to another page.** Show a glass modal overlay inline.
2. **Do NOT show a hard block.** Show a preview (blurred or truncated) with the modal on top.
3. The UpgradeModal component receives: `{ feature, requiredTier, currentTier }`
4. Modal content:
   - Feature name (e.g. "AI Screener")
   - One-line value proposition (e.g. "Screen 10,000+ tokens with natural language")
   - What tier unlocks it
   - Two CTAs: "Upgrade to Pro — $29/mo" (primary, purple) + "I Hold SPECT Tokens" (ghost)
   - "I Hold SPECT Tokens" → triggers wallet connect flow inline, resolves tier immediately

**NEVER show the gate as:**
- A full page redirect
- A red error state
- A "you don't have access" message
- Anything that feels punitive

The gate should feel like an invitation, not a wall.

---

## PART 5 — AUTHENTICATION

### Method
- JWT-based authentication stored in httpOnly cookies
- Sessions expire after 30 days (refresh on activity)
- Passwords: bcrypt with salt rounds 12

### Auth Providers
- Email + Password (primary)
- Google OAuth
- X (Twitter) OAuth
- Wallet-only (no email required — wallet IS the identity)

### Routes
- `/auth` — sign in / create account (single page, two tabs)
- `/auth/forgot` — password reset
- `/auth/callback` — OAuth redirect handler
- All other protected routes redirect to `/auth?redirect=<original_path>`

### Post-auth flow
- After login: redirect to the page the user came from, not always /dashboard
- After signup: short onboarding — connect wallet (optional, skippable), choose interests (optional)
- After wallet connect: immediately resolve tier, show result as a glass toast

### Wallet Support
- MetaMask
- WalletConnect (covers Coinbase Wallet, Rainbow, etc.)
- Read-only: just balance check, no transaction signing required for tier resolution

---

## PART 6 — PAYMENT PROVIDERS

### Stripe (card payments)
- Use Stripe Checkout Sessions for simplicity and PCI compliance
- Do NOT use Stripe Elements (too much custom code to maintain)
- Products in Stripe:
  - `spectre_pro_monthly` — $29/mo
  - `spectre_pro_yearly` — $232/yr
  - `spectre_elite_monthly` — $99/mo
  - `spectre_elite_yearly` — $792/yr
  - `spectre_institutional_monthly` — $499/mo
- Webhook events to handle:
  - `checkout.session.completed` → activate subscription
  - `customer.subscription.updated` → update tier
  - `customer.subscription.deleted` → downgrade to Free
  - `invoice.payment_failed` → send email, grace period 3 days
- After payment: do NOT redirect to a new page. Return to /pricing with a success glass toast notification (bottom-right, 4 seconds).
- Subscription management: Stripe Customer Portal at `/settings/subscription`

### NOWPayments (crypto payments)
- Accept: BTC, ETH, USDC, USDT, SOL, $SPECT
- $SPECT payment: apply 10% discount automatically (Pro = $26.10/mo, Elite = $89.10/mo)
- Integration: NOWPayments hosted invoice (not embedded widget — simpler, more reliable)
- Webhook: `payment.finished` → same tier activation flow as Stripe
- Crypto payments are treated as monthly subscriptions (re-invoice each month via NOWPayments recurring API)
- On /pricing page: below each card's primary CTA, show a small "Pay with Crypto" text link in --text-muted
- Clicking opens a glass modal with the NOWPayments invoice link

### What NOT to add
- No other payment providers without updating this file first
- No in-app wallet transactions for subscription (wallet is for tier resolution only, not payment — except through NOWPayments flow)

---

## PART 7 — DATABASE SCHEMA

```sql
-- Core user table
users (
  id              UUID PRIMARY KEY,
  email           TEXT UNIQUE,
  password_hash   TEXT,
  display_name    TEXT,
  avatar_url      TEXT,
  wallet_address  TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  last_active_at  TIMESTAMP
)

-- Active subscriptions
subscriptions (
  id                        UUID PRIMARY KEY,
  user_id                   UUID REFERENCES users(id),
  tier                      TEXT,  -- 'pro' | 'elite' | 'institutional'
  provider                  TEXT,  -- 'stripe' | 'nowpayments'
  status                    TEXT,  -- 'active' | 'cancelled' | 'past_due' | 'grace'
  current_period_start      TIMESTAMP,
  current_period_end        TIMESTAMP,
  stripe_subscription_id    TEXT,
  stripe_customer_id        TEXT,
  nowpayments_invoice_id    TEXT,
  created_at                TIMESTAMP DEFAULT NOW()
)

-- Wallet tier cache
wallet_tiers (
  user_id           UUID REFERENCES users(id),
  wallet_address    TEXT,
  spect_balance     NUMERIC,
  resolved_tier     TEXT,  -- 'free' | 'starter' | 'pro' | 'elite'
  last_checked_at   TIMESTAMP,
  PRIMARY KEY (user_id, wallet_address)
)

-- API keys (Elite + Institutional only)
api_keys (
  id              UUID PRIMARY KEY,
  user_id         UUID REFERENCES users(id),
  key_hash        TEXT,
  name            TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  last_used_at    TIMESTAMP,
  active          BOOLEAN DEFAULT TRUE
)

-- Usage tracking (for Free tier limits)
usage_logs (
  id              UUID PRIMARY KEY,
  user_id         UUID REFERENCES users(id),
  feature         TEXT,  -- 'ai_search' | 'ai_screener' | etc.
  timestamp       TIMESTAMP DEFAULT NOW(),
  metadata        JSONB
)
```

---

## PART 8 — NAV STATES

The top nav right side resolves to one of these states — no others:

**Logged out:**
- Ghost button: "Sign In"
- Purple button: "Get Pro"

**Logged in — Free:**
- Avatar (initials if no photo)
- Badge: "FREE" — glass pill, --text-muted color
- Dropdown: Dashboard / Settings / Upgrade / Sign Out

**Logged in — Starter (token holder):**
- Avatar
- Badge: "STARTER" — glass pill, white text
- Dropdown: Dashboard / Settings / Manage Wallet / Sign Out

**Logged in — Pro:**
- Avatar
- Badge: "PRO" — glass pill, --accent (purple)
- Dropdown: Dashboard / Settings / Manage Subscription / Sign Out

**Logged in — Elite:**
- Avatar
- Badge: "ELITE" — glass pill, gold (#F59E0B)
- Dropdown: Dashboard / Settings / Manage Subscription / API Keys / Sign Out

**Logged in — Institutional:**
- Avatar
- Badge: "INSTITUTION" — glass pill, distinct silver/white
- Dropdown: Dashboard / Team / Settings / Manage Subscription / API Keys / Sign Out

The rewards claiming UI that already exists in the nav stays exactly as-is. Do not move it, restyle it, or touch it.

---

## PART 9 — PRICING PAGE (/pricing)

### Layout (top to bottom)

1. **Hero text** — "Intelligence without limits." Subline: "Join 14,000 token holders and traders on Spectre."
2. **Billing toggle** — Monthly / Yearly. Yearly shows "Save 33%" badge in --bull green.
3. **Four tier cards** — glass cards in a row (2x2 on mobile)
4. **Token holder banner** — full-width glass panel below cards
5. **FAQ accordion** — 5-6 questions, glass accordion component

### Tier card anatomy (same structure for all four)
```
[Tier name]          [MOST POPULAR badge — Pro only]
[Price] /mo          [Yearly price — small, --text-muted]
[One-line value proposition]
────────────────────
[Feature list — max 6 lines, checkmark icons from spectreIcons]
────────────────────
[Primary CTA button]
[Pay with Crypto — text link, --text-muted, small]
```

### Token holder banner
```
"Already hold $SPECT? You may already have Pro or Elite access."
[500 SPECT → Starter] [1,000 SPECT → Pro — $29/mo value] [7,000 SPECT → Elite — $99/mo value]
[Check My Wallet — purple CTA]
```
On wallet connect: resolve tier inline on the page. If they qualify, replace the banner content with:
"You have Elite access. You're all set." in --bull green. No redirect.

---

## PART 10 — SETTINGS PAGE (/settings)

Five tabs — build all five, do not skip any:

1. **Account** — display name, email, change password, delete account (danger zone at bottom)
2. **Subscription** — current tier, billing date, payment method, Stripe portal link or NOWPayments renewal info. If token holder: shows wallet address + balance + "your tokens give you X access"
3. **Wallet** — connect / disconnect. Shows SPECT balance with JetBrains Mono. Shows resolved tier. Refresh balance button.
4. **Notifications** — toggles: Email digest (weekly), Price alerts (when unlocked), AI Brief daily summary, Platform updates
5. **API Keys** — Elite + Institutional only. Generate key (with name), list active keys, revoke button. Keys shown once on creation, never again.

---

## PART 11 — CREDIT SYSTEM (Phase 2 — do not skip, build alongside payment)

Some features consume credits even on paid tiers to prevent abuse:

| Feature | Free | Pro | Elite |
|---|---|---|---|
| AI Search queries | 3/day | 100/day | Unlimited |
| Deep Thesis reports | 0 | 5/mo | Unlimited |
| AI Voice Briefs | 0 | 10/mo | Unlimited |
| Custom Alerts | 0 | 10 active | Unlimited |

Track usage in `usage_logs` table. Enforce limits server-side, not just client-side.

Credit gauge UI: thin arc gauge component in the dashboard sidebar showing monthly AI usage. Only visible to Pro tier (Elite shows "Unlimited"). Turns amber at 80% used, red at 95%.

---

## PART 12 — IMPLEMENTATION SEQUENCE

**Do not skip steps. Do not reorder. Each step must be complete before the next begins.**

```
Phase 1 — Foundation
1. DB schema creation (all 5 tables)
2. Auth backend: JWT, bcrypt, session management
3. /auth page: sign in + create account UI
4. Google + X OAuth integration
5. useTier() hook + tier resolution logic (wallet check comes later, wire stub first)
6. Top nav: logged out / logged in states

Phase 2 — Gating
7. UpgradeModal component (reusable, receives feature + requiredTier)
8. Apply gates to all features listed in Part 3
9. /pricing page: UI complete (no payments yet)

Phase 3 — Payments
10. Stripe: products, checkout session, webhook handler
11. NOWPayments: invoice creation, webhook handler
12. Payment success flow (toast notification, tier refresh)
13. Stripe Customer Portal link in /settings

Phase 4 — Wallet
14. MetaMask + WalletConnect integration
15. SPECT balance reader (ERC-20 balanceOf call)
16. wallet_tiers DB population + 30min refresh job
17. Tier resolution updated to include wallet path
18. "Check My Wallet" on /pricing page

Phase 5 — Polish
19. /settings page: all 5 tabs
20. Credit gauge component in dashboard
21. Usage tracking in usage_logs
22. API key generation (Elite/Institutional)
23. Onboarding flow after signup (wallet connect + interests)
```

---

## GOLDEN RULES

1. **useTier() is the only way to check tier.** Never hardcode tier checks anywhere else.
2. **Gates are invitations, not walls.** The UpgradeModal must look premium and feel like product, not paywall.
3. **Stripe for cards. NOWPayments for crypto. No others without updating this file.**
4. **Wallet = tier resolution only.** Wallet does not directly process payments (except through NOWPayments flow).
5. **Never redirect on payment success.** Always toast notification, stay on page.
6. **Server-side enforcement.** All tier gates must be checked server-side on API routes. Client-side gates are UX only.
7. **SPECT discount is always 10%** when paying via NOWPayments in $SPECT. No exceptions.
8. **Token holder tiers are never shown on the pricing page.** They are only revealed via wallet connect.
9. **Institutional is not available via tokens.** Period.
10. **Do not touch the existing rewards UI in the nav.** It is a separate system.
11. **Read both law files before every session.** SPECTRE_DESIGN_LAW.md + SPECTRE_REVENUE_LAW.md.
12. **If it doesn't match this document, it's wrong.** Update this file before deviating from it.
