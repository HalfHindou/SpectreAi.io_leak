# 09 - Information disclosure and reconnaissance

The category that started the Spectre dev-control breach. Before an attacker exploits anything, they map it: subdomains, internal URLs, exposed configs, leaked secrets, accidentally-published files. Every piece of information about your infrastructure is a tool the attacker will use. This file covers both what you leak and how attackers find it.

The principle: assume the attacker has perfect external visibility. The job is to make sure perfect external visibility doesn't get them in.

---

## 9.1 The recon mindset

Standard recon flow against any target (`spectreai.io`):

1. **Passive recon.** Public databases, no contact with target. CT logs, archive.org, GitHub search, Shodan, Censys, breach corpora. Undetectable.
2. **Active recon.** Direct queries against the target. Subdomain enumeration, port scans, directory bruteforce, JS file analysis. Logged but rarely alerted on.
3. **Service enumeration.** Identify what's running. Tech stack fingerprinting, version disclosure, endpoint discovery.
4. **Exploit planning.** Map vulns to discovered surface.

The dev-control breach skipped most of this. The internal URL was in plain sight in the production bundle. The attacker probably found it in step 1.

---

## 9.2 The Spectre dev-control leak: how it should have been caught

Walking through it as a defensive exercise:

**Step 1: Open production site in DevTools, Network tab.**

```
spectreai.io loads → main bundle loads
main bundle calls developer-control.vercel.app/error-beacon.js → leak
```

This is what an attacker did, within minutes of looking. The defensive version is the same thing done by you, weekly.

**Step 2: Grep the production bundle for unexpected hosts.**

```bash
curl -s https://spectreai.io | grep -oE 'src="[^"]+"' | sort -u
# Should be only spectreai.io and known CDNs

curl -s https://spectreai.io/main-*.js | grep -oE 'https?://[a-zA-Z0-9.-]+' | sort -u
# Catches any URL hardcoded in the bundle
```

**Step 3: Subdomain enumeration on `spectreai.io`.**

```bash
# Passive (CT logs)
curl -s 'https://crt.sh/?q=%25.spectreai.io&output=json' | jq -r '.[].name_value' | sort -u

# subfinder (uses many passive sources)
subfinder -d spectreai.io -all

# amass (passive + active)
amass enum -passive -d spectreai.io
```

Any subdomain that surfaces in this should be intentional. `developer-control.vercel.app` not appearing in DNS doesn't matter; once the URL is referenced from production, it's discoverable.

**Step 4: For each subdomain, check what's served and whether auth is in place.**

```bash
for sub in $(subfinder -d spectreai.io -silent); do
  echo -n "$sub: "
  curl -so /dev/null -w "%{http_code}\n" "https://$sub"
done
```

200 on something that should be authed = the dev-control class of bug.

Run all of this weekly against `spectreai.io` and any other domain you control.

---

## 9.3 Source maps

**Risk.** Source maps reconstruct your original unminified source code from the production bundle. Comments included. Variable names included. File structure included. Often: server-side code accidentally bundled. Sometimes: secrets that weren't supposed to ship.

**Detection on production:**

```bash
# Look at any production JS file
curl -s https://spectreai.io/assets/index-abc123.js | tail -5 | grep sourceMappingURL

# If it ends with //# sourceMappingURL=index-abc123.js.map, the map is referenced
# Check if it's actually served:
curl -sI https://spectreai.io/assets/index-abc123.js.map | head -1

# If 200, the map is public. Extract sources:
curl -s https://spectreai.io/assets/index-abc123.js.map | jq -r '.sources[]'

# Reconstruct source files
npx source-map-explorer https://spectreai.io/assets/index-abc123.js
```

**Real example impact.** Sprocket Security found an AWS key via source map analysis; key in a `.env.production` file that was bundled into the source map but not into the executed bundle. Map exposed the file. Key extracted. Full CI/CD compromise followed.

**Fix.**

- Vite: `build: { sourcemap: false }` for production.
- Next.js: `productionBrowserSourceMaps: false` (default; verify).
- If you need maps for Sentry/error tracking: use `'hidden'` sourcemaps (no reference in the JS file) and upload to Sentry privately.
- Verify after every deploy. CI step that fails if `.map` files exist in the deployed `dist/`.

---

## 9.4 Exposed `.git`, `.env`, `.well-known`, debug paths

**Attack.** Misconfigured deployment serves files that should never be public.

Worst case: `.git/` directory served. Attacker downloads the whole repo, including history, including secrets that were later "removed".

**Detection.**

```bash
# Common exposure patterns. Run weekly.
HOST=https://spectreai.io
for p in \
  /.env /.env.local /.env.production /.env.example \
  /.git/config /.git/HEAD /.git/index /.gitignore \
  /package.json /package-lock.json /yarn.lock \
  /Dockerfile /docker-compose.yml \
  /.htaccess /web.config \
  /robots.txt /sitemap.xml \
  /.well-known/security.txt /.well-known/openid-configuration \
  /backup.sql /backup.zip /db.sqlite \
  /phpinfo.php /info.php /test.php \
  /admin /admin/login /administrator \
  /api/swagger /api/docs /swagger.json /openapi.json \
  /__debug__ /debug /trace /actuator /actuator/health \
  /server-status /nginx-status; do
  echo -n "$p: "
  curl -so /dev/null -w "%{http_code}\n" "$HOST$p"
done
```

Anything 200 that shouldn't be 200 is the bug. Be specific:

- `/.git/config` 200: download whole repo via `git-dumper` or similar.
- `/.env` 200: secrets in production.
- `/api/swagger` 200 in prod: API surface fully documented for attacker.
- `/__debug__` 200: framework debug toolbar (Flask, Symfony, etc.) → often RCE.
- `/actuator/env` 200: Spring Boot env dump.

**Fix.**

- Webserver config: explicit deny on dotfiles and well-known leak paths.
- Cloudflare WAF: managed rule for "common exploit paths" handles many of these.
- Build process: don't include `.env*`, `.git/`, build artifacts in the deployment.
- Vercel: respects `.gitignore` by default; verify your `.vercelignore` doesn't undo this.

---

## 9.5 Error message leakage

**Attack.** Verbose error responses leak:

- Stack traces revealing framework, version, paths
- SQL errors revealing schema and query structure
- File paths revealing OS, user accounts, app structure
- API tokens or session IDs accidentally interpolated into error messages

**Detection.** Trigger errors:

```bash
# bad inputs
curl "https://api.spectreai.io/articles?id=abc"  # should be 400 with generic message
curl "https://api.spectreai.io/articles?id=999999999999999999999"  # int overflow attempt
curl -X POST "https://api.spectreai.io/articles" -H "Content-Type: application/json" -d '{'  # malformed JSON
curl "https://api.spectreai.io/nonexistent-endpoint"  # 404; should be generic
curl "https://api.spectreai.io/articles/123" -H "Authorization: Bearer malformed"  # auth error
```

Each response: check that it's a generic message, not a stack trace. No file paths, no SQL fragments, no library versions.

**Fix.**

- Production error handler returns generic messages. Log the details server-side.
- Express: `if (env === 'production') app.use(genericErrorHandler)`.
- Next.js: custom `_error` page that doesn't leak.
- Disable framework debug pages in production.
- Strip `Server`, `X-Powered-By`, `X-AspNet-Version`, `X-Generator`, similar headers.

---

## 9.6 Version disclosure and tech fingerprinting

**Attack.** Attackers identify your stack to look up known CVEs:

- HTTP response headers (`Server`, `X-Powered-By`)
- Default file paths (`/wp-content/`, `/wp-admin/` reveals WordPress)
- Framework-specific cookies (`PHPSESSID`, `connect.sid`, `_csrf`)
- JS bundle paths (`_next/static/` reveals Next.js)
- Error pages with framework branding
- Source map content
- Favicon hashes

**Detection.**

```bash
# Look at all response headers
curl -sI https://spectreai.io | grep -iE 'server|x-powered|x-aspnet|x-generator|x-runtime'

# Wappalyzer or similar (browser ext)
# Or CLI
nuclei -t http/technologies/ -u https://spectreai.io
```

**Fix.**

- Strip identifying headers. Cloudflare can do this with a transform rule.
- Use generic default favicons (or unique one) and error pages.
- This is defense in depth; the goal isn't to be unidentifiable (you can't be), it's to not advertise.

---

## 9.7 Subdomain enumeration

**Attack.** Attacker finds every subdomain you control. Each is an attack surface; one weak subdomain compromises related domains (cookie attacks, CORS, etc).

**Passive sources (no traffic to your servers):**

- **Certificate Transparency logs** (every cert issued). `crt.sh/?q=%25.spectreai.io`.
- **DNS history** (SecurityTrails, DNSDumpster, ViewDNS).
- **Public datasets** (Rapid7 Open Data, Common Crawl).
- **GitHub search** for `spectreai.io` references.
- **Archive.org** Wayback Machine snapshots.

**Active sources:**

- **DNS bruteforce** against word lists. `puredns`, `massdns`.
- **Permutation generation** based on found subdomains. `altdns`, `dnsgen`.
- **Virtual host discovery** via TLS SAN extension.
- **Search engines** with `site:` operator.

**Tools that combine:**

```bash
subfinder -d spectreai.io -all -recursive
amass enum -d spectreai.io
chaos -d spectreai.io  # ProjectDiscovery's continuous dataset
```

**For Spectre defense:**

- Run subdomain enumeration against yourself, monthly.
- Inventory: what should exist? What does exist? Diff and investigate.
- Subdomain takeover hunting: for each subdomain, check if it points at a deprovisioned third-party (Heroku, Vercel, S3, Fastly). `subjack`, `subzy`, `nuclei -t http/takeovers/`.

---

## 9.8 Subdomain takeover

**Attack.** You point `old-tool.spectreai.io` at a Heroku/Vercel/S3 resource. Later you delete the resource but not the DNS record. Attacker claims the same resource name. Now they control content on `old-tool.spectreai.io`.

Consequences:

- **Cookie theft.** Any cookie with `Domain=.spectreai.io` (overly broad scope) is sent to the attacker's subdomain. If you have cookies scoped that way for session, hijacking is trivial.
- **CORS bypass.** If you have `Access-Control-Allow-Origin: *.spectreai.io`, the attacker's subdomain now has cross-origin access to your APIs.
- **Phishing.** Attacker hosts pages on a "real" Spectre subdomain. Users trust the domain.
- **Bypassing CSP** (if you have `*.spectreai.io` in your CSP).
- **CT log surveillance.** Attacker gets LetsEncrypt cert for the subdomain via DNS-01 (or HTTP-01 once they control content). Looks fully legitimate.

**Detection.**

```bash
# For each subdomain, check the CNAME
for sub in $(subfinder -d spectreai.io -silent); do
  cname=$(dig +short CNAME "$sub" | head -1)
  if [ -n "$cname" ]; then
    echo "$sub -> $cname"
  fi
done

# Nuclei takeover templates
nuclei -t http/takeovers/ -l subdomains.txt

# Look for fingerprints in the responses (NXDOMAIN, "There isn't a GitHub Pages site here", etc)
```

**Fix.**

- Inventory all DNS records, audit quarterly.
- Delete DNS records for deprovisioned services.
- Lock cookie domains tightly: don't use `Domain=.spectreai.io`; let cookies default to the specific host.
- `__Host-` prefix on session cookies (forces specific-host scope).

---

## 9.9 CT log monitoring

Every TLS certificate issued is published to Certificate Transparency logs. This is a recon source AND a defense:

- **As recon:** lists every subdomain you've ever requested a cert for, including staging, dev, internal. Cf. `crt.sh`.
- **As defense:** alerts you to unexpected certs issued for your domain. New cert from an unexpected CA = potential domain compromise.

**For Spectre:**

- Set up monitoring on `spectreai.io` and `*.spectreai.io` via Hardenize, SSLMate Cert Spotter, or Censys.
- CAA records pin to specific CAs (you allow LetsEncrypt for example). Unexpected CA → cert issuance fails → no cert; attacker can't impersonate without compromising your DNS too.
- Wildcard cert vs per-subdomain trade-off: wildcards don't appear in CT logs at subdomain granularity, so attackers can't enumerate via CT. But wildcards have broader blast radius if compromised. Per-subdomain certs leak enumeration but limit damage. Both have valid trade-offs.

---

## 9.10 GitHub dorking

Public repos and gists from your team or company often leak credentials, internal URLs, architecture details.

**Searches an attacker runs:**

```
# At github.com search
"spectreai.io" filename:.env
"spectreai" "password"
"spectreai" "api_key"
"spectreai" "secret"
"developer-control.vercel.app"
org:spectre-ai
```

`gitGraber`, `truffleHog`, `gitleaks` on public repos that mention your org/domain.

**For Spectre defense:**

- Run the same searches against yourself. Find leaks first.
- For each team member's personal GitHub: ask them to audit for accidental commits with Spectre creds.
- GitHub secret scanning: free for public repos; alerts on known secret patterns. Enable for your org.
- Educate the team: don't push test code with real keys, even temporarily, even to private repos that you "might make public later."

---

## 9.11 JavaScript file analysis

Production JS bundles contain:

- API endpoint URLs (every endpoint your app calls is in the bundle)
- Internal hostnames
- Hardcoded strings that hint at architecture
- Sometimes: secrets (see `04-storage-and-secrets.md`)
- Sometimes: full source via source maps

**Tools attackers use:**

- **LinkFinder.** Extracts endpoints from JS files.
- **JSFScan / SecretFinder.** Looks for known secret patterns.
- **JSluice.** Modern extraction tool.
- **trufflehog filesystem.** Entropy-based secret detection.

**Defensive use of the same tools:**

```bash
# Build, then analyze
npm run build
trufflehog filesystem dist/
jsluice urls dist/assets/*.js
jsluice secrets dist/assets/*.js

# Specific: enumerate all API endpoints in the bundle
grep -oE '"/api/[a-zA-Z0-9/_-]+"' dist/assets/*.js | sort -u
grep -oE 'https?://[a-zA-Z0-9.-]+' dist/assets/*.js | sort -u
```

The list of endpoints is roughly your public API. Any endpoint that shows up here should be intentionally accessible. Anything internal that surfaced is the dev-control class of bug.

---

## 9.12 API endpoint discovery beyond the bundle

Attackers also enumerate endpoints via:

- **OpenAPI/Swagger specs.** If publicly served (`/swagger`, `/api-docs`, `/openapi.json`), that's the full API documented.
- **Path bruteforce.** `ffuf`, `gobuster`, `feroxbuster` against your API host with `dirsearch` wordlists.
- **HTTP method bruteforce.** Try `OPTIONS`, `PUT`, `DELETE` on known endpoints; sometimes more methods are accepted than the docs say.
- **GraphQL introspection.** `__schema` query lists every type and field.
- **Mobile app reverse engineering.** If you have a mobile app, decompiling it gives all API endpoints.
- **JS file diffs.** Compare old and new JS bundles; new endpoints surface in the diff.

**For Spectre with 335+ HTTP endpoints:** maintain an internal inventory. Compare against external enumeration periodically. Anything found externally that's not in your inventory is either undocumented or unintended. Both are problems.

---

## 9.13 robots.txt, sitemap.xml, security.txt

Standard files at well-known paths. Each tells attackers something.

- **robots.txt.** Lists paths you don't want crawlers indexing. Attackers read it to find admin and internal paths. *Do not put "Disallow: /admin/secret-tool" in robots.txt; it's a signpost.*
- **sitemap.xml.** Lists pages. Less risky but still tells attackers what exists.
- **security.txt** at `/.well-known/security.txt`. *Should* exist; tells researchers how to report vulnerabilities responsibly:
  ```
  Contact: mailto:security@spectreai.io
  Expires: 2027-01-01T00:00:00.000Z
  Encryption: https://spectreai.io/pgp-key.txt
  Preferred-Languages: en
  Policy: https://spectreai.io/security-policy
  ```
  Publish one. Reduces the friction of researchers reaching you instead of disclosing publicly.

---

## 9.14 Wayback Machine and archive.org

Archive.org snapshots production sites. Old versions can reveal:

- Removed admin URLs
- Old API endpoints
- Leaked credentials in earlier deploys
- Architecture changes

**Use defensively:**

```bash
# All snapshot URLs for spectreai.io
curl -s "https://web.archive.org/cdx/search/cdx?url=*.spectreai.io/*&output=json&fl=original&collapse=urlkey" | jq -r '.[1:][]'

# Or use waybackurls
waybackurls spectreai.io
```

If an old snapshot leaked something that should never have been there, the snapshot still exists. Archive.org has a takedown process for verified sensitive content; use it sparingly because filing takedowns sometimes draws attention.

---

## 9.15 Public breach data and credential corpora

Attackers cross-reference your domain against breach corpora to find employee credentials they can credential-stuff.

**Defensive checks:**

- **haveibeenpwned.com** for the founding team's emails and any work emails.
- **Dehashed, IntelX** (paid) for deeper coverage.
- **GitHub secret scanning** (enabled in repo settings).

For any team email found in a breach: rotate the password (everywhere it might be reused) and enable MFA. Educate the team about password reuse.

---

## 9.16 Shodan and Censys

Internet-wide port scans. Attackers query:

- `org:"Spectre"` if your org is listed
- `ssl.cert.subject.cn:"spectreai.io"`
- `hostname:"spectreai.io"`
- Specific IP ranges if you have static infrastructure

Find: any service exposed that shouldn't be (Redis, MongoDB, internal services bound to public IPs, dev servers).

**For Spectre:** mostly cloud-hosted via Vercel, so the surface is small. But the OVH blockchain nodes have public IPs. Verify their Shodan exposure:

```
shodan host <your-OVH-IP>
# Should show only the expected RPC ports
```

---

## 9.17 OSINT on the team

Attackers research individuals as part of recon. LinkedIn for org chart. Twitter/Telegram for personality and patterns. Conference talks for tech stack details.

**OPSEC for crypto founders:**

- LinkedIn shows you're a co-founder; that's fine. It shows your direct reports and tech stack details; that's recon material.
- Twitter posts that reveal you're traveling, you have a hardware wallet, you use specific tooling - each is a recon nugget.
- Conference talks: don't disclose specific security architecture publicly. Generic best practices yes; "we use Y service with key rotation every Z days" no.

This crosses into `10-social-and-physical.md` (phishing using OSINT'd context). The defense is awareness: assume that anyone targeting Spectre has read every public statement you and the team have made.

---

## 9.18 Spectre weekly recon ritual

A 30-minute weekly check to catch the next dev-control class of bug before an attacker does:

1. **Open `spectreai.io` in incognito, DevTools Network tab.** Click around. Anything that calls a non-`spectreai.io` host should be expected (Cloudflare, your analytics, your error tracker). Anything unexpected is investigated.

2. **Run subdomain enumeration:**
   ```bash
   subfinder -d spectreai.io -all -silent | sort -u > /tmp/subs.txt
   diff /tmp/subs.txt last-week-subs.txt  # delta is the interesting part
   ```

3. **For each subdomain, check status and tech stack:**
   ```bash
   while read sub; do
     code=$(curl -so /dev/null -w "%{http_code}" "https://$sub")
     echo "$code $sub"
   done < /tmp/subs.txt
   ```

4. **Check CT log for new certs:**
   - https://crt.sh/?q=%25.spectreai.io (sort by date, look for new entries)

5. **Run secret scan against production bundle:**
   ```bash
   curl -s https://spectreai.io | grep -oE 'src="[^"]+"' | grep -v spectreai.io
   # then download and analyze each JS file
   ```

6. **Sweep for exposed paths** (script from 9.4 above).

7. **Check `crt.sh` and HIBP** for the founder team emails.

8. **Review Cloudflare WAF events** for the past week. Look for patterns suggesting targeted recon (one IP probing many paths).

A scripted version of this can run daily via cron and email a diff. The first time you do it manually, you'll likely find something. The second time, the surface is smaller.

---

## 9.19 What to do when you find something

You scanned. You found a leak.

1. **Rotate any leaked credentials immediately.** Assume the attacker found them first.
2. **Remove the leak source.** Don't just rotate; fix the pipeline that produced the leak.
3. **Add detection.** If a secret leaked into a bundle, add a CI step that fails on the secret pattern. If a subdomain shouldn't have existed, audit the DNS provider's logs to find out who created it.
4. **Audit for adjacent leaks.** If one bundle leaked, scan all of them. If one git history had a secret, scan all repos.
5. **Update the threat model.** A new class of leak you didn't expect means the model has a gap. Document it.

---

## 9.20 Further reading

- ProjectDiscovery tools (subfinder, nuclei, naabu, etc.): https://github.com/projectdiscovery
- OWASP Web Security Testing Guide (full recon methodology): https://owasp.org/www-project-web-security-testing-guide/
- HackTricks (the encyclopedia of web attacks): https://book.hacktricks.xyz/
- Sublist3r and amass docs
- Bug bounty hunter writeups on Medium, HackerOne hacktivity. Reading these is the most efficient way to learn what attackers actually do.
- securitytxt.org for the standard format
- Cert Spotter (free CT monitoring): https://sslmate.com/certspotter/
