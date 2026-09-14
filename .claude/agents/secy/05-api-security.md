# 05 - API security

APIs are now the primary attack surface for most modern apps. The 2023 OWASP API Security Top 10 is the canonical reference and the structure of this file follows it. ~40% of API attacks exploit BOLA alone; it's the single biggest API risk by a wide margin.

For Spectre with 335+ HTTP API endpoints across research, trading, dev-control, and the AI surfaces, this category is large.

---

## 5.1 API1:2023 - Broken Object Level Authorization (BOLA)

**Attack.** Endpoint takes an object ID. App verifies the user is authenticated but doesn't verify the user owns the object.

```
GET /api/articles/12345
GET /api/users/12345/portfolio
GET /api/orders/12345
DELETE /api/comments/12345
```

Change the ID. Get someone else's data.

**Real cases:**

- **Parler** (2021): post IDs were sequential, no authz. Entire site scraped via API, including geotagged photos from Capitol riot.
- **T-Mobile** (2018): API returned other users' account data when given their IDs. 2.3M users affected.
- **T-Mobile again** (2023): another API BOLA, 37M users affected. Same class, five years later.
- **Auto manufacturers** (recurring): mobile API for remote start/lock takes VIN; doesn't validate VIN belongs to logged-in user. Attackers control strangers' cars.

OWASP scores BOLA exploitability 3/3 (trivial) and impact 2/3 (typically high but variable). It is the highest-ranked API risk.

**Detection.** Audit every endpoint that takes any kind of ID in the path, query, or body:

```bash
rg -En 'router\.(get|post|put|patch|delete)\([\"'\''`].*:(id|userId|orderId|.*Id)' src/
```

For each handler, verify it does an authz check before responding. Specifically, the check must be:

```js
// not just authentication
if (!req.user) return res.status(401).end()

// but ALSO authorization of THIS user on THIS object
const article = await db.articles.findUnique({ where: { id } })
if (!article) return res.status(404).end()
if (article.authorId !== req.user.id && !req.user.isAdmin) {
  return res.status(403).end()  // or 404 to avoid enumeration
}
```

**Fix.**

- **Authorization check on every object access.** Not just authentication.
- **Centralize.** A `can(user, action, object)` function used everywhere. Avoid duplicated per-route logic that drifts.
- **Use scoped queries.** `db.articles.findFirst({ where: { id, authorId: req.user.id } })` returns null if not owned. No separate check needed.
- **Indirect references.** Per-session opaque IDs (UUIDs that don't map directly to DB rows) raise the bar. Doesn't fix authz, but defeats enumeration.
- **Test.** For every protected endpoint, automated test: user A authenticates, requests user B's object, expects 403/404. CI runs this on every PR.

OWASP notes that comparing the user ID in the JWT to the ID in the URL is *not sufficient* - "in the case of BOLA, it's by design that the user will have access to the vulnerable API endpoint/function. The violation happens at the object level." Verify the object's *owner*, not just that the ID in the token matches the ID in the URL.

---

## 5.2 API2:2023 - Broken Authentication

Catch-all for weak login, weak tokens, weak password policy. Most of this is in `03-auth-and-session.md`. API-specific patterns:

- **No auth on read endpoints that should require it.** "Anyone can list public articles" creeps to "anyone can list users".
- **Tokens in URL query strings.** Logged in proxies, browser history, referrer headers. Use Authorization header or HttpOnly cookies.
- **Missing rate limits on auth endpoints.** Per-IP and per-account; see `01-network-and-availability.md`.
- **Long-lived API keys.** A leaked API key with no expiry is a permanent backdoor. Use short-lived access tokens with refresh rotation, or scoped tokens with revocation.
- **Predictable token generation.** Tokens must use CSPRNG, not `Math.random()` or sequential.
- **No MFA on privileged operations.** API endpoints that issue large transfers, change account email, delete data - gate behind a step-up auth (re-prompt for password or MFA).

---

## 5.3 API3:2023 - Broken Object Property Level Authorization (BOPLA)

Merged "Excessive Data Exposure" and "Mass Assignment" because both are property-level authz bugs.

**Two flavors:**

### Excessive data exposure (read side)

API returns more fields than the client should see. Client filters them out for display, but they're in the JSON response, visible in DevTools or a curl.

```js
// returns the whole user object, including hashed_password, email_verified, mfa_secret
res.json(user)
```

Even if the React UI only renders `user.name`, the password hash is in the network response.

**Fix.** Explicit field selection on every response.

```js
res.json({
  id: user.id,
  name: user.name,
  avatar: user.avatar
})
```

Or use a serializer (Pydantic, Marshmallow, class-transformer, Zod) with explicit allow-lists.

### Mass assignment (write side)

App passes the request body directly into an ORM update.

```js
// BROKEN
await db.users.update({ where: { id: req.user.id }, data: req.body })
// Attacker sends { "isAdmin": true } in the body
```

Object-relational mapping with whole-body assignment is the bug. The user can write fields they shouldn't be allowed to write.

**Real cases:**

- Ruby on Rails was famous for this in the early 2010s ("strong parameters" was added as a defense).
- 2022 GitHub: mass assignment on a profile endpoint allowed users to grant themselves admin permissions on certain orgs.
- Ongoing class; happens whenever someone uses `Object.assign(record, req.body)` without filtering.

**Fix.** Explicit allow-list on writes:

```js
const { name, avatar } = req.body
await db.users.update({ where: { id: req.user.id }, data: { name, avatar } })
```

Or use a schema validator that rejects unknown fields (Zod's `.strict()`, Joi's `unknown(false)`).

---

## 5.4 API4:2023 - Unrestricted Resource Consumption

**Attack.** Endpoint that consumes server resources (CPU, memory, DB I/O, AI inference cost, third-party API costs) with no limits.

Examples:

- `GET /api/articles?limit=1000000` - pagination not enforced, DB load
- `POST /api/upload` - accepts 5GB files, fills disk
- `POST /api/ai/generate` - runs AI inference, costs $0.10 per request to your provider
- `GET /api/search?q=expensive&depth=20` - N+1 query that joins 1000 tables
- `POST /api/email-preview` - renders HTML from user-controlled template, eats CPU

**Real cases:**

- "Billion laughs" XML bomb (XXE adjacent): nested entities expanding to billions of characters.
- ReDoS-by-API (see `02-injection-attacks.md`).
- LLM cost-bomb: tens of thousands of long-context inference requests from a single attacker run up a five-figure bill before rate limits kick in.

**Fix.**

- Hard limits on request size, response size, query complexity.
- Per-user, per-IP, per-endpoint rate limits. Tiered by endpoint cost.
- Pagination required and capped (max page size 100, default 25).
- Timeouts on every operation. Reject requests that exceed.
- For AI inference: per-user token budgets, per-day caps, billing alarms.
- Pre-compute and cache expensive results. Serve from cache.

For Spectre's LLM agents specifically, every inference endpoint must have:

```
Rate limit: 30 requests/min per user, 10/min per IP
Token cap: 4000 input + 2000 output, configurable per agent
Daily cap: 100 requests/user/day on free tier, 1000 on paid
Cost alarm: alert if daily spend > $X
```

---

## 5.4.1 Free upstream proxy abuse (API farming)

A high-value specialization of API4:2023 specific to apps that frontend a paid upstream service (LLMs, market data APIs, on-chain RPCs, news feeds). The attack class isn't in the OWASP catalogue by name but is the most common monetization path for stolen API access in 2024-2026.

**Attack.** Attacker opens DevTools on the public app, notes every `/api/*` URL it hits, tests each from `curl` to see which respond without auth, wraps the working ones into their competing dashboard. Spectre's serverless functions become a free proxy to Codex Pro, Anthropic, Groq, CoinGecko Pro etc. Spectre pays the bill, attacker keeps the subscription revenue.

**Why this is harder to detect than classic resource exhaustion:**

- Each individual call looks legitimate (real residential IP, real Origin header from attacker's frontend, real referer)
- Total volume can be calibrated below your existing IP rate limits if attacker uses a botnet or residential proxies
- Upstream bills look normal-shaped (steady growth, not spiky)
- The "users" appear in your PostHog as a different population than the attacker's app's user count, but only if you look

**Real cases:**

- Sprocket Security (2024) documented dashboard farming uncovering ~$50K/month attacker revenue against a defi analytics platform via three unauthenticated proxy endpoints
- Multiple TikTok/Douyin backends were farmed via undocumented `/aweme/v1/feed/` for two years before mitigations
- The pattern is now the standard playbook for crypto-dashboard knockoffs that ship in days rather than months

**Detection.** Five patterns to grep for in your serverless functions:

```bash
# Proxy handlers that fetch upstream paid APIs
rg -nE 'fetch\(.*(\$\{|\+)?(CODEX|GROQ|ANTHROPIC|OPENAI|HELIUS|COINGECKO|MORALIS|BIRDEYE)' apps/*/api/

# Handlers without isAuthGateValid AND without verifyPrivyToken
rg -L 'isAuthGateValid|verifyPrivyToken' apps/*/api/_lib/handlers/

# Handlers without rate limit calls
rg -L 'rateLimit\(|userRateLimit\(' apps/*/api/

# EventSource / SSE handlers (compound: free quota + slowloris)
rg -n 'text/event-stream' apps/*/api/

# User-controlled URL fragments forwarded upstream
rg -n 'fetch\(.*\+\s*req\.(query|body|params)' apps/*/api/
```

**Fix.** Every proxy endpoint that hits a paid upstream needs ALL of:

1. **Server-verified per-user identity** (`verifyPrivyToken` extracting Privy userId from `Authorization: Bearer <jwt>`). Auth-gate cookie is NOT enough - it's a shared team password, replayable across users.
2. **Per-user rate limit** (`userRateLimit(res, { bucket, userId, max, windowMs })`). Per-IP-only is botnet-defeated.
3. **Body size cap** (POST/PUT) - reject `req.body` payloads above ~16 KB. Prevents amplification attacks where attacker POSTs 10 MB to drain upstream quota faster.
4. **Strict allowlist on user-controlled path/query fragments** that get forwarded upstream (e.g. `req.query.path` -> upstream URL). Use a fixed enum, not a regex.
5. **HTTPS-only upstream URL** (no `http://204.168.244.18:3850` fallback - MITM risk).
6. **No upstream provider/model name in client response metadata** - don't tell scrapers which paid API you're consuming.
7. **Idle timeout on SSE handlers** - 30s max regardless of activity. Otherwise slowloris drains your Vercel function concurrency limit.

**Severity rubric specific to API farming.**

| Signal | Severity |
|--------|----------|
| Open (no auth) + expensive upstream ($$$+ LLM, paid market data) + high scrape value | **P0** |
| Auth-gate cookie only + expensive upstream | **P0** (cookie is shared team password, treat as open) |
| Open + cheap upstream (free public API like Binance public, Yahoo) + high scrape value | **P1** |
| Per-user Privy verified + per-user rate limited | **clean** - no finding |

**Spectre-specific instances (as of 2026-05-16):**

- See `MEMORY.md` section A entries `SEC-20260516-001..004` (4 P0 individuals) and `SEC-20260516-API-FARM-001` (sweep over 8 P1/P2 endpoints).
- Legacy instances: `SEC-20260513-RT-02` (brain-chat-stream-proxy), `SEC-20260513-RT-05` (onchain-path body proxy), `SEC-20260513-RT-08` (SSE slowloris), `SEC-20260513-006` (monarch-chat no RL).
- Pattern-library row: `MEMORY.md` section D "Serverless function forwarding `req` to upstream paid API...".
- Stack-quirk: `MEMORY.md` section F documents that only `apps/{research,trading}/api/swap.js` have proper per-user gating; everything else is at risk.

**When auditing a NEW proxy handler, require BOTH `verifyPrivyToken` AND `userRateLimit` before approving the merge.** Auth-gate cookie alone is not auth for farming-class attacks.

---

## 5.5 API5:2023 - Broken Function Level Authorization (BFLA)

**Attack.** Admin or privileged function exposed at a discoverable URL with no authz check beyond authentication.

```
POST /api/admin/delete-user
POST /api/internal/sync
DELETE /api/articles/12345/force-delete
```

A regular authenticated user finds the URL (via JS file, leaked docs, guess) and calls it. Server checks they're logged in, doesn't check they're admin.

**vs. BOLA:** BOLA is object-level (this user shouldn't access *this* object). BFLA is function-level (this user shouldn't access *this endpoint*).

**Fix.**

- Role check on every privileged endpoint:
  ```js
  if (!req.user.isAdmin) return res.status(403).end()
  ```
- Better: deny by default, allow specific roles per route.
- Don't rely on the frontend hiding the admin UI. Admin endpoints must enforce server-side.
- Don't put admin routes under `/admin/*` and assume the URL is secret. Treat them like any other endpoint.

---

## 5.6 API6:2023 - Unrestricted Access to Sensitive Business Flows

**Attack.** API exposes a business flow (account creation, comment posting, purchase, voting, vote-changing) without restrictions appropriate to the business value of the flow.

Examples:

- Account creation with no CAPTCHA or rate limit → mass fake account creation.
- Voting / "like" with no per-user rate limit → vote stuffing.
- Trading API with no max-position-per-second → market manipulation.
- Referral signup with no anti-fraud → referral fee abuse.
- AI chat without per-user limits → cost abuse, also content moderation issues.

**Real cases:**

- Ticket scalping bots that hit purchase endpoints faster than humans.
- Twitter bot floods. Endlessly.
- Crypto airdrop farming via thousands of wallets created programmatically.

**Fix.**

- Model the business flow. What's the legitimate rate? What's the abusive rate? Set limits in between.
- Bot management (Cloudflare Turnstile, Bot Management). Distinguishes humans from automated clients.
- Device fingerprinting for high-value flows (signup, purchase).
- Phone/email verification before privileged operations.
- Anomaly detection: account that just signed up making 100 trades is suspicious.

---

## 5.7 API7:2023 - Server Side Request Forgery (SSRF)

Promoted to its own slot in 2023. In OWASP Top 10 2025 (web), SSRF got folded into A01 (Broken Access Control). It remains a distinct category in the API list.

**Attack.** API takes a URL from the user and the server fetches it. Attacker points it at:

- `http://169.254.169.254/latest/meta-data/` (AWS metadata service) → cloud creds
- `http://localhost:6379/` (internal Redis) → cache contents
- `http://10.0.0.5/admin` (internal admin) → admin access
- `file:///etc/passwd` (if scheme is unrestricted)
- `gopher://10.0.0.5:25/` (if scheme allows) → SMTP relay abuse

**Common SSRF entry points:**

- Webhook URL config endpoints
- Image proxy endpoints
- URL preview generators (chat apps, link unfurling)
- OAuth callback URLs
- PDF generators (HTML to PDF, often via headless Chrome)
- SVG processors
- "Test the integration" endpoints
- File upload via URL ("import from URL")

**Real cases:**

- Capital One 2019: SSRF on an AWS-hosted firewall app → IMDS → IAM credentials → 100M customer records.
- Recurring in low-code platforms, integration testing tools, and admin features.

**Fix.**

- Allowlist destinations by scheme (`https://` only), domain (specific partners), and IP (resolve DNS yourself, reject private ranges).
- Reject these IP ranges:
  - `127.0.0.0/8`, `0.0.0.0/8` (localhost)
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918 private)
  - `169.254.0.0/16` (link-local, includes IMDS)
  - `fc00::/7`, `::1/128` (IPv6 private)
  - Cloud-specific metadata IPs (`metadata.google.internal` for GCP, etc.)
- Block redirects, or re-validate after each redirect (attacker might allow https://attacker.com that 302s to http://169.254.169.254).
- AWS: use IMDSv2 (token-based). It defeats most SSRF against the metadata service.
- Run URL-fetching services in a separate VPC subnet with no internal access. The service can talk to the internet but not to your databases.
- Output filter: even if the fetch succeeds, don't return the raw response body to the user.

---

## 5.8 API8:2023 - Security Misconfiguration

Catch-all. Headers, default credentials, exposed admin panels, debug endpoints in prod, verbose error pages, unnecessary features enabled.

For Spectre, the highest-impact items:

- **CORS misconfiguration.** `Access-Control-Allow-Origin: *` with credentials is broken. Reflecting `Origin` blindly is also broken. Hardcoded allowlist.
- **Missing security headers.** See checklist in `SKILL.md`. CSP, HSTS, X-Frame-Options, etc.
- **Debug endpoints.** `/debug`, `/.well-known/debug`, `/swagger`, `/__inspect`, `/health?verbose=true`. Disable in prod or auth them.
- **Verbose errors.** Stack traces in HTTP responses. Replace with generic error + log the details server-side.
- **Default credentials.** Default admin/admin on any installed component.
- **Unused features.** WebDAV, OPTIONS verbs that aren't needed, old API versions still routed.

---

## 5.9 API9:2023 - Improper Inventory Management

**Attack.** Old API versions still served. Deprecated endpoints still routed. Staging APIs accessible from prod. Undocumented endpoints exist because someone deployed them once and forgot.

Why it matters: old endpoints often have the bugs that the current version fixed. Attacker finds `/v1/users` after `/v2/users` got hardened.

**Detection.**

- Inventory of every routed endpoint. From source code, not from docs. (Real endpoints, not intended endpoints.)
- Compare deployed routes against your OpenAPI spec.
- Sweep for common version-prefixed paths: `/v0`, `/v1`, `/v2`, `/api/old`, `/api/legacy`.

**Fix.**

- Sunset policy: any non-current version goes away after N months.
- Automated detection of deviation between code and OpenAPI spec.
- Don't expose staging at all from prod DNS. `staging.spectreai.io` should be Cloudflare-Access protected.

---

## 5.10 API10:2023 - Unsafe Consumption of APIs

**Attack.** Your API trusts a third-party API's response. Third party gets compromised; their response now contains injection, malformed data, or malicious URLs. Your app passes it through to users.

Examples:

- Calling a CoinGecko-like price API and trusting whatever HTML they return without sanitizing.
- Trusting that a webhook from Stripe is from Stripe (no signature verification).
- Following redirect chains from third-party APIs without re-validating destinations.

**For Spectre with the AI provider stack (Groq, Anthropic, OpenAI, Perplexity):**

- Treat LLM output as untrusted. Don't pass it directly to `dangerouslySetInnerHTML` or `eval`. Don't pass it as a SQL query parameter without validation. Don't trust JSON that an LLM emits without schema validation.
- Verify webhook signatures from every provider. Stripe, Privy, Vercel, GitHub - all sign webhooks. Validate the signature server-side before processing the payload.
- Time-box requests to third parties. If Groq is down, don't hang user requests forever; fall back or error.
- Validate response shape: schema check every response, treat unexpected fields as a signal of trouble.

---

## 5.11 GraphQL-specific risks

GraphQL has its own attack surface beyond REST equivalents.

- **Introspection in production.** Lets attackers map your entire schema. Disable in prod (`introspection: false` in Apollo).
- **Batching.** Send N queries in one request, bypass per-request rate limits. Limit batch size or rate-limit by query cost.
- **Depth attacks.** Deeply nested queries explode in cost. `graphql-depth-limit` library.
- **Complexity attacks.** Expensive resolvers (especially with many `__connections`). `graphql-query-complexity` or `graphql-cost-analysis`.
- **Field suggestions on typos.** When a field doesn't exist, GraphQL helpfully suggests the closest match. This leaks schema even with introspection off. Disable in prod.
- **Aliases enabling batched mutations.** Same mutation 1000 times in one query. `mutation { a: createUser(...) b: createUser(...) c: createUser(...) ... }`. Rate limit by mutation count, not request count.
- **Subscriptions for amplification.** WebSocket subscription with no limits eats resources. Limit subscriptions per user.

If Spectre uses GraphQL anywhere, all of the above apply.

---

## 5.12 Webhook security

Webhooks are inbound HTTP calls from third parties (Stripe, Privy, GitHub, etc.). Attacks:

- **Forged webhooks.** Attacker sends a request to your `/webhooks/stripe` endpoint pretending to be Stripe. If you don't verify, you process fake payment events.
- **Replay attacks.** Attacker captures a real webhook and replays it. If you don't track delivery IDs and reject replays, you double-process.
- **Timing windows.** Webhook arrives before the related DB update; your handler queries a not-yet-existing record. Use idempotency keys and retry.

**Fix.**

- HMAC signature verification. Every provider publishes how.
- Reject events older than 5 minutes (timestamp in signature header).
- Deduplicate by event ID. Idempotency keys.
- Log every webhook for forensics.

```js
// Stripe webhook handler
const sig = req.headers['stripe-signature']
let event
try {
  event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
} catch (err) {
  return res.status(400).send(`Webhook signature failed`)
}
// safe to process event here
```

---

## 5.13 Spectre-specific API audit checklist

For the 335+ HTTP endpoints, sample 20 randomly and verify each:

- [ ] Authenticated where appropriate
- [ ] Authorization on the object level (BOLA)
- [ ] Response includes only fields the user should see (BOPLA read)
- [ ] Request body has explicit field allow-list (BOPLA write)
- [ ] Rate limited per user and per IP
- [ ] Inputs validated against schema (Zod, Joi, Pydantic)
- [ ] No tokens in URL parameters
- [ ] Webhook signatures verified
- [ ] Error responses don't leak stack traces or internal info
- [ ] Documented in OpenAPI spec

For the conversational AI surfaces (the 4 of them):

- [ ] Per-user rate limit on prompts (count and tokens)
- [ ] Per-user cost cap with billing alarm
- [ ] Prompts are not constructed by concatenating untrusted input into instructions (see `08-ai-llm-attacks.md`)
- [ ] Tool calls authorized server-side, not on agent assertion
- [ ] Output is treated as untrusted (no eval, no DOM injection)

---

## 5.14 Quick API audit commands

```bash
# Find all routes
rg -En 'router\.(get|post|put|patch|delete)|app\.(get|post|put|patch|delete)' src/ > /tmp/routes.txt

# Find routes that take IDs
grep -E ':id|:userId|/:|.+Id\b' /tmp/routes.txt

# Find routes that don't pass through an auth middleware
# (this is approximate - verify per route)
grep -v -E 'requireAuth|authenticate|isAuthenticated' /tmp/routes.txt

# Find any response that returns a full DB object
rg -n 'res\.(json|send)\(user\)|res\.(json|send)\(article\)|res\.(json|send)\(record\)' src/

# Find req.body passed directly into a DB call
rg -n 'db\..+\..*\(req\.body\)|update.*data:\s*req\.body|create.*data:\s*req\.body' src/

# Find URL parameters that look like sensitive data
rg -n '\?.*token=|\?.*key=|\?.*secret=|\?.*password=' src/
```

---

## 5.15 Further reading

- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x00-header/
- OWASP API Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- GraphQL Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html
- Salt Security BOLA analysis: https://salt.security/blog/api1-2023-broken-object-level-authentication
- HackerOne hacktivity (real bug bounty reports, very educational): https://hackerone.com/hacktivity
