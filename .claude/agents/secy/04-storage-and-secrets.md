# 04 - Storage and secrets

The category that broke Spectre dev-control twice over (localStorage + bundled secret). Sensitive data in the wrong place is a one-way ticket to a public Pastebin.

## 4.1 localStorage and sessionStorage

**Threat model.** Anything in `localStorage` or `sessionStorage` is readable by any JavaScript running on the same origin. That includes:

- Every dependency you ship (and every dependency of every dependency)
- Every browser extension the user has installed
- Any XSS payload that ever lands on your origin
- Any DOM-clobbering or prototype pollution chain that gets script execution
- Any compromised third-party script (analytics, error reporting, A/B testing, chat widgets)

Web Storage has no `HttpOnly`, no `Secure`, no `SameSite`, no expiry. A token there lives until manually cleared.

The September 2025 npm compromise (`chalk`, `debug`, others, 2.6B weekly downloads) deployed a drainer that hooked into `window.ethereum`. If users' tokens or wallet authorizations were in localStorage, the drainer could read them directly. Cookies marked HttpOnly cannot be read this way.

**Detection.**

```bash
rg -n 'localStorage\.(setItem|getItem)|sessionStorage\.' src/
```

For each match, ask: is this data sensitive? Auth tokens, JWTs, refresh tokens, API keys, wallet authorization data, user PII - all of these are wrong in localStorage.

**Fix.**

| Data class | Right place |
|------------|-------------|
| Auth tokens, session IDs | `HttpOnly Secure SameSite=Lax` cookies set by the server |
| Public preferences (theme, language, last route) | localStorage is fine. Validate values on read; don't trust them. |
| Wallet public address | localStorage fine (it's public on chain anyway). Never the private key, never the seed, never a stored signed authorization. |
| Drafts, in-progress work | sessionStorage or IndexedDB; don't include sensitive fields |
| Shopping carts, UI state | Either, with server-side validation on submission |
| AI agent conversation history | Server-side, keyed by user session. Local copy only as cache. |

**The Spectre case.** dev-control wrote `{"state":{"isAuthenticated":true}}` to localStorage as the only gate. One DevTools command bypassed it. Even if the password check had been server-side, storing the auth state client-side and trusting it on read is the bug.

**IndexedDB has the same problem.** It's also same-origin JS-accessible. Don't put secrets there.

---

## 4.2 Cookie security

**Required flags on session and CSRF cookies:**

```
Set-Cookie: session=<id>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600
```

- `HttpOnly`: no JS access. Defeats XSS-based cookie theft.
- `Secure`: HTTPS only. Defeats network sniffing on http://.
- `SameSite=Lax` (default): cookie not sent on cross-site POST/PUT/DELETE or on iframe loads. Defeats most CSRF.
- `SameSite=Strict`: stricter, blocks even top-level navigations from external sites. Use for high-value flows.
- `Path=/`: cookie scoped to the whole origin. Don't broaden via `Domain=` unless required.
- `Max-Age` or `Expires`: short-lived; refresh server-side.

**Sticky cookie mistakes:**

- `__Host-` prefix: enforces `Secure`, no `Domain`, `Path=/`. Use for session cookies.
- `__Secure-` prefix: enforces `Secure`. Use if you need a domain attribute.
- Not all flags on every cookie: an old CSRF token cookie without `SameSite` undermines the whole defense.
- Logout that only deletes the cookie client-side but doesn't invalidate server-side.

**Attacks on cookies:**

- **Theft via XSS.** HttpOnly defeats this.
- **Theft via network.** Secure defeats this.
- **CSRF.** SameSite defeats most. Use double-submit token or origin-bound CSRF token for the rest.
- **Fixation.** Attacker sets a known session cookie before login; if not rotated on login, attacker now shares the session. Fix: rotate session ID on login.
- **Cookie tossing / overflow.** Wildcard cookies on `.spectreai.io` can be set by any subdomain. If a subdomain is compromised (or is intentionally a sandbox), it can write cookies that affect the main app. Fix: `__Host-` prefix, no Domain attribute.
- **Subdomain cookie injection from a subdomain takeover.** See `09-info-disclosure-and-recon.md`.

---

## 4.3 Secrets in the client bundle

The Spectre dev-control breach part 2. From the Vite docs: "VITE_* variables should not contain sensitive information such as API keys. The values of these variables are bundled into your source code at build time."

Every modern frontend framework has the same pattern, different prefix:

| Framework | Public prefix | Notes |
|-----------|---------------|-------|
| Vite | `VITE_` | Statically replaced at build time |
| Next.js | `NEXT_PUBLIC_` | Statically inlined into client bundle |
| Create React App | `REACT_APP_` | Inlined at build |
| Vue CLI | `VUE_APP_` | Inlined at build |
| Nuxt | `NUXT_PUBLIC_` | Runtime config split |
| Astro | `PUBLIC_` | Client-exposed only |
| SvelteKit | `PUBLIC_` | Public env split from private |

**Anything with these prefixes is public.** A "secret" stored there is not secret.

Sprocket Security's 2025 disclosure: a single misprefixed Vite variable (AWS key with `VITE_` prefix) led to full CI/CD compromise. Attacker found the key in `dist/assets/*.js`, used it to access source maps in S3, used those to find more secrets, escalated to GitHub Actions secrets, ended with control of the deploy pipeline.

**Detection.**

```bash
# from a fresh production build
npm run build
cd dist  # or .next/static, or build/

# obvious high-entropy strings
rg -n '[A-Za-z0-9_+/]{32,}' assets/*.js | head -50

# specific secret shapes
rg -En 'sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xoxb-[0-9]{11,}|AIza[0-9A-Za-z_-]{35}|hf_[a-zA-Z0-9]{34}|sk_live_[a-zA-Z0-9]{24}' .

# entropy-based scan
trufflehog filesystem ./
gitleaks detect --source . --no-git

# the Spectre fallback pattern: literal after ||
rg -n '\|\|\s*[\"'\''][A-Za-z0-9!@#$%^&*()_+]{8,}[\"'\'']' ../src/
```

**Fix.**

- For any value your frontend uses to call a third-party API: proxy through a backend or serverless function. Frontend calls your endpoint; your endpoint calls the third party with the secret server-side.
- Never use `||` fallbacks for secrets. Fail loud at build time if a required env var is missing:
  ```ts
  // build-time env validation
  const required = ['VITE_PUBLIC_API_URL'] as const
  for (const k of required) {
    if (!import.meta.env[k]) throw new Error(`Missing required env: ${k}`)
  }
  ```
- Rotate any secret you find in a public bundle. Treat it as compromised, even if you only found it post-incident. Assume the attacker found it first.
- Disable source maps in production unless behind auth: `vite.config.js` → `build: { sourcemap: false }`. Source maps reconstruct your original (unminified, commented) source from minified bundles. They're discoverable from the `//# sourceMappingURL` comment in the JS file.
- Verify after every deploy. CI step that fails if known secret patterns appear in `dist/`.

**Specific Spectre risk:** the Groq, OpenAI, Anthropic, Perplexity API keys. If any of these ever appears in a frontend bundle, the attacker uses your account to run inference until the bill hits the credit limit or until you rotate. With a $50/month rate-limit on a Groq key, that's not catastrophic; with a key tied to your billing account, it can be five figures before you notice.

---

## 4.4 Source maps and bundle exposure

**Attack.** Source maps in production are a goldmine. They give the attacker:

- Original variable names (minified `t.X` becomes `authService.fetchToken`)
- Comments (often containing TODOs that reveal weaknesses)
- File and folder structure (reveals architecture)
- Sometimes whole files that weren't meant to ship to client (server-side helpers wrongly bundled)

**Detection.**

```bash
# look at any .js file in production
curl -s https://spectreai.io/_next/static/chunks/main-*.js | tail -5 | grep sourceMappingURL
# if it ends with `//# sourceMappingURL=main-xyz.js.map`, the map is public
# fetch it:
curl -s https://spectreai.io/_next/static/chunks/main-xyz.js.map | jq .sources
```

**Fix.**

- Disable in production builds, or upload to an error tracking service (Sentry) and don't serve publicly.
- Vite: `build: { sourcemap: false }`. If you want maps for Sentry, use `'hidden'` or upload them privately.
- Next.js: `productionBrowserSourceMaps: false` (default).
- Vercel: ensure the deployment doesn't include `.map` files in the static dir.

---

## 4.5 Git history secrets

**Attack.** A secret was committed once, removed in a later commit. The secret is still in git history. Anyone who clones the repo (public or stolen via account compromise) has it.

**Detection.**

```bash
# scan all history
gitleaks detect --source . --log-opts="--all"

# trufflehog has stronger entropy/regex
trufflehog git file://. --since-commit HEAD~1000

# git-secrets pre-commit hook (catches at commit time)
git secrets --install
git secrets --register-aws
```

**Fix.**

- If a secret is in git history: rotate it. Don't try to "remove from history" first and assume safety; clones already exist.
- Then optionally rewrite history (`git filter-repo`, `BFG Repo-Cleaner`) and force-push. Coordinate with the team; they need to re-clone.
- Pre-commit hooks: `gitleaks`, `git-secrets`, or `talisman` to prevent recurrence.
- GitHub secret scanning: free for public repos, paid for private. Enable it.

---

## 4.6 .env files and configuration

**Attack.**

- `.env` not in `.gitignore` → committed.
- `.env.production` committed because "we needed it to work in CI".
- `.env.example` with real values "to make onboarding easier".

**Detection.**

```bash
# anything env-shaped tracked in git
git ls-files | grep -iE '\.env|secret|key|credential'

# anywhere in history
git log --all --diff-filter=A --name-only | grep -iE '\.env'
```

**Fix.**

- `.gitignore`:
  ```
  .env
  .env.local
  .env.*.local
  *.pem
  *.key
  ```
- `.env.example` with **placeholder** values only (`DATABASE_URL=postgres://user:password@host:5432/db`).
- Production env vars come from your platform (Vercel, GitHub Actions secrets, AWS Secrets Manager). Not from a file in the repo.
- For Spectre: Vercel's env var UI per project. Mark them as "Encrypted" and scope by environment (Development / Preview / Production). Never share between environments.

---

## 4.7 S3, GCS, Azure Blob, R2 misconfiguration

**Attack.** Bucket made public when it shouldn't be. Or bucket policy too permissive (`s3:ListBucket` or `s3:GetObject` for `*`). Attacker lists or downloads everything.

The Bybit hack chain ran through S3: the attacker injected the malicious JS into Safe{Wallet}'s S3 bucket via a compromised developer machine. The S3 bucket itself wasn't public-readable, but write access from the compromised account let them poison the deployment artifacts. Two days later, the malicious file was loaded by Bybit signers and $1.5B was gone.

**Detection.**

- AWS S3: `s3-bucket-finder`, `bucket_finder`, or just `aws s3 ls s3://spectreai-prod --no-sign-request`. If it lists, it's public.
- `awscli` audit: `aws s3api get-bucket-acl --bucket name`, `aws s3api get-public-access-block --bucket name`.
- AWS Config rule: `s3-bucket-public-read-prohibited`.
- GCS: `gsutil iam get gs://bucket`.
- All providers: enable account-level "Block Public Access" so individual buckets can't be made public by accident.

**Fix.**

- AWS S3 "Block Public Access" enabled at the account level. Override per bucket only when intentional (a public CDN bucket).
- IAM policies follow least privilege. The CI/CD role can deploy to `dist/`, not read user data.
- Object-level lock or versioning on buckets that hold artifacts. Bybit-style overwrite attacks become recoverable.
- Audit logs (CloudTrail) on all bucket reads and writes. Alert on `PutObject` from unexpected principals.
- Pre-signed URLs (short-lived, ≤15 min) for any user-direct upload/download, instead of making buckets public.

---

## 4.8 Firebase Realtime Database and Firestore rules

The dominant Spectre GCP cost (per memory). Worth getting the rules right.

**Attack.** Default Firebase rules in development mode (`allow read, write: if true`) make everything world-readable and world-writable. Anyone who finds the database URL (in your client bundle, since Firebase config is public by design) can list it all, write garbage, or delete data.

**Detection.**

- Open Firebase Console → Realtime Database / Firestore → Rules. Look for `allow read, write: if true` or unconditional rules.
- Open `https://your-project.firebaseio.com/.json` (RTDB) - if you get data without auth, you're broken.
- Audit the security rules against your actual data model.

**Fix.**

- Default-deny: `match /{document=**} { allow read, write: if false; }`.
- Per-collection rules with explicit conditions:
  ```
  match /users/{userId} {
    allow read: if request.auth != null && request.auth.uid == userId;
    allow write: if request.auth != null && request.auth.uid == userId
                  && request.resource.data.keys().hasOnly(['displayName', 'avatar']);
  }
  ```
- Test rules with the Firebase Emulator: `firebase emulators:start` + unit tests using `@firebase/rules-unit-testing`.
- Don't ever ship `allow read, write: if true` to production. Even temporarily. Even on a non-production project, if its database URL is in any client bundle.

---

## 4.9 Exposed databases

**Attack.** MongoDB, Redis, Elasticsearch, PostgreSQL bound to `0.0.0.0` instead of `127.0.0.1`, with no auth or default credentials. Discoverable via Shodan (`product:"MongoDB" port:27017`) or Censys. Direct connection from the internet.

Historical examples: MongoDB ransomware (2016-2017), Elasticsearch leaks (every year), Redis breaches (frequent). The "Have I Been Pwned" dataset is full of these.

**Detection.**

- From a non-internal IP, try to connect: `mongo mongodb://your-server:27017`, `redis-cli -h your-server`, `psql -h your-server`. Should timeout or refuse, not connect.
- Shodan/Censys search for your IP ranges.

**Fix.**

- Bind to `127.0.0.1` or to a private network address. Never to `0.0.0.0` unless you really mean it.
- Firewall rule: only allow connections from app server IPs.
- Strong passwords, change defaults.
- TLS for connections crossing networks (cloud VPC peering, hybrid setups).
- Audit logs and connection monitoring.

For Spectre: confirm nothing in OVH's blockchain node config exposes the node's RPC, P2P port, or any management interface to the internet without auth. Same for any internal services on Vercel's serverless side (which are behind their network by default, but verify).

---

## 4.10 Secret management for the team

**Where secrets should live (in order of preference):**

1. **Cloud-native secret manager.** AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, Vercel Environment Variables, HashiCorp Vault. Designed for the job. Rotation, audit, access policies.
2. **Password manager with team sharing.** 1Password, Bitwarden, Dashlane. For human-used credentials (registrar, GitHub, etc).
3. **Environment variables on the platform.** Vercel env vars, GitHub Actions secrets. Acceptable; less hardened than a dedicated secret manager but adequate for small teams.

**Where secrets should never live:**

- Slack DMs ("hey here's the prod DB password")
- Email
- Google Docs
- Notion (unless explicitly designed for secrets with access control)
- `.env` files committed anywhere
- Source code, even commented out, even "temporarily"
- Logs (validate before logging)
- Browser bookmarks, browser sync
- Sticky notes

**Rotation discipline:**

- Set expiry on every long-lived credential.
- Rotate on team change (anyone who had access leaves the team).
- Rotate after any suspected exposure, including "I'm not sure but the bundle was greppable."
- Automate rotation where possible (AWS Secrets Manager does this for RDS).

**Spectre specifically:** Vercel env vars for production. 1Password for team shared credentials. AWS Secrets Manager or GCP Secret Manager for any backend that needs runtime secret access. Never trust developer laptops as a credential store; assume any dev machine could have an infostealer (see `10-social-and-physical.md`).

---

## 4.11 Browser storage for Web3 specifically

Wallet apps and dApps face a unique storage surface. The connected wallet (MetaMask, Phantom, etc.) lives in a browser extension. The dApp lives in the page. They communicate via `window.ethereum` or `window.solana`.

**What goes where, for Web3:**

| Data | Where |
|------|-------|
| Wallet public address | OK in localStorage for UX (auto-reconnect) |
| ENS or display name | Same |
| Wallet provider chosen (MetaMask, WalletConnect, etc.) | Same |
| Connected chain ID | Same |
| Private key | Never. Lives in the wallet extension or hardware wallet. |
| Mnemonic phrase | Same. Same. Same. |
| Signed messages or authorizations | Don't store. Re-sign when needed. |
| Pre-approved spend allowances on contracts | These live on-chain; users revoke via revoke.cash. Don't track in localStorage. |

The risk: storing a signed message that grants permission, where re-using it counts as a fresh authorization. Better to require fresh signing each time, even though the UX is worse. The user catches the bug; if you store the signature, an extracting drainer doesn't need fresh user consent.

---

## 4.12 Quick storage audit

```bash
# What's in localStorage on Spectre prod?
# Open https://spectreai.io in an incognito window, DevTools → Application → Local Storage.
# Should be theme/UI preferences only. Anything else → audit.

# In the codebase
rg -n 'localStorage|sessionStorage|IndexedDB' src/
rg -n 'document\.cookie' src/  # cookies should be set server-side, not by JS

# Production bundle scan
npm run build && trufflehog filesystem dist/

# Git history scan
gitleaks detect --source . --log-opts="--all"

# Firebase rules
cat firebase.rules || cat firestore.rules

# Env vars used in client code
rg -n 'import\.meta\.env|process\.env\.NEXT_PUBLIC|process\.env\.REACT_APP' src/
```

---

## 4.13 Further reading

- OWASP Cookie Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Web Storage: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
- Vite env docs (read it again): https://vite.dev/guide/env-and-mode
- Sprocket Security on Vite secret exposure: https://www.sprocketsecurity.com/blog/hunting-secrets-in-javascript-at-scale-how-a-vite-misconfiguration-lead-to-full-ci-cd-compromise
- Firebase Security Rules guide: https://firebase.google.com/docs/rules
- gitleaks: https://github.com/gitleaks/gitleaks
- trufflehog: https://github.com/trufflesecurity/trufflehog
