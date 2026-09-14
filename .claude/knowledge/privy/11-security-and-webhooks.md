---
description: Privy security architecture, secure enclaves, on-device execution, IP allowlist, allowed domains, OAuth redirects, CSP, bot prevention, security checklist, security FAQs, and webhooks (event types, HMAC verification, retry policy, idempotency).
---

# Privy Security & Webhooks

## Source docs synthesized

- `C:\Users\worka\OneDrive\Desktop\Privy\Security Architecture.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\Secure Enclaves.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\On Device execution env.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\IP allowlist.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\allowed-domains.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\allowed-oauth-redirects.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\Content Security Policies.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\preventing-bots.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\Security Checklist.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\Security FAQs.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\Webhooks.md`
- `C:\Users\worka\OneDrive\Desktop\Privy\webhooks (1).md`
- `C:\Users\worka\OneDrive\Desktop\Privy\analytics-cors.md`

---

## Core concepts: security architecture

Privy's security architecture combines trusted execution environments (TEEs) with distributed key sharding to protect users' assets. Simply put:

- Keys are only stored as encrypted shares distributed across separate security boundaries.
- Keys are only temporarily reconstructed within trusted execution environments when needed for specific operations, under the wallet owner's control.

### Where keys live (trust boundaries)

- **Enclave share (TEE share)** - secured directly by the trusted execution environment and encrypted with the TEE's cryptographic key. Can only be decrypted within the TEE.
- **Auth share** - encrypted and stored by Privy. Accessible only with valid authentication credentials (bearer token or app secret). Sent to the enclave on every wallet action.
- **Device share** (on-device execution only) - persisted in the user's device. In a browser, stored in domain-partitioned local storage via the Privy iframe.
- **Recovery share** (on-device execution only) - used to provision the wallet on new devices. Encrypted and secured either through user-managed methods (password or cloud backup) or Privy's recovery key management system.

This is a 2-of-2 share set. Neither share in isolation provides any information or access to the wallet.

### Trusted execution environments (TEEs)

TEEs - also known as secure enclaves - are highly restricted, isolated compute environments that allow for secure code execution and cryptographic verification (attestation) of the code being executed. Privy uses AWS Nitro Enclaves.

Privy uses TEEs for the following processor-level guarantees:

- Enclaves have no persistent storage, no interactive access, and no network connectivity.
- Private keys for wallets are only accessible within the enclave and can only be used to produce signatures compliant with the policies attached to the wallet.
- Attestations are cryptographic verifications of the computation run on a TEE. They are signed hashes of code on an enclave that can be verified with the corresponding public key.

### Key sharding cryptography

Privy uses Shamir's secret sharing (SSS) for key sharding. The open-source `shamir-secret-sharing` library is heavily audited and used to secure millions of wallets. Key sharding enables:

- Future-proof flexibility
- Strict security isolation
- Built-in redundancy
- Separate authentication and encryption of each distributed share

Key sharding and assembly only ever occur within the trusted execution environment.

### Threat model summary

Privy works to secure user assets and data in three main ways:

- **Proactive security** - resource isolation and cryptographic architecture layered with a defense-in-depth approach, designed to protect wallets. Quarterly cryptographic and infrastructure audits, Vulnerability Disclosure Program, and active Bug Bounty Program.
- **Active monitoring** - instrumented for active monitoring. Automated alerts triggered by unexpected or abnormal activity. On-call engineering team 24/7. Monitoring across the threat landscape.
- **Defensive measures** - failsafes to enable developers and users to cut off access to key material in the event of an emergency. Pre-approved procedures with enterprise customers.

### Compliance and audits

- Cryptographic and infrastructure audits on a quarterly basis.
- Vulnerability Disclosure Program and active Bug Bounty Program.
- All code changes to TEEs require multi-party approvals and hardware security key requirements.
- Branch protection rules, security scanning, and signing requirements in CI/CD.

---

## Secure enclaves (verbatim from Secure Enclaves.md)

Privy's wallet infrastructure is designed so that the only place a full private key ever exists is inside a secure enclave. Privy relies on hardened trusted execution environments to wrap the most sensitive parts of the system: key generation, policy enforcement, and signing with hardware-backed isolation.

### Why secure enclaves matter

- **Hardware isolation** - The secure enclave runtime provides a CPU-level sandbox with no persistent storage, no interactive access, and memory that is encrypted while in use. Even if another component is compromised, keys remain protected inside the enclave.
- **Defense in depth** - Every wallet uses Shamir secret sharing to produce split, encrypted key shares, along with authorization signatures and policy checks. The two shares live on separate pieces of infrastructure: one protected by the enclave, the other by the API. Compromising a single provider is not enough to recover a key.
- **Measured boot** - Each enclave boots from a signed image. Attestation reports are verified before provisioning secrets, so only approved code can handle wallet operations, and those secrets are sealed so they can only be unwrapped by that approved image.

### How requests are processed

1. Your service calls the Privy API from infrastructure you control.
2. The API, running on isolated infrastructure outside the enclave, retrieves the encrypted share that corresponds to its shard of the wallet.
3. Only the enclave can combine that incoming shard with its own encrypted shard. Reconstruction happens in-memory just long enough to execute the requested action.
4. Authorization signatures and policies are verified inside the enclave before any signing can occur. Only after every control passes does the enclave produce the minimal response (for example, a transaction signature) and discard the reconstituted key material.

Because the API and the enclave sit in different trust boundaries, compromising one provider is not enough to access private keys. Both encrypted shares and policy validation must succeed within the enclave for any action to complete.

### What enclave attestation gives you

- **Sealed secrets** - Sensitive configuration and the enclave's key shard are encrypted to the enclave image. They only decrypt after the image identity is verified through the attestation flow.
- **Independent validation** - Privy's build pipeline and enclave attestation are issued by separate hardened systems. Images are signed in one environment, and attestation materials are generated and verified in another.
- **Operational transparency** - Coming soon: customers will be able to access enclave attestation documents and measurements to verify that their workloads are running on the expected image.

### Enclave FAQs

- **Do Privy engineers have access to user keys?** No. Key shares are intentionally separated. Privy team members cannot reconstruct keys or bypass policy checks, and the enclave never exposes its shard.
- **What if a cloud provider is compromised?** Both shares are encrypted end to end. One stays sealed inside the trusted execution environment; the other is stored on separate infrastructure and only released to an attested enclave.
- **Can anyone update the wallet database outside the enclave?** No. All sensitive state transitions are signed inside the enclave.
- **How are updates handled?** Enclave images undergo multi-party review, automated testing, and attestation validation before deployment. Updates roll out gradually, with builds signed in one hardened system and attestation issued in a separate environment before the enclave can accept traffic.
- **How does disaster recovery work?** Enclaves are stateless. If an enclave is replaced, it rehydrates from sealed secrets only after attestation. Key shards remain encrypted and are never stored together.

---

## On-device execution environment (verbatim from On Device execution env.md)

Privy's security architecture leverages secure execution environments to protect users' assets. Wallet private keys are only temporarily reconstructed within these strictly isolated, secure execution environments when needed for specific operations, under the wallet owner's control.

Privy provides two types of secure execution environments: TEEs and on-device execution. Each environment ensures that private keys are never stored in complete form and are only temporarily reconstructed when needed.

By default, Privy uses trusted execution environments (TEEs), also known as secure enclaves, for secure wallet operations. As an advanced setting, Privy also enables wallets to be reassembled directly on user devices.

On-device execution is an advanced configuration. Reach out to Privy to enable this setting.

- On-device execution enables the fastest-possible signing speed (5 ms), but involves a more limited feature set.
- If you have on-device execution enabled, you will see "On-device" as the Wallet environment in your app's Wallet > Advanced settings page. Otherwise, your app uses TEE execution.
- You can migrate from on-device to TEE execution. Apps may only operate in one environment.

### Browser-isolated execution environments on user devices

With on-device execution, Privy secures wallets directly on user devices using browser-enforced isolation via iframes. This relies on the same browser security boundaries that have been battle-tested for decades.

The Privy iframe runs in a separate process with its own isolated memory space, completely separated from your application. This isolation is enforced by:

- Hardware-level memory protection
- Browser process separation
- Strict origin and frame ancestor validation
- Content Security Policy controls that strictly lock down network access

### Three share types in on-device execution

- **Device share** - persisted on the user's device. In a browser environment, stored in the browser's domain-partitioned local storage via the iframe.
- **Auth share** - encrypted and stored by Privy. Accessible only with valid user authentication.
- **Recovery share** - used to provision the wallet on new user devices. Encrypted and secured either through user-managed methods (password or cloud backup) or Privy's recovery key management system.

Two shares must be present to reconstruct the private key, which only happens temporarily within the iframe on the user's device.

Typical operation involves sets of 2-of-2 shares, where a device-specific share and an auth share are provisioned for each device on which a wallet is used. Similarly, a recovery share and recovery-specific auth share are provisioned to enable recovery on new devices.

### Securing the recovery share

**Automatic recovery** - Privy's key management system secures the encrypted recovery share, allowing users to provision their wallet on new devices through normal authentication. Privy infrastructure ensures only the user can decrypt their recovery share on their device. When using automatic recovery, you are trusting Privy's infrastructure to secure the user's recovery share, and the user's authentication token as the sole root of trust for their wallet.

**User-managed recovery**:

- **Passwords** - users can set a strong memorable password to secure the recovery share for their wallet. Privy has no knowledge of the user's password and cannot decrypt the recovery share.
- **Cloud-backup** - the recovery share is secured by a recovery decryption key that is backed up to the user's cloud storage account (e.g. Google Drive or iCloud). Privy cannot access this backup and cannot decrypt the recovery share.

### Signing a transaction (on-device)

1. Your application passes the transaction data through the Privy SDK.
2. The secure iframe validates authentication and retrieves necessary encrypted shares.
3. Key reconstruction occurs only in the iframe's isolated memory.
4. The key is used temporarily in-memory for cryptographic signing.
5. Only the signature is returned to your application.

Because Privy wallets are provisioned directly on user devices, cryptographic signing is extremely fast (5 ms).

### Provision new devices

When a user accesses your app on a new device, the iframe retrieves the auth share for your user during the login process. Then, depending on how you've configured recovery, the iframe decrypts the recovery share for your user by:

- requesting the recovery decryption key using the user's auth token, if using automatic recovery
- having the user decrypt the key using their recovery factor (password or cloud account), if using user-managed recovery

With the auth share and the recovery share, the iframe provisions a new device share for the new device.

### External key recovery

With Privy's architecture, a user is able to recover their private key even if they lose their device or if they lose access to your app.

- If the user loses access to their device and is unable to retrieve their device share, they can combine their auth share and decrypt their recovery share to reconstitute the full private key.
- If the user loses access to your app and is unable to retrieve their auth share, Privy enables an external recovery service so that users are always able to export their wallet.

In all of these cases, Privy rotates keys to ensure compromised devices or authentication methods cannot be combined to maliciously reconstitute the private key.

---

## IP allowlist (verbatim from IP allowlist.md)

The IP allowlist restricts server-to-server API access to specific IP addresses and CIDR ranges. When enabled, only requests from allowlisted IP addresses can authenticate using the app secret. This protects against unauthorized API access if credentials are compromised.

The IP allowlist only applies to server-to-server requests using Basic authentication with your app secret. User authentication and dashboard access are not affected by this setting.

### How it works

When your server makes an API request using Basic authentication (app ID and app secret), Privy validates the request's source IP address against your configured allowlist:

- If the allowlist is empty, all IP addresses are permitted (feature disabled).
- If the allowlist contains entries, only matching IP addresses can complete the request.
- Non-matching requests receive a `403 Forbidden` error.

### Supported formats

| Format       | Example       | Description               |
| ------------ | ------------- | ------------------------- |
| IPv4 address | `192.168.1.1` | Single IPv4 address       |
| IPv6 address | `2001:db8::1` | Single IPv6 address       |
| CIDR range   | `10.0.0.0/8`  | IP range in CIDR notation |

Use CIDR notation to allowlist entire IP ranges. For example, `192.168.1.0/24` allows all addresses from `192.168.1.0` to `192.168.1.255`.

### IPv6-mapped IPv4 addresses

IPv6-mapped IPv4 addresses (e.g., `::ffff:192.168.1.1`) are automatically normalized to their standard IPv4 format for comparison. This ensures consistent matching regardless of how the client IP is reported.

### Configure the IP allowlist

Configure the IP allowlist in the Privy Dashboard under Configuration > App settings.

1. Navigate to the IP allowlist section in your app settings.
2. Enter IP addresses or CIDR ranges, one per line.
3. Save your changes.

Before enabling the IP allowlist, ensure your server's IP addresses are added. Adding entries to an empty allowlist immediately enables IP restrictions, which may block your existing integrations.

### Error handling

When a request originates from a non-allowlisted IP address, the API returns a `403 Forbidden` error with a generic message. This prevents IP enumeration attacks by not revealing whether the IP allowlist is enabled or which IPs are allowed.

### Best practices

**Use CIDR ranges for cloud providers** - Cloud infrastructure often uses dynamic IP addresses. Configure CIDR ranges for your cloud provider's IP ranges rather than individual addresses:

- For AWS, use the published IP address ranges
- For Google Cloud, use Cloud NAT with static IPs
- For Azure, configure outbound IP addresses

**Test before enabling** - Before adding entries to an empty allowlist:

1. Identify all IP addresses your servers use for outbound requests
2. Test the IP addresses using a staging environment
3. Add all required IP addresses before enabling

**Monitor for blocked requests** - After enabling the IP allowlist, monitor your application logs for unexpected authentication failures. Blocked requests may indicate missing IP addresses in the allowlist or infrastructure changes that modified your outbound IP.

---

## Allowed domains (verbatim from allowed-domains.md)

Use the Configuration > App settings page > Domains tab of the Privy Dashboard to manage allowed origins for web and native mobile apps and to manage HttpOnly cookies in web apps.

You should only use this setting when using Privy in a production website.

### Browser (web & mobile web)

In a browser environment (web & mobile web), allowed origins restrict which domains are allowed to use your Privy app ID.

In the Allowed origins section of this page, select the Web & mobile web option. In the input field, list any domains that will use your Privy app ID, separated by commas, spaces, or breaks.

Requirements:

- The protocol (`https`) is required.
- Trailing paths (`/path`) are not supported.
- Wildcards (`*`) are only supported as a subdomain (`*.domain.com`), but not as a domain alone (`*.com`).
- Partial wildcards of the form `*-sometext.domain.com` are not supported.
- Localhost (`http://localhost:port`) is supported but you must specify the port number. Though supported, do not recommend listing `localhost` as an allowed domain for production apps.

Many hosting providers and their corresponding DNS configurations treat `https://www.example.com` and `https://example.com` interchangeably. If these URLs are equivalent for your app setup, add both (with and without the `www` subdomain) domains as allowed origins to the dashboard.

Setting allowed domains restricts client-side access to your Privy app ID only. Privy's REST API endpoints that you would query from your backend are gated by your app secret, which should never be exposed on a user's client.

### Supporting preview URLs

Many hosting providers (e.g. Vercel) support preview deployment URLs to make it easy to test changes, like:

```
// Matches the pattern *.netlify.app, which anyone with a free Netlify account can deploy to
deploy-preview-id--yoursitename.netlify.app
```

For security reasons, Privy does not allow whitelisting domains with a generic pattern that are commonly used for these preview deployments, such as:

- `https://*.netlify.app` / `https://*.vercel.app`
- `https://*-projectname.netlify.app` / `https://*-projectname.vercel.app`

Any project can deploy to a domain that matches `https://*.netlify.app`, `https://*.vercel.app`, or similar. If you were to whitelist this domain for your production App ID, any actor could set up any arbitrary deployment with your hosting provider and can use your production App ID within their site.

If you'd like to secure your Privy App ID on preview deployment URLs, check if your hosting provider allows you to map preview deployments to a stable subdomain that only you control, like:

```
// Matches the pattern *.yoursitename.netlify.app, which only members of your Netlify account
// (or hosting provider) can deploy to
deploy-preview-42.yoursitename.netlify.app
```

This allows you to list `https://*.yoursitename.netlify.app` under allowed domains, which arbitrary actors cannot deploy to.

### Native mobile

In a native mobile environment (e.g. iOS and Android apps), allowed origins request which application identifiers are allowed to use your Privy app ID.

In the Allowed origins section of this page, select the Native option. In the input field, list any application identifiers that will use your Privy app ID, separated by commas, spaces, or breaks.

### HttpOnly Cookies

Set secure cookies that restrict access to client-side scripts, protecting sensitive data from XSS attacks. Once toggled on, you'll be prompted to add an app domain which Privy uses to store user access tokens as a first-party cookie. This improves your app security and enhances your app with features like server-side rendering (SSR).

---

## Allowed OAuth redirects (verbatim from allowed-oauth-redirects.md)

Similar to allowed domains, you can configure allowed OAuth redirect URLs to restrict where users can be redirected after they log in with an external OAuth provider. This is a security best practice that prevents users from being redirected to malicious sites with their authentication token.

To configure allowed OAuth redirect URLs, navigate to Configuration > App settings > Advanced on the dashboard. Add the OAuth providers are allowed to redirect to after authentication.

Notes:

- The URL must be an exact match for the redirect URL; query params and trailing slashes will error.
- The URL must be at a domain listed in allowed domains.
- The protocol (`https`) is required.
- Wildcards (`*`) are not supported.
- If no URLs are listed, users can be redirected to any URL.

---

## Content Security Policy (verbatim from Content Security Policies.md)

If you are using Privy in a web client environment, set a strict Content Security Policy (CSP) as a defense-in-depth strategy to mitigate XSS, clickjacking, and cross-site leak vulnerabilities.

### Base CSP configuration (raw header)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org;
  frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com;
  connect-src 'self' https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com;
  worker-src 'self';
  manifest-src 'self'
```

### Express helmet example (Spectre stack)

```js
const helmet = require("helmet");

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      childSrc: ["https://auth.privy.io"],
      frameSrc: ["https://auth.privy.io", "https://challenges.cloudflare.com"],
      connectSrc: [
        "'self'",
        "https://auth.privy.io",
        "https://*.rpc.privy.systems",
        "https://api.mainnet-beta.solana.com",
      ],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
    },
  })
);
```

### Required domains for @privy-io/react-auth

If you have a base domain enabled, you must also add your domain-specific Privy instance, e.g. `https://privy.your-base-domain.com`.

- `child-src`
  - `https://auth.privy.io` (Privy iframe)
  - `https://verify.walletconnect.com` (WalletConnect iframe)
  - `https://verify.walletconnect.org` (WalletConnect fallback iframe)
- `frame-src`
  - `https://auth.privy.io` (Privy iframe)
  - `https://verify.walletconnect.com` (WalletConnect iframe)
  - `https://verify.walletconnect.org` (WalletConnect fallback iframe)
- `connect-src`
  - `https://auth.privy.io` (Privy API)
  - `wss://relay.walletconnect.com` (WalletConnect API)
  - `wss://relay.walletconnect.org` (WalletConnect fallback API)
  - `wss://www.walletlink.org` (Coinbase Wallet API)
  - `https://*.rpc.privy.systems` (Privy RPC provider)
  - `https://explorer-api.walletconnect.com` (WalletConnect Explorer API)

### Optional features

If your app uses Telegram login or linking, add:

- `frame-src`: `https://oauth.telegram.org` (Telegram OAuth domain)
- `script-src`: `https://telegram.org` (Telegram login domain)

If your app uses Privy's funding kit, add:

- `connect-src`:
  - `https://api.relay.link` (Relay Bridging Provider)
  - `https://api.testnets.relay.link` (Relay Bridging Provider for testnets)

If your app is on Solana, add the Solana cluster endpoints if an override is not provided:

- `connect-src`:
  - `https://api.mainnet-beta.solana.com`
  - `https://api.devnet.solana.com`
  - `https://api.testnet.solana.com`

If your app uses CAPTCHA, add (based on provider):

- `frame-src`
  - `https://challenges.cloudflare.com` (Cloudflare Turnstile)
  - `https://hcaptcha.com` (hCaptcha)
  - `https://*.hcaptcha.com` (hCaptcha)
- `connect-src`
  - `https://hcaptcha.com` (hCaptcha)
  - `https://*.hcaptcha.com` (hCaptcha)
- `script-src`
  - `https://challenges.cloudflare.com` (Cloudflare Turnstile)
  - `https://hcaptcha.com` (hCaptcha)
  - `https://*.hcaptcha.com` (hCaptcha)
- `style-src`
  - `https://hcaptcha.com` (hCaptcha)
  - `https://*.hcaptcha.com` (hCaptcha)

### Best practices

1. **Start strict** - Begin with restrictive policies, and loosen only as needed. Document all exceptions.
2. **Test regularly** - Test your CSP after dependency updates and validate during deployments. Check compatibility across different browsers.
3. **Monitor** - Track violation reports and monitor performance impact. Watch for bypass attempts.
4. **Document changes and procedures** - Record all CSP changes and document allowed sources.

### Testing and deployment

Run through your standard user flows in a staging environment with CSP enforcement (browser extension wallets, mobile app wallets, transacting, logging out, etc).

Whenever upgrading the Privy SDK, always test your CSP again before deploying the update to production.

**Report-Only mode** - Most browsers support a `Content-Security-Policy-Report-Only` header, which sends violation reports without actually enforcing policies. Allows the developer to judge whether a modification to their CSP will impact their site's expected functionality.

If your policy is strict, you will see many reported violations due to extensions trying to inject scripts into the browser. This is completely normal.

**Deployment recommendation** - First deploy your CSP in report-only mode with the header `Content-Security-Policy-Report-Only`. Once validated in production, migrate to `Content-Security-Policy`, which will enforce directive violations. You can deploy with both headers set simultaneously to A/B test.

**Monitoring** - Configure the `report-uri` to see violation/enforcement reports and set up a monitoring dashboard.

### Important directives

- Keep `script-src` as locked down as possible to prevent malicious code execution
- Set `frame-ancestors` to `none` unless you expect your website to be embedded
- Keep `connect-src` as locked down as possible to prevent unauthorized data exfiltration
- Use `child-src` and `frame-src` to control iframe loading and execution
- Consider `worker-src` if using web workers
- Implement `default-src` as a fallback for unlisted directives

---

## Preventing bots (verbatim from preventing-bots.md)

The strongest bot mitigation setup combines several controls. Start in the Privy dashboard and then add sitewide protections.

### 1. Enable invisible CAPTCHA

Privy supports invisible CAPTCHA with Cloudflare Turnstile and hCaptcha. Enable CAPTCHA in App settings > Advanced.

When using hCaptcha, configure the risk tolerance setting to define how strictly the system blocks suspicious attempts.

When using a strict CSP, include CAPTCHA domains in policy directives.

### 2. Block low-quality email signups

On the Authentication page, enable email restrictions that reduce throwaway account creation:

- Block temporary email domains
- Disable `+` aliases in email addresses

Privy uses `mailchecker` to identify temporary email domains. Blocking `+` aliases increases friction for abuse, but may also impact legitimate alias usage. Choose this setting based on your app's risk profile.

### 3. Block VOIP numbers for phone login

On the Authentication page, enable VOIP blocking for phone login. When SMS or WhatsApp login is enabled, block VOIP numbers to reduce disposable phone signups and OTP abuse.

### 4. Use the denylist for repeat offenders

Supported denylist entries include:

- Email addresses
- Email domains
- Phone numbers
- EVM wallet addresses
- Solana wallet addresses

### 5. Add sitewide Cloudflare protections

A practical Cloudflare setup usually includes:

- Bot management or Super Bot Fight Mode
- Managed Challenge on high-risk pages like sign up and login
- Blocking or challenging high-risk traffic segments for your app's threat model

### 6. Add supporting controls

For stronger defense in depth, also configure:

- Allowed domains to prevent unauthorized client usage of your app ID
- Allowed OAuth redirects to reduce OAuth abuse risk
- MFA for sensitive or high-value actions
- Minimum required login methods only, to reduce attack surface

Anti-bot strategy should evolve with traffic patterns. Review signup quality, OTP volume, and conversion rates on a regular cadence.

### Bot FAQ

- **Legitimate users failing CAPTCHA** - CAPTCHA providers do not share specific details about how they classify attempts as bot-like traffic. Users can try: disabling VPN/proxy/traffic filtering tools, trying an incognito/private window, trying a different browser or device, switching networks, retrying after a short wait.
- **Deleting bots** - Privy does not recommend deleting users unless absolutely necessary. Blocking future access with the denylist is usually a better first step.
- **Twilio SMS fraud** - Enable Twilio Fraud Guard and review Twilio Verify geo-permissions to limit risky destination regions.

---

## Security checklist (verbatim from Security Checklist.md)

Before deploying Privy in production, there are several important security configurations to consider.

### Secure your client environment

Your application client provides the context in which users access their accounts. Follow client-side security best practices, including limiting what is able to inject JavaScript into your site. Make sure only the code you intend runs in your app.

#### Web integrations

**Restrict allowed domains**:

- Add your production domain in the Configuration > App settings page of the Privy Dashboard
- Remove any test or development domains

Using domains not configured in your allowed domains list will cause your integration to fail. This is an important security measure that protects your users.

**Configure HttpOnly cookies** - To enable HttpOnly cookies for enhanced security, verify your domain ownership through a setup process in the Privy dashboard.

**Security headers** - Configure proper security headers:

- Implement a strict Content Security Policy
- Configure appropriate CORS settings
- Set secure cookie attributes when using HttpOnly cookies

#### Mobile integrations

**Restrict allowed native app IDs** - Set your mobile project's bundle identifier as the required native app identifier.

### Set up authentication

Authentication security starts with choosing appropriate methods for your application.

#### Login methods

For high-value applications:

- Disable SMS-based authentication to prevent SIM-swapping attacks
- Enable strong MFA options like authenticator apps or passkeys
- Configure appropriate session duration. The default is 30 days. You can do this using app clients.

#### OAuth configuration

If using social login:

- Set up allowed OAuth redirect URLs
- Review OAuth scopes and permissions
- Enable only necessary social providers
- Monitor OAuth token security

### Protect your wallets

#### Embedded wallets

For wallets that users interact with directly through your application, enable increasingly strict security settings as account value increases.

**High-value assets**:

- Require MFA for all sensitive operations
- Enable user-managed recovery through password or cloud backup
- Set up emergency contacts and procedures

**Standard use cases**:

- Enable users to optionally configure MFA
- Configure automatic recovery with appropriate login methods
- Implement user education about security best practices

#### Secure server-controlled wallets

**Authorization keys** - Set an owner on the wallet to add an additional layer of security for transaction signing. Transaction requests must be authorized with two factors: 1) your Privy app secret and 2) a signature from an authorization key.

- Use a hardware-backed KMS (key management system) such as AWS KMS to secure authorization keys. Hardware-backed KMS systems disallow any export of keys.
- Rotate authorization keys regularly, by updating the owner on wallets to a new key on a regular basis (every 90-180 days).
- Segregate wallets by setting different keys as the owner on different wallets.
- Require a quorum of authorization keys to approve a transaction. For example, a 2-of-2 key quorum.
- Back up authorization keys for redundancy. Privy does not have access to authorization keys and cannot recover your authorization key if you lose it.

**Least privilege access** - Separate the keys used for transaction signing from the keys used for policy management. This ensures that even if your backend is compromised and transaction signing keys are exposed, the attacker cannot modify or remove the policies that constrain the wallet's behavior.

To implement this separation:

1. Create two different signing keys: one for managing wallets and policies and one for transaction signing.
   - The management key should be used rarely and only be accessed in a very restricted environment.
   - The transaction signing key will be used frequently and will be accessed by your core application.
2. When creating a wallet or policy, set the management key as the `owner`, which will make its signature required for any updates.
3. On your wallet, set your transaction signing key and the policy it is subject to as an `additional_signer`.

This creates a robust security boundary where:

- Transaction signing keys can only operate within policy constraints
- Policy management keys are rarely used and can be stored with higher security
- A compromise of transaction signing infrastructure cannot escalate to policy modification

The keys above can be quorums (e.g., 2-of-3 keys), providing additional security through multi-party authorization requirements.

**Other security recommendations**:

- Set a policy on the wallet to limit the types of transactions that may be processed
- Monitor API usage and implement rate limiting
- Set up alerts for unusual activity
- Use separate development and production credentials
- Implement proper logging and audit trails

### Secret scanning

Use a secret scanning tool to detect accidental disclosure of sensitive credentials in your project.

- Privy authorization private keys generated since January 2025 match the regex `wallet-auth:[A-Za-z0-9+/]{16,}`. Older private keys may have a prefix of `wallet-api:` or no prefix.
- Privy app secrets generated since mid December 2025 match `privy_app_secret_[A-Za-z0-9]{16,}`. Older app secrets have no prefix.

---

## Security FAQs (verbatim from Security FAQs.md)

Threat models are an essential part of building secure systems. Establishing a threat model means understanding the robustness of a system against a given attacker and context.

### Security philosophy

Security is continuous work, not a one-time achievement. Privy recognizes that wallets are not one size fits all, and builds highly configurable, flexible wallet infrastructure so you can configure the system appropriate for your use case. Moreover, security needs evolve as asset value grows.

Privy gives developers flexibility to build appropriate experiences while guiding them toward security best practices. They support the full spectrum from email-based embedded wallets to hardware-secured cold storage, recognizing the inherent tradeoffs in any cryptosystem.

### Cross-application security

**Q: Can unauthorized applications access the Privy iframe?**
No. The iframe enforces that all frame ancestors must be an allowed origin set by an application admin within the Privy dashboard. This is enforced by both frame ancestor CSP checks and in-code origin validation.

**Q: Can unauthorized applications send messages to the Privy iframe?**
No. The Privy iframe only accepts messages from its parent frame. The iframe message handler checks the origin of messages received and confirms they are from an approved parent origin. Additionally, the Privy iframe requires a valid access token to authenticate messages received from its parent frame.

**Q: Can a Privy customer's application interfere with another customer's iframe?**
No. Browser controls and authentication controls enforce isolation between applications. Iframe contexts run in separate processes and do not share memory.

### User security

**Q: Can an unauthorized user access another user's wallet?**
No. A valid access token is required to access a wallet. Specifically, the user's access token is required to retrieve the auth share needed to reconstruct the wallet. Access tokens are only granted to authenticated users and are stored as either localStorage or HttpOnly cookies depending on configuration.

**Q: How are users protected if their browser is compromised?**
Privy implements multiple protections:

- Keys never are persisted in complete form
- MFA can be required for wallet operations
- Transaction approval requires the auth share which is not stored on device
- Emergency controls can immediately disable key reconstruction
- Recovery shares can be secured by user-managed methods

### Browser security

**Q: Can bookmarklets and browser extensions inject malicious JavaScript into the iframe?**
In certain cases, yes. There is a CSP nonce on the embedded wallet iframe and the embedded wallet key export page. Browsers are able to verify the iframe code via a server-set nonce, and additionally reject unauthorized code. Privy blocks extensions with CSPs that violate the unsafe eval directive.

However, bookmarklets and extensions have elevated permissions and may have access to things such as browser requests and responses. According to the W3C CSP standard, browser implementations should allow user-agent features to override policies. Browsers enable bookmarklets and extensions to bypass CSP settings and inject JavaScript code onto pages. Educate users to not install untrusted bookmarklets and browser extensions. Furthermore, enable wallet MFA which requires the user to MFA to approve transactions.

**Q: What happens if browser security is compromised?**
Privy maintains multiple layers of protection:

- Emergency kill switches for immediate response
- Access token revocation capabilities
- Geographic access restrictions
- Rapid incident response procedures
- Regular security updates

### Infrastructure security

**Q: Can a compromised Privy team member access user keys?**
No. Keys exist only as encrypted shares distributed across security boundaries. Wallet actions are only accessible within secure execution environments.

**Q: Can a compromised engineer deploy unauthorized code?**
No. Privy maintains a robust deployment security system with multiple independent controls. Code deployed to secure execution environments undergo extensive review and security controls, including strict multi-party approvals.

All code changes require review from multiple designated owners, must pass automated security testing, and go through staged deployments with additional approvals. The Privy CI/CD pipeline ensures build artifacts are deployed directly from protected source code, with branch protection rules and signing requirements.

---

## Webhooks (verbatim from Webhooks.md and webhooks (1).md)

Privy emits webhooks when wallet actions change status, allowing your app to react to swaps, transfers, and earn activity in real time without polling.

### Setup

Subscribe to wallet action events from the Configuration > Webhooks page in the Privy Dashboard.

Webhooks can be tested at no cost in development environments. To enable webhooks in production, upgrade to the Enterprise plan in the Privy Dashboard.

### Status lifecycle

Every wallet action moves through a predictable `status` lifecycle. Privy emits a webhook at each `status` update.

| Status        | Description                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `'created'`   | Wallet action has been queued for execution and resource ID has been returned to the caller.                                             |
| `'succeeded'` | All steps of the wallet action have successfully executed. This is a terminal state.                                                     |
| `'rejected'`  | The wallet action was rejected prior to executing any steps, e.g. due to a policy violation. This is a terminal state and safe to retry. |
| `'failed'`    | The wallet action failed during execution of one of its steps. Use `GET /v1/actions/{action_id}?include=steps` to inspect what failed.   |

### Action-specific payloads

All wallet action webhook payloads include a `type` (event name), `status`, and action `id`. Beyond these fields, payloads include the fields present in that wallet action's resource.

For example, the payloads for `wallet_action.transfer.*` webhooks include the fields when fetching the transfer action resource via `GET /v1/actions/{action_id}` where `action_id` corresponds to a transfer.

### Transfer events

| Event                                | Description                                    |
| ------------------------------------ | ---------------------------------------------- |
| `wallet_action.transfer.created`     | A transfer action is created and queued        |
| `wallet_action.transfer.succeeded`   | The transfer transaction confirms onchain      |
| `wallet_action.transfer.rejected`    | The transfer is rejected before broadcast      |
| `wallet_action.transfer.failed`      | The transfer transaction fails after broadcast |

### Swap events

| Event                            | Description                                |
| -------------------------------- | ------------------------------------------ |
| `wallet_action.swap.created`     | A swap action is created and queued        |
| `wallet_action.swap.succeeded`   | The swap transaction confirms onchain      |
| `wallet_action.swap.rejected`    | The swap is rejected before broadcast      |
| `wallet_action.swap.failed`      | The swap transaction fails after broadcast |

### Earn events (deposit, withdraw, incentive claim)

Each earn flow follows the same `created` / `succeeded` / `rejected` / `failed` pattern as transfer and swap:

- Deposit: `wallet_action.earn_deposit.{created,succeeded,rejected,failed}` - fired when a wallet deposits assets into a yield vault.
- Withdraw: `wallet_action.earn_withdraw.{created,succeeded,rejected,failed}` - fired when a wallet redeems vault shares for the underlying asset plus accrued yield.
- Incentive claim: `wallet_action.earn_incentive_claim.{created,succeeded,rejected,failed}` - fired when a wallet claims additional token rewards distributed by the vault.

For all three: `created` = queued, `succeeded` = confirmed onchain, `rejected` = blocked before broadcast (insufficient balance, policy violation - safe to retry), `failed` = broadcast but reverted onchain (inspect `?include=steps`).

### Common webhook patterns

- **Update user balances after a deposit** - Listen for `wallet_action.earn_deposit.succeeded` to refresh the user's position. Once the webhook fires, call the get position endpoint to fetch the updated `assets_in_vault` balance.
- **Notify users when a withdrawal completes** - Listen for `wallet_action.earn_withdraw.succeeded` to trigger a notification. The webhook payload includes the `wallet_id` and `vault_id`.
- **Handle rejected actions gracefully** - A `rejected` status means no transaction was broadcast - for example, due to insufficient balance or a policy violation. Safely prompt the user to retry.
- **Detect failed transactions** - A `failed` status means a transaction was broadcast but reverted onchain. Use the get wallet action endpoint with `?include=steps` to inspect what went wrong.

---

## Code patterns

### CSP via `<meta>` (for static HTML)

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  child-src https://auth.privy.io;
  frame-src https://auth.privy.io https://challenges.cloudflare.com;
  connect-src 'self' https://auth.privy.io https://*.rpc.privy.systems https://api.mainnet-beta.solana.com;
  worker-src 'self';
  manifest-src 'self';
">
```

### Express webhook HMAC verifier

```js
const crypto = require('crypto');
const express = require('express');

const app = express();

// IMPORTANT: use raw body for HMAC, not JSON-parsed body
app.post(
  '/webhooks/privy',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const signature = req.header('svix-signature') || req.header('x-privy-signature');
    const timestamp = req.header('svix-timestamp');
    const webhookId = req.header('svix-id');

    if (!signature || !timestamp || !webhookId) {
      return res.status(401).send('missing signature headers');
    }

    const secret = process.env.PRIVY_WEBHOOK_SECRET;
    const signedPayload = `${webhookId}.${timestamp}.${req.body.toString('utf8')}`;
    const expected = crypto
      .createHmac('sha256', Buffer.from(secret.split('_')[1] || secret, 'base64'))
      .update(signedPayload)
      .digest('base64');

    // signature header format: v1,<base64>
    const provided = signature.split(' ').map((s) => s.split(',')[1]).filter(Boolean);
    const ok = provided.some((p) =>
      crypto.timingSafeEqual(Buffer.from(p), Buffer.from(expected))
    );
    if (!ok) {
      return res.status(401).send('bad signature');
    }

    const event = JSON.parse(req.body.toString('utf8'));

    // idempotency: persist webhookId, skip if seen
    // route by event.type
    switch (event.type) {
      case 'wallet_action.swap.succeeded':
        // handle
        break;
      case 'wallet_action.transfer.succeeded':
        // handle
        break;
      default:
        break;
    }

    res.status(200).send('ok');
  }
);

app.listen(3001);
```

### Vercel serverless webhook handler

```js
// apps/research/api/webhooks/privy.js
import crypto from 'node:crypto';

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const raw = await readRawBody(req);
  const signature = req.headers['svix-signature'] || req.headers['x-privy-signature'];
  const timestamp = req.headers['svix-timestamp'];
  const webhookId = req.headers['svix-id'];

  if (!signature || !timestamp || !webhookId) {
    res.status(401).send('missing signature headers');
    return;
  }

  const secret = process.env.PRIVY_WEBHOOK_SECRET;
  const signedPayload = `${webhookId}.${timestamp}.${raw.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', Buffer.from(secret.split('_')[1] || secret, 'base64'))
    .update(signedPayload)
    .digest('base64');

  const provided = String(signature)
    .split(' ')
    .map((s) => s.split(',')[1])
    .filter(Boolean);
  const ok = provided.some((p) =>
    crypto.timingSafeEqual(Buffer.from(p), Buffer.from(expected))
  );
  if (!ok) {
    res.status(401).send('bad signature');
    return;
  }

  const event = JSON.parse(raw.toString('utf8'));

  // TODO: persist event.id (or webhookId) for idempotency before processing
  // TODO: route by event.type

  res.status(200).send('ok');
}
```

### Captcha hook (client-side, Privy supports invisible CAPTCHA in dashboard)

```jsx
// Configure invisible CAPTCHA in Privy Dashboard: App settings > Advanced
// No client code is required to enable, just CSP entries (see CSP section)
// Privy handles Turnstile / hCaptcha automatically in the auth iframe
```

### IP allowlist setup checklist

```
# 1. Identify all server IPs that call api.privy.io
#    - production server(s)
#    - staging server(s)
#    - any background workers / cron runners
#    - admin / runbook machines (if they call the API directly)
#
# 2. Resolve outbound NAT IPs for each (your egress IP, not the listener IP)
#    curl https://api.ipify.org
#
# 3. For cloud providers, prefer CIDR ranges (Cloud NAT static IPs on GCP,
#    Elastic IPs on AWS, etc.).
#
# 4. Stage:
#    - In Privy Dashboard > Configuration > App settings > IP allowlist,
#      add IPs but DO NOT enable yet.
#    - Run staging traffic, watch for 403s.
#
# 5. Enable production allowlist during a low-traffic window.
#    Watch app logs for 403s for 30 minutes after enabling.
```

---

## Spectre-specific notes

- **No webhooks today** - We do not subscribe to any Privy webhooks. All trading flows are sync (client signs via embedded wallet, then RPC broadcast). If we add server-controlled wallets or async swaps later we will need a webhook handler (probably at `apps/research/api/webhooks/privy.js` or `packages/server/routes/privy-webhooks.js`).
- **No explicit CSP** - We do not currently send a `Content-Security-Policy` header. This is a defense-in-depth gap. When we add one, see the CSP section for the minimum required directives. Vercel allows setting headers via `vercel.json` `headers` block; the Express server already loads `helmet` in some routes - extend it globally.
- **Allowed domains required for production** - The Privy app ID will not work on any domain not listed in Dashboard > Configuration > App settings > Domains. We need:
  - `http://localhost:5180` (research dev)
  - `http://localhost:5181` (trading dev)
  - `http://localhost:5182` (developer-control dev, if it uses Privy)
  - `https://spectre-app-research.vercel.app` (research prod)
  - `https://spectre-trading.vercel.app` (trading prod)
  - Future custom domains (e.g. `app.spectreai.io`, `trade.spectreai.io`) once DNS is configured.
- **Allowed OAuth redirects** - Same list as above. Each redirect URL must exactly match (no trailing slash, no query params). Any preview deployment URL (e.g. `spectre-app-research-git-<branch>-spectre.vercel.app`) will not work unless explicitly added or unless we map preview deploys to a stable subdomain we control.
- **No captcha enabled** - Cloudflare Turnstile / hCaptcha is off. For our current user base this is fine; if we ever see SMS or email signup abuse, enable Turnstile in Dashboard > App settings > Advanced and add the CSP entries.
- **No IP allowlist enabled** - Our Vercel serverless functions use dynamic egress IPs, so IP allowlist is not practical. The Express server on OVH has a static IP and could be allowlisted, but only if we also stop calling the Privy API directly from Vercel serverless. For now, leave the allowlist empty.
- **Secure enclaves are used by default** - Our Privy app uses TEE execution (the default). We have not requested on-device execution. Signing speed is server-side TEE-based (~100ms typical), not the 5ms on-device speed.
- **MFA / passkeys** - We do not currently require MFA. If we enable passkey MFA, secure enclaves are still the signing environment; passkeys are an additional authentication factor on top of the existing auth-token flow.
- **App secret rotation** - The `PRIVY_APP_SECRET` env var is in Vercel project settings and the OVH server's `.env`. Rotate when team membership changes (especially Sunny/Gleb shared `spectreaibot` account if compromised). Old secrets must be deleted from the Privy dashboard, not just unset locally.

---

## Gotchas

- **CSP `frame-src` must allow `https://auth.privy.io`** - This is the Privy iframe origin. Without it, login modals will be blank and `usePrivy().login()` will silently fail. Same for `child-src`.
- **Allowed domains is host-only** - You cannot list `https://app.example.com/login`. Only the origin `https://app.example.com`. Trailing paths cause save to error.
- **OAuth redirects are exact match** - `https://app.example.com/auth/callback` does not match `https://app.example.com/auth/callback/`. Query params also fail. List every variant explicitly.
- **OAuth preview URL pitfall** - On Vercel/Netlify, preview deploys get unique hostnames like `myapp-git-foo-team.vercel.app`. These will not match your allowed OAuth redirects, so OAuth login is broken on previews. Workarounds: 1) map preview deploys to a stable subdomain `*.preview.yourdomain.com`, 2) use a separate Privy app ID for previews, or 3) test OAuth only in production.
- **Webhook secrets per environment** - Each environment (dev / staging / prod) has a separate webhook secret. Storing a single `PRIVY_WEBHOOK_SECRET` in shared env vars across environments will cause signature verification failures. Use `PRIVY_WEBHOOK_SECRET_DEV` / `_PROD` or scope per-Vercel-environment.
- **HMAC on raw body, not JSON** - Verifying webhook signatures requires the exact raw request body bytes. `express.json()` re-serializes and changes whitespace - signature verification will fail. Use `express.raw({ type: 'application/json' })` for the webhook route specifically.
- **Webhooks can arrive out of order** - For a single wallet action, `created` should always precede `succeeded/rejected/failed`, but at-least-once delivery and retries mean you may see `succeeded` before `created` arrives. Always look up the action via `GET /v1/actions/{action_id}` to fetch the canonical state; treat the webhook as a notification to refresh, not a source of truth.
- **Webhook re-delivery** - Privy retries failed webhooks (non-2xx response, timeout). Idempotency is required: persist `event.id` (or the `svix-id` header) and short-circuit on duplicate. Without this, you will double-credit users on retries.
- **Bot prevention can lock users out** - CAPTCHA + VOIP blocking + email aliases blocked + denylist can collectively block legitimate users on VPNs, corporate networks, or anyone with a `+alias@gmail.com` email. Roll out one mitigation at a time and watch signup conversion.
- **IP allowlist doesn't work with Vercel serverless dynamic IPs** - Vercel functions egress from a wide pool of IPs that change without notice. Enabling the IP allowlist with serverless-only infrastructure will break the integration. Either: 1) route all Privy API calls through a static-IP server (our OVH box), 2) use Vercel's static IP add-on (paid), or 3) leave the allowlist empty.
- **Localhost only works if you specify the port** - `http://localhost` is rejected; `http://localhost:5180` works. Each app needs its own entry.
- **`www` vs non-`www` mismatch** - If your DNS points both `example.com` and `www.example.com` at the same site, list both as allowed domains; Privy treats them as distinct origins.
- **Analytics CORS errors are benign** - `Access to fetch at 'https://auth.privy.io/api/v1/analytics_events' from origin has been blocked by CORS policy` in the browser console is the SDK sending anonymous usage analytics. It does not affect functionality and can be ignored.
- **Bookmarklets and browser extensions can bypass CSP** - According to the W3C CSP standard, user-agent features can override policies. Educate high-value users to not install untrusted bookmarklets, and require wallet MFA for sensitive operations.
- **TEE vs on-device migration** - Apps may only operate in one environment. You can migrate from on-device to TEE, but not freely switch back and forth. If you need on-device signing speed (5ms), reach out to Privy to enable before launch.
- **Authorization key prefixes** - Privy authorization private keys generated since January 2025 match `wallet-auth:[A-Za-z0-9+/]{16,}`. Older keys may have `wallet-api:` or no prefix. Secret-scanning regex must cover all three forms.
- **App secret prefix** - Privy app secrets generated since mid December 2025 match `privy_app_secret_[A-Za-z0-9]{16,}`. Older secrets have no prefix. Update your secret scanner.

---

## Cross-references

- `08-server-sdk.md` - server-side API authentication uses the app secret that the IP allowlist gates; webhook handlers typically live in the server SDK layer.
- `01-auth-and-identity.md` - allowed domains, OAuth redirects, and MFA settings all flow through user authentication. Access tokens are required for the auth share retrieval that drives secure enclave signing.
- `02-embedded-wallets.md` - secure enclaves are the default execution environment for embedded wallets; on-device execution is an alternative described above. Recovery flows reference share architecture.
- `10-wallet-controls-and-authorization.md` - authorization keys, policies, and quorum approval all interact with the security checklist's recommendations for server-controlled wallets.
- `09-ui-and-customization.md` - CSP `frame-src` must include `https://auth.privy.io` for the login modal UI to render.
- `14-errors-and-troubleshooting.md` - 401 / 403 errors on webhook endpoints (signature failures), 403 on IP allowlist mismatches, and CSP-blocked iframe errors are documented in detail there.
