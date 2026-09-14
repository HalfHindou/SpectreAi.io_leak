# 01 - Network and availability

Attacks that target the pipes, not the application logic. Includes DDoS, DNS hijack, TLS/PKI failures, BGP hijack, and the rate-limiting and WAF design that defends against them.

## Threat landscape, 2025

The size and frequency of DDoS attacks broke records every quarter of 2025. Per Cloudflare's quarterly reports: 20.5M attacks blocked in Q1, the largest single attack ever recorded at 7.3 Tbps in mid-May, an 11.5 Tbps UDP flood in September, a 29.7 Tbps peak in Q3, and a 31.4 Tbps attack capping Q4. Total 2025 attacks: 47.1M, up 121% YoY. Network-layer attacks more than tripled. The Aisuru-Kimwolf botnet, primarily compromised Android TVs (1-4M devices), drove the largest events.

Why it matters for Spectre: even a 500 Mbps attack will take an unprotected server offline. You sit behind Cloudflare on a Pro plan with managed rulesets, which gives you most of the volumetric protection automatically. The work is in the application-layer (L7) configuration: rate limits, bot management, and CAPTCHA placement on expensive endpoints.

---

## 1.1 Volumetric DDoS (L3/L4)

**Attack.** Attacker generates traffic that overwhelms the network pipe or the connection table before the application sees it. Variants:

- **UDP flood.** Spray packets. Cheap, no handshake. Most common volumetric vector.
- **SYN flood.** Half-open TCP connections fill the connection table. Mitigated by SYN cookies but only if upstream supports them.
- **DNS flood.** Q1 2025 top L3/4 vector at ~one-third of all L3/4 attacks. Floods DNS resolvers, can take down DNS for the target.
- **Reflection and amplification.** Send a small spoofed request to a poorly configured server (DNS, NTP, memcached, CLDAP, SSDP, Chargen, RIPv1) which sends a much larger response to the spoofed victim address. Memcached can hit ~50,000x amplification.
- **Carpet bombing.** Spreads traffic across many destination IPs to evade per-IP rate limits.
- **Mirai and successors (Aisuru, Demon Bot).** Compromised IoT and Android TV devices coordinated by C2 to focus traffic. VM-based botnets are ~5,000x more potent than IoT-based per Cloudflare.

**Real cases:**

- Cloudflare Q4 2025: 31.4 Tbps in 35 seconds, attributed to Aisuru-Kimwolf, "The Night Before Christmas" campaign sustained HTTP DDoS attacks exceeding 200M rps against Cloudflare's own infrastructure.
- February 2018 GitHub: 1.35 Tbps memcached reflection. Mitigated in 20 minutes by Akamai Prolexic.
- 2025 Q1 18-day multi-vector campaign: 13.5M attacks targeting Cloudflare Magic Transit customers and Cloudflare itself.

**Detection.**

- Cloudflare dashboard → Security → Events. Filter on "L3/L4" and on `action == challenge|block`.
- Origin server: spike in connection count, dropped packets at the NIC. `ss -s`, `netstat -an | wc -l`, `dmesg | grep -i drop`.
- Latency spike from external monitoring (UptimeRobot, Pingdom, custom synthetic).

**Fix.**

- Stay behind Cloudflare. You are. Pro plan with managed rulesets gives you the volumetric mitigation automatically.
- Don't expose origin IPs directly. Verify with `dig` and shodan.io that the origin IP is not discoverable. If it is, rotate it: Cloudflare's "I'm Under Attack" mode does not help if the attacker has your origin.
- Enable Cloudflare Magic Transit only if you operate non-HTTP services (you don't, currently).
- Set up Argo Tunnel for any admin or internal services so origin IPs never leak.

**Spectre action items:** verify origin IP is not in any DNS history (`securitytrails.com`, `dnshistory.org`). If it was previously exposed, rotate.

---

## 1.2 Application-layer DDoS (L7)

**Attack.** Floods that look like legitimate HTTP requests. Harder to filter because each packet is a valid request. Sub-variants:

- **HTTP flood.** Many real-looking GET/POST requests. Drains backend.
- **Slowloris / RUDY / Slow Read.** Open connections and hold them with slow incomplete requests, starving the connection pool.
- **Cache busting.** Append random query strings (`?foo=12345`) to bypass cache and hit origin.
- **HTTP/2 Rapid Reset (CVE-2023-44487).** Open and immediately reset HTTP/2 streams. Google saw a peak of 398M rps in 2023 from this. Cloudflare's Q4 2025 surge had echoes of this technique.
- **Expensive endpoint abuse.** Hit a single CPU-heavy endpoint (search, image processing, AI inference) at moderate volume. Disproportionate impact.
- **Ransom DDoS (RDDoS).** Short demo attack followed by extortion demand. Cloudflare saw 68% QoQ growth in Q2 2025.

**Real cases:**

- October 2023 Google: 398M rps from HTTP/2 Rapid Reset.
- December 2025 Aisuru-Kimwolf: peaks exceeding 200M rps against Cloudflare customers and Cloudflare's own dashboard.

**Detection.**

- Cloudflare → Security → Events filtered to L7.
- Application metrics: request rate spike, p95 latency spike, error rate spike.
- Sentry or PostHog: error spikes correlated with traffic spikes.
- Look at the User-Agent and ASN distribution. Sudden concentration in one ASN or one UA pattern is a tell.

**Fix.**

- Cloudflare WAF Managed Ruleset and OWASP Core Ruleset (you have these enabled).
- Cloudflare Rate Limiting rules per endpoint:
  - `/api/auth/login`: 5 requests per minute per IP
  - `/api/auth/password-reset`: 3 requests per 10 minutes per IP and per account
  - `/api/ai/*` (inference endpoints): 30 requests per minute per authenticated user, 10 per IP
  - `/api/search`: 60 requests per minute per IP
- Cloudflare Bot Management or Turnstile on signup, contact form, and any unauthenticated POST endpoint.
- Cache aggressively. Cache-Control headers on every static and semi-static response. A page in the Cloudflare cache costs nothing.
- For AI inference specifically: rate limit hard, queue requests, return 429 with `Retry-After` rather than burning GPU.
- Set sensible client timeouts. Don't accept Slowloris-style connections that hold for minutes.

**Spectre action items:**

1. Add rate limit rules per the list above
2. Turnstile on the contact form on `spectreai.io`
3. Cache TTL on AI-generated articles (these don't change minute to minute)
4. Per-user rate limits on the conversational AI surfaces

---

## 1.3 DNS hijacking and registrar attacks

**Attack.** Attacker compromises your registrar account, your DNS provider, or your domain renewal/transfer process. Points `spectreai.io` at their own server. Issues new TLS cert via DNS-01 ACME challenge. Users see the correct domain with the lock icon and a malicious site.

Variants:

- **Registrar account takeover.** Phishing, credential stuffing, or SIM swap on the email tied to the registrar.
- **DNS provider account takeover.** Same vectors, different provider.
- **DNS cache poisoning.** Old vector, mostly mitigated by DNSSEC and resolver randomization.
- **BGP hijacking.** AS announces routes for IP space it doesn't own, traffic flows to attacker. Mostly mitigated by RPKI now but still happens.
- **Subdomain takeover.** Stale DNS record points at a deprovisioned third-party (Heroku, Vercel, S3, Azure, Fastly). Attacker claims the resource. See `09-info-disclosure-and-recon.md` for hunting these.
- **Domain expiration.** Forget to renew, someone else buys it.
- **Punycode lookalikes.** `spеctreai.io` (Cyrillic `е`) for phishing. Not a hijack but related class.

**Real cases:**

- 2022 KlaySwap: BGP hijack at the ISP level rerouted JS file requests to attackers, drained $1.9M.
- 2022 Curve Finance: DNS hijack via the registrar redirected users to a phishing clone, drained ~$570K.
- 2024 Compound Finance: DNS hijack on `compound.finance` redirected users for hours.
- Multiple crypto projects every quarter via DNS provider compromise.

**Detection.**

- DNS monitoring: Hardenize, SecurityTrails, DNSdumpster baseline, alert on any change.
- CT log monitoring: `crt.sh` shows every cert issued for your domain. Required. New cert from unexpected CA is a high-confidence breach signal.
- Daily CAA record verification.
- Visit production from external network and verify cert chain matches expected (CAA limits should mean only your CA issued).

**Fix.**

- Registrar: 2FA with hardware key (YubiKey), not SMS. SMS is bypassable via SIM swap.
- Registrar lock and transfer lock on the domain.
- DNSSEC enabled and validated by upstream.
- CAA records limiting which CAs can issue certs:
  ```
  spectreai.io. CAA 0 issue "letsencrypt.org"
  spectreai.io. CAA 0 issuewild "letsencrypt.org"
  spectreai.io. CAA 0 iodef "mailto:security@spectreai.io"
  ```
- Separate registrar account from DNS provider from hosting. Different credentials, different 2FA tokens, different blast radius.
- Email tied to registrar: dedicated, not shared, 2FA on the inbox itself.
- Registrar that supports email change verification with a delay. NameCheap, Cloudflare Registrar, MarkMonitor.

**Spectre action items:**

1. Verify the email on the `spectreai.io` registrar account has 2FA (hardware key preferred)
2. Add CAA records pinning your CA
3. Subscribe to a CT log monitor for `spectreai.io` and all subdomains
4. Set up an external DNS monitor that alerts on any record change (`securitytrails.com` has this)

---

## 1.4 TLS, PKI, and HTTPS misconfiguration

**Attack.** Misconfigured TLS makes downgrade attacks, eavesdropping, or impersonation possible.

Patterns:

- Old protocols (TLS 1.0, TLS 1.1) still enabled
- Weak ciphers (RC4, 3DES, export ciphers)
- Missing HSTS, missing HSTS preload
- Mixed content (HTTPS page loading HTTP subresources)
- Wildcard certs scoped too broadly (`*.spectreai.io` works on every subdomain including ones you don't control)
- Certificate Transparency log surveillance leaking subdomain names

**Detection.**

```bash
# scan from outside
ssllabs.com/ssltest/analyze.html?d=spectreai.io
# or CLI
testssl.sh spectreai.io
```

Want an A+ from SSL Labs. Anything less needs justification.

**Fix.**

- TLS 1.2 minimum, TLS 1.3 preferred
- ECDHE key exchange, AEAD ciphers only (AES-GCM, ChaCha20-Poly1305)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` and submit to `hstspreload.org`
- No mixed content. Audit at https://www.whynopadlock.com/
- Don't use wildcard certs unless needed. Per-subdomain certs limit blast radius.
- Auto-renewal monitored; expired certs cause outages

Cloudflare handles most of this for you, but verify the "Edge Certificates" config in the dashboard is set to TLS 1.2+ and HSTS is enabled.

---

## 1.5 BGP hijacking

**Attack.** Attacker's AS announces routes for IP prefixes it doesn't own. Traffic for those prefixes flows to the attacker's network. They can read it, modify it, or sinkhole it.

**Real cases:**

- 2022 KlaySwap: BGP hijack redirected JS file loads to attacker servers, $1.9M drained.
- 2018 MyEtherWallet: BGP hijack via Amazon Route 53, attackers presented a self-signed cert, users who clicked through lost ETH.
- Recurring throughout the last decade. Less common now due to RPKI adoption.

**Detection.**

- BGPmon, Cloudflare Radar, RIPE NCC monitoring.
- For Spectre, you don't have your own AS, so BGP is your providers' problem. The mitigation is the same as for DNS hijack: HSTS preload + cert pinning + CT monitoring catches the impersonation even if BGP succeeds.

**Fix.**

- Cloudflare publishes RPKI for its IP space. Use Cloudflare.
- HSTS preload means browsers refuse to talk HTTP, refuse cert errors.
- CT log monitoring catches the attacker-issued cert before they can drain users at scale.

Not much else to do unless you run your own network.

---

## 1.6 Rate limiting and WAF design

This is where most application-layer protection actually lives. The principles:

**Layer rate limits by sensitivity:**

| Endpoint class | Per IP | Per authenticated user | Special |
|----------------|--------|------------------------|---------|
| Public static (homepage, articles) | High, e.g., 600/min | n/a | Cached anyway |
| Public read API (search, market data) | 60/min | 120/min | TTL cache |
| Auth (login, password reset) | 5/min | 3/10min per account | Lockout after N |
| Inference / AI agents | 10/min | 30/min | Token-bucket; 429 with Retry-After |
| Webhooks / signing endpoints | n/a | n/a | HMAC required, replay-protected |
| Admin / privileged | 30/min | 30/min | Require MFA, IP allowlist |

**WAF tuning:**

- Start with Cloudflare Managed Ruleset on default sensitivity
- OWASP Core Ruleset (you have this enabled) at "Medium" paranoia, escalate per-route
- Add custom Cloudflare rules for:
  - `Block` on requests to `/.git/*`, `/.env`, `/wp-admin/*`, `/wp-login*` (you don't run WordPress, but bots will probe)
  - `Block` on requests with empty or default User-Agent on POST endpoints
  - `Challenge` on requests from data center ASNs hitting auth endpoints
  - `Block` on requests with suspicious header combinations (e.g., `Transfer-Encoding` + `Content-Length` both present → smuggling probe)
- Cloudflare Bot Management ($$): worth it for crypto sites. Otherwise Turnstile on key forms.
- Review WAF events weekly. Adjust rules that produce false positives.

**Spectre action items:** create a Cloudflare custom rule template for the rate limits above. The WAF dashboard has a "Create rule" button; the rules below go in there.

---

## 1.7 Operational hardening

Things that aren't attacks but reduce blast radius when attacks happen.

- **CDN at every edge.** Static assets, API responses where possible, even error pages. Anything that doesn't hit your origin can't take your origin down.
- **Origin protection.** Origin only accepts traffic from Cloudflare IP ranges. Configure at the firewall on origin servers; Cloudflare publishes the list at https://www.cloudflare.com/ips/.
- **mTLS between Cloudflare and origin.** "Authenticated Origin Pulls" in Cloudflare. Verifies that requests reaching origin actually came through Cloudflare.
- **No public admin panels.** `/admin`, `/dashboard`, `/internal` behind Cloudflare Access or Vercel Password Protection. Even if the underlying app has auth, the edge layer should not allow random IPs to even see the login page.
- **Health endpoints unauth'd but limited.** `/healthz` returns 200 with no info. Not `/healthz` that returns database connection string.
- **Backups, tested.** Vercel keeps deploy history but not data. Database backups tested with restore drills.

---

## 1.8 Quick checks

```bash
# Is the origin IP exposed?
curl -sI https://spectreai.io | grep -i server  # should say cloudflare
dig +short spectreai.io  # should resolve to Cloudflare IP

# Is HSTS set?
curl -sI https://spectreai.io | grep -i strict-transport

# Is HSTS preloaded?
# check https://hstspreload.org/?domain=spectreai.io

# Are common bot paths returning 403?
for p in /.env /.git/config /wp-admin /admin/login.php /phpmyadmin; do
  echo -n "$p: "
  curl -so /dev/null -w "%{http_code}\n" "https://spectreai.io$p"
done

# Does the CT log have any unexpected certs?
# check https://crt.sh/?q=spectreai.io

# Is DNSSEC active?
dig +dnssec spectreai.io | grep -E "RRSIG|ad"
```

---

## 1.9 Further reading

- Cloudflare DDoS Threat Report 2025 Q4: https://blog.cloudflare.com/ddos-threat-report-2025-q4/
- OWASP Cheat Sheet: Denial of Service: https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html
- CISA: BGP Security: https://www.cisa.gov/resources-tools/resources/bgp-security
- HSTS Preload list: https://hstspreload.org/
