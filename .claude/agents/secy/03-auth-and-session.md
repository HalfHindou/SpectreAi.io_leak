# 03 - Authentication and session

The category that bit Spectre dev-control. The exact mechanisms that fail are well-documented and well-defended; the failures keep happening because shortcuts are easy and the consequences are delayed.

## 3.1 Client-side authentication bypass

This is the Spectre breach pattern. Read this section even if it feels obvious.

**Attack.** Login state is held in client memory or localStorage. Attacker opens DevTools, writes `isAuthenticated: true` or flips a Zustand store value, and the route guard lets them through. Or attacker reads the source bundle, finds the hardcoded password, and just logs in.

**Why it keeps happening.** Developers write the gate in the part of the code they know (React) before they write the part they don't (edge middleware or backend auth). The intention is to "add real auth later." Later doesn't come.

**Detection.**

```bash
# the patterns
grep -rEn "isAuthenticated|isLoggedIn|hasAccess|isAdmin" src/ | grep -i "useState\|zustand\|store\|local"
grep -rEn "localStorage\.(set|get)Item.*auth" src/
grep -rEn "<.*Gate.*>|RequireAuth|ProtectedRoute|LoginGate" src/

# hardcoded password fallbacks
grep -rEn '\|\|\s*[\"'\''][A-Za-z0-9!@#$%^&*()_+]{6,}[\"'\'']' src/
```

If a route guard makes its decision from a client-side store with no server check, the gate is broken.

**Fix.**

- Move the check to edge middleware. On Vercel/Next.js:
  ```js
  // middleware.js
  import { NextResponse } from 'next/server'
  export async function middleware(request) {
    const session = request.cookies.get('session')?.value
    if (!session || !(await verifySession(session))) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }
  export const config = { matcher: ['/((?!_next|favicon|public|api/auth).*)'] }
  ```
- For pure SPAs without middleware: put the gate at the CDN. Cloudflare Access policy on the route, or Vercel Password Protection. Both enforce at the edge.
- For internal team tools: Cloudflare Access with SSO (Google Workspace, GitHub). The browser literally cannot reach the app without an Access cookie. This is what dev-control should have had from day one.
- Backend APIs must independently verify auth on every request. Don't rely on the frontend having done the check.

**Spectre action items:** verify research, trading, and dev-control all have edge auth (not just the React gate). Spot-check by trying to fetch a protected page with curl, no cookies:

```bash
curl -sI https://research.spectreai.io/protected | head -1  # should be 401 or 302, not 200
```

---

## 3.2 Password handling

**Attack surface:**

- Plain text storage (still happens; recent breach examples in mid-2025).
- Weak hashes (MD5, SHA-1, SHA-256 without stretching).
- Hash-only without salt: rainbow tables.
- Same salt for everyone: rainbow tables still work.
- Stretching too low: brute force.
- Hashes in audit logs, debug logs, error reports.

**Fix.**

- Use a memory-hard KDF designed for password hashing:
  - **Argon2id** (preferred, OWASP recommendation)
  - **scrypt** (acceptable)
  - **bcrypt** (acceptable; cost factor 12+)
  - PBKDF2 only if you have a compliance requirement that mandates it (NIST), with 600,000+ iterations for SHA-256.
- Never roll your own. Use the library implementation.
- Per-user random salt, library handles this for you.
- Pepper (extra secret added to all passwords before hashing) is optional. Adds complexity; useful only if your DB might leak but your secret store won't.

**Password policy:**

- Min 12 characters. NIST 800-63B updated guidance: length over composition rules.
- No mandatory complexity rules. Length and uniqueness are what matter.
- No mandatory periodic rotation (NIST: forced rotation produces weaker passwords).
- Check against breach corpus on registration (haveibeenpwned k-anonymity API).
- Block top-1000 passwords list.
- No SMS-only 2FA for high-value accounts (SIM swap).

**On reset.** Don't tell the user "user not found"; that enumerates accounts. Send the email either way. Time the response identically. Tokens are single-use, short-lived (15 min), high-entropy, sent only via email link (not as a code in the response).

---

## 3.3 Multi-factor authentication (MFA)

**Hierarchy of strength:**

1. **Phishing-resistant MFA: hardware security keys (YubiKey, FIDO2/WebAuthn).** Use these for registrar, GitHub, Vercel, npm, Cloudflare, AWS root, email tied to those.
2. **TOTP (authenticator apps): Google Authenticator, 1Password, Authy.** Acceptable for most users.
3. **Push-based MFA (Duo, Okta Verify).** Convenient but vulnerable to "MFA fatigue" attacks: attacker spams pushes until user clicks accept. Use number-matching variant.
4. **SMS.** Bypassable via SIM swap. Avoid for high-value accounts.
5. **Email.** Only as a secondary factor on accounts where email is itself well-protected.

**MFA bypass attacks:**

- **MFA fatigue / push bombing.** As above. Number matching defeats it.
- **Adversary-in-the-middle (AiTM) phishing.** Tools like Evilginx2 proxy the real login page; user enters credentials and TOTP, attacker steals the session cookie. Defeats TOTP and push. **WebAuthn defeats this** because the cryptographic challenge is bound to the origin.
- **SS7 / SIM swap.** Defeats SMS.
- **Backup code abuse.** If backup codes are stored insecurely (cloud notes, email), the backup is the weakest link.

**For Spectre:**

1. All founders + core devs on YubiKey for: GitHub, Vercel, npm (if you publish), Cloudflare, registrar, Google Workspace, AWS/GCP.
2. TOTP for everything else.
3. No SMS-only MFA on anything that matters.
4. Backup codes printed and stored in a safe, not in a password manager that may itself be compromised.

---

## 3.4 Session management

**The session lifecycle:**

1. User authenticates → server generates a session ID (high entropy, ≥128 bits, CSPRNG).
2. Server stores session state (Redis, DB, signed JWT) keyed by session ID.
3. Server sends session ID to client in cookie with `HttpOnly Secure SameSite=Lax`.
4. Client sends cookie on each request.
5. Server validates session, refreshes timestamp.
6. On logout, server deletes the session, client cookie expires.

**Attacks on the lifecycle:**

- **Session fixation.** Attacker sets a known session ID on the victim before login. After login, the attacker uses the same ID. Fix: rotate session ID on login.
- **Session hijacking.** Attacker steals a valid session ID (XSS, network sniff, malware on client). Fix: HttpOnly cookies, Secure (HTTPS only), short lifetime, refresh tokens.
- **Cookie theft via XSS.** localStorage tokens are worse: any script can read them. Cookies with HttpOnly cannot be read by JS. See `04-storage-and-secrets.md`.
- **Inadequate logout.** Logout deletes the cookie but server-side session is still valid. Attacker who copied the cookie before logout still has access. Fix: server-side invalidation on logout.
- **Session sliding without bound.** Session expires every hour but auto-refreshes on each request, so a stolen session lives forever. Fix: hard maximum lifetime (e.g., 7 days), require re-auth after.
- **Concurrent session abuse.** User signs in from many places; one compromise persists. Fix: device list with revocation in user settings.

**Cookie configuration:**

```
Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600
```

`SameSite=Strict` blocks cross-site navigations from sending the cookie. Stricter, but breaks legitimate flows like SSO. `Lax` is the right default for most apps.

`Path=/` makes the cookie visible to the whole origin. Don't broaden `Domain` unless necessary.

Don't set sensitive data in the cookie value; only an opaque session ID. The state lives server-side keyed by the ID.

---

## 3.5 JWT mistakes

JWTs are popular and easy to misuse. The patterns:

**Common bugs:**

- **`alg: none` accepted.** Older libraries treat the algorithm field as advisory. Attacker sets `alg: none`, no signature, library accepts. Fix: hardcode the algorithm in your verify call.
- **HS/RS key confusion.** App expects RS256 (asymmetric, public key in verifier). Attacker signs an HS256 (symmetric) token using the public key as the secret. Library that auto-detects from the header verifies it. Fix: pin algorithm.
- **No expiry, or 1-year expiry.** Token is a long-lived credential. Steal once, use forever. Fix: short access tokens (5-15 min), refresh tokens with rotation.
- **Sensitive claims in payload.** JWT payload is base64, not encrypted. Don't put PII, secrets, or anything sensitive in it.
- **Storing JWTs in localStorage.** XSS-stealable. Use HttpOnly cookies, or a backend-for-frontend pattern.
- **No `aud` or `iss` validation.** Token from one service accepted by another. Fix: validate `aud` and `iss` on every verify.
- **Weak HS256 secret.** If you use HS256, the secret must be strong (≥256 bits of entropy). HS256 with `secret` or `password123` is broken.
- **JWT replay.** No `jti` (token ID) tracking, no revocation. Logout doesn't revoke. Fix: short-lived access tokens, refresh token rotation with jti tracking.

**Use a well-maintained library** with secure defaults: `jose` (Node.js), `python-jose` or `PyJWT` (Python), `golang-jwt/jwt` (Go). Pin the algorithm. Validate all standard claims.

**Alternative: don't use JWTs for sessions.** They're great for service-to-service. For user sessions, an opaque session ID stored in Redis is simpler, revokable, and avoids these classes of bug.

---

## 3.6 OAuth and OIDC

**Patterns that go wrong:**

- **Missing or unvalidated `state` parameter.** Allows CSRF on the OAuth callback. Attacker tricks user into authorizing the attacker's account; victim's clicks now write to attacker's account.
- **Open redirect on `redirect_uri`.** OAuth provider redirects to attacker-controlled URL with the authorization code in the fragment. Attacker exchanges the code for a token. Fix: strict `redirect_uri` allowlist on the provider side.
- **Authorization code stolen via referrer leak.** Code in URL leaked to third-party JS, analytics, browser extensions. Fix: PKCE (Proof Key for Code Exchange).
- **Implicit flow with access token in URL fragment.** Token leaks to browser history, referrer headers. Implicit flow is deprecated; use authorization code + PKCE.
- **Mixing up auth and authz.** OAuth is authorization, not authentication. OIDC layers authentication on top. If you use OAuth scopes as authentication, you'll get edge cases wrong. Use OIDC for "who is this user".
- **Token leakage via logging.** Access tokens in CloudWatch, Datadog, server logs. Tokens have value; treat them as secrets.
- **Skipping signature verification on ID tokens.** ID tokens are JWTs; same JWT bugs apply.

**For Spectre with Privy:** Privy handles most of this. Things to verify:

- Privy session tokens are HttpOnly cookies (not localStorage; check this in production)
- Privy webhook signatures are verified before processing
- Your backend independently verifies Privy session tokens, doesn't just trust them
- No exposed Privy admin API keys

---

## 3.7 Password reset flow

The password reset endpoint is high-value: it's authenticated-by-knowledge-of-token, and the token comes via email. Attacks:

- **Token enumeration.** Sequential or low-entropy tokens. Fix: 256-bit CSPRNG random.
- **Token persistence.** Token works for 30 days. Fix: 15-minute expiry, single-use.
- **Token in URL leaked via referrer.** External resource on the reset page sees the URL. Fix: set `Referrer-Policy: no-referrer` on reset pages.
- **Account enumeration via response or timing.** "User not found" vs "Email sent". Fix: always say "if an account exists, we sent an email", and time the responses identically.
- **Host header injection** (covered in `02-injection-attacks.md`). Fix: hardcode the link domain.
- **Password reset by phone number** without proving phone ownership across recovery flows. Fix: don't bypass MFA on reset.
- **Race condition between token generation and email send.** Token observable in logs before email reaches user. Tighten.

---

## 3.8 IDOR (Insecure Direct Object Reference)

**Attack.** App returns an object based on an ID in the request URL, body, or query string, but doesn't check that the authenticated user is allowed to see that object.

```
GET /api/orders/12345
# Returns order 12345, regardless of which user is logged in
```

Change `12345` to `12346`, get someone else's order. This is the classic "horizontal privilege escalation."

OWASP API1:2023 (Broken Object Level Authorization, BOLA) is the API-flavored version. See `05-api-security.md` for depth.

**Detection.** Audit every endpoint that takes an ID. Verify the handler checks `object.owner_id === current_user.id` or equivalent.

**Real cases:** Parler used sequential post IDs with no auth → entire site scraped. T-Mobile had API endpoints that returned other users' data when given their IDs (2018, then again 2023). Facebook had a BOLA in 2024 allowing attackers to delete other users' posts.

**Fix.**

- Authorization check on every object access. Not just authentication.
- Use indirect references where possible: per-session opaque IDs, not DB primary keys. Doesn't fix the bug; raises the bar.
- Centralize authz: a single `can_access(user, object, action)` function used everywhere.
- Test: for every protected endpoint, have an automated test that confirms a different user gets 403/404.

---

## 3.9 Account enumeration

**Attack.** App reveals whether a given email or username exists. Used for:
- Targeted phishing (now I know who's a customer)
- Credential stuffing (try a known-leaked password against confirmed accounts)
- Account takeover (combine with a weak reset flow)

**Sources of enumeration:**
- Login error messages ("User not found" vs "Wrong password")
- Registration ("Email already in use")
- Password reset ("No account with that email")
- Response timing (longer for valid emails)
- Public profile URLs that 200 for valid users and 404 otherwise

**Fix.**

- Generic messages: "Invalid credentials" everywhere.
- Same response time for valid and invalid (you may need artificial delay).
- For registration: send a confirmation email; the response is the same whether the email is new or already registered. ("Check your inbox.")
- For public profiles: return 200 with "user not found" page if you must, indistinguishable from a private profile.

---

## 3.10 Brute force and credential stuffing

**Attack.**

- **Brute force.** Try many passwords against one account.
- **Credential stuffing.** Try one (email, password) pair from a breach against many sites. Far more effective in practice because users reuse passwords.
- **Password spraying.** One common password against many accounts. Bypasses per-account lockout.

**Fix.**

- Rate limit per-IP, per-account, per-user-agent. Don't only do per-IP; attackers rotate.
- Cloudflare Bot Management or Turnstile on the login form.
- haveibeenpwned k-anonymity check on registration and password change.
- MFA. Defeats stuffing entirely if enabled.
- Account lockout after N failed attempts, with exponential backoff. Make sure the lockout is recoverable so it isn't a DoS vector.
- Login alerts: email the user when a login from a new device, IP, or country happens.

---

## 3.11 Authentication for AI agents

Spectre has 10 LLM-powered agents and 4 conversational surfaces. Agent auth is its own thing.

**Issues unique to agent auth:**

- **Agent acting on behalf of user.** The agent makes downstream API calls. Does it use the user's token, a service token, or both? Per-call authz must reflect the *user's* permissions, not the agent's.
- **Excessive agent privileges.** Giving an agent access to "all user data" instead of the specific records needed for the task. See OWASP LLM06 in `08-ai-llm-attacks.md`.
- **Cross-user data leakage in shared agents.** Agents that maintain state across users can leak. Strict per-user partitioning required.
- **Token theft via prompt injection.** Injection in user input or tool output exfiltrates the agent's bearer tokens via crafted URLs. Fix: never include sensitive tokens in prompts; use server-side tool execution where the agent only sees results, not credentials.

See `08-ai-llm-attacks.md` for the full agent attack surface.

---

## 3.12 Quick auth audit

```bash
# Hardcoded credential fallbacks
rg -n '\|\|\s*[\"'\''][A-Za-z0-9!@#$%^&*()_+]{6,}[\"'\'']' src/

# Tokens in localStorage
rg -n 'localStorage\.(setItem|getItem).*(token|auth|jwt|session)' src/

# JWT verify without algorithm pin
rg -n 'jwt\.verify\(' src/ | grep -v 'algorithms:'

# Missing route protection
rg -n '<Route|<Routes' src/ | head  # then audit each is wrapped in auth

# Login without rate limit
rg -n 'router\.(post|put).*(login|signin|password)' .

# Session cookies without flags
rg -n 'res\.cookie\(|setCookie\(' . | grep -v -E 'httpOnly|secure|sameSite'
```

---

## 3.13 Further reading

- OWASP Auth Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP JWT Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
- NIST SP 800-63B (digital identity guidelines): https://pages.nist.gov/800-63-3/sp800-63b.html
- Privy security docs: https://docs.privy.io/
