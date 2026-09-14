# 10 - Social engineering and physical security

The category most crypto teams underweight. Technical defenses cover ~70% of the attack surface; the remaining 30% targets humans. The largest crypto hacks of the last several years - Ronin ($625M), Bybit ($1.46B), Atomic Wallet, multiple bridge compromises - started with social engineering, not code bugs. For Spectre, founder and developer OPSEC is high-impact; an infostealer on Sunny's or Gleb's laptop is a worse problem than any CSP misconfiguration.

The DPRK-affiliated group (Lazarus / TraderTraitor / APT38) is the dominant adversary in this space and has well-documented playbooks against crypto teams. Most of this file is built around what they actually do.

---

## 10.1 The DPRK playbook against crypto teams

Recurring pattern, deployed against Sky Mavis (Ronin), Atomic Wallet, Bybit, multiple bridges, exchange staff, DeFi developers. Lazarus/TraderTraitor specifically:

**Stage 1: Target identification.**

- LinkedIn scrape of crypto company employees: roles, tenure, tech stack.
- Twitter/Telegram for personality, current projects, frustrations.
- GitHub for technical expertise.
- Conference attendance lists.
- Public posts about job-hunting or career changes (high-signal trigger).

**Stage 2: Approach via recruitment or technical collaboration.**

- LinkedIn message from a "recruiter" at a fake company, often a real-sounding firm.
- Discord/Telegram DM from a "founder" offering a paid contract or partnership.
- "Bug bounty" approach: "I think I found a vulnerability in your product, can you take a look at my PoC?"
- GitHub issue or PR with a malicious payload.

**Stage 3: Deliver the payload.**

- "Technical interview" requires running a coding challenge. The challenge codebase contains hidden malware (often a `package.json` with a postinstall script, or an `npm install` of an attacker-published package).
- "Reproduction steps" for a bug report include `npm install` of an attacker package, or a Docker image to run.
- Word/PDF attachment with macro or exploit payload.
- "Updated SDK" or "video conferencing software update" delivered out-of-band.

**Stage 4: Execute on the dev machine.**

- Infostealer scrapes browser sessions (Slack, GitHub, AWS console, Vercel, etc.), local credential stores, browser-saved passwords, MetaMask vault file.
- Persistence mechanism for long-term access.
- Lateral movement: from the dev machine to GitHub, to CI/CD, to production deploy infrastructure.

**Stage 5: Cash out.**

- For exchanges/bridges: position to manipulate a signing event (Bybit pattern).
- For dev tools/wallets: poison the build to push a drainer to users (Trust Wallet extension pattern, npm chalk pattern).
- For DeFi protocols: extract admin keys or position for a flash loan + governance attack.

**Real cases:**

- **2022 Ronin Bridge, $625M.** Sky Mavis engineer received fake LinkedIn job offer, "interview" included a malicious PDF. Result: validator key compromise across multiple validators.
- **2023 Atomic Wallet.** Unclear initial vector but widely attributed to Lazarus; ended with a wallet drainer pushed via update mechanism.
- **2024 Axie Infinity follow-up incidents.**
- **2025 Bybit, $1.46B.** Safe{Wallet} developer machine compromised via social engineering. The Safe team's forensics noted the same TraderTraitor TTPs.
- **Recurring 2024-2026 against dozens of smaller targets.** Many never disclosed.

The pattern is so consistent that the FBI issued a public PSA in 2024 ("TraderTraitor") and another covering the Bybit incident in 2025.

---

## 10.2 Recruitment-themed lures: the specific defense

Because this is the highest-frequency vector for crypto teams, treat it explicitly.

**Trigger awareness for the team:**

- Unsolicited LinkedIn message offering a high-paying contract or full-time role
- "Quick technical screen" required upfront, especially one involving running code locally
- "Founder of a stealth project" with vague details
- "Investor introduction" via Telegram or Discord
- Tight time pressure ("can you respond by end of week")
- Compensation that's well above market rate
- Sudden, unsolicited "bug bounty" approach from an unknown researcher

**Operational rules:**

- **Never run code from an unknown source on a machine with credentials.** Period. If you're going to evaluate a "coding challenge", use a fresh VM or dedicated burner laptop with no Spectre credentials, no MetaMask, no SSH keys, no browser sessions.
- **Never `npm install` from an untrusted package or repo on a primary dev machine.** Use a container or VM.
- **Don't open Word docs, PDFs, or unknown executables from cold outreach.**
- **Verify the sender independently.** If "John from VCFirm" reaches out, find the real VC firm's website (not from the message), find John's official contact info, verify.
- **Slow down.** Urgency is an attack pattern. Take time to verify.
- **Discuss internally.** "I just got this weird recruiter message, looks too good" - share with the team. Patterns emerge.

For Spectre's team specifically (Sunny, Haitam, Alaa, KD, Adamski, Evgeniy, Gleb): assume the team is being researched. Anyone working on a crypto/AI startup is a target. Make the operational rules above explicit and discussed.

---

## 10.3 Phishing variants

Beyond the recruitment lure, the broader phishing surface:

**Spear phishing.** Targeted, custom-crafted. Uses OSINT from `09-info-disclosure-and-recon.md`. Sender looks like a known contact; subject references real recent project; body is plausible.

**Watering hole.** Compromise a website that the target visits regularly. Crypto news sites, Discord communities, dev forums. Drops malware when target visits.

**Vishing (voice phishing).** Phone call impersonating support, IT, vendor. "Hi, this is Cloudflare support, we need to verify your account..."

**Smishing (SMS phishing).** "Your Coinbase account has been suspended, click here to verify."

**Quishing (QR code phishing).** Sticker over a real QR code (at a conference, restaurant) redirects to phishing site.

**Business email compromise (BEC).** Attacker compromises a vendor or partner email, sends invoices to your accounts payable with attacker bank details.

**Discord/Telegram phishing.** Crypto-specific. Look-alike servers, fake mod accounts, fake giveaway DMs.

**Defense.**

- DMARC, DKIM, SPF set up correctly for your sending domain. Don't let attackers spoof `@spectreai.io`.
- Generic email auth checks (Gmail "this email is from someone you don't normally email" warnings) - keep them on.
- 2FA on everything email-adjacent. Email itself with hardware key 2FA.
- Train the team: phishing simulations are cliché but useful. KnowBe4 or similar.
- Bank wire verification process: any wire above a threshold requires voice confirmation on a known number, not the number on the email.

---

## 10.4 Infostealer malware

Once executed on a dev machine, modern infostealers (RedLine, Vidar, Raccoon, Lumma, StealC, Atomic Stealer for Mac) exfiltrate:

- Browser saved passwords (every site you've ever clicked "save")
- Browser cookies (active sessions for everything you're logged into)
- MetaMask, Phantom, Trust Wallet, other wallet extension vaults (often defeats the password, especially weak ones)
- SSH keys from `~/.ssh/`
- Cloud provider CLI credentials (`~/.aws/credentials`, `gcloud` config)
- Telegram, Discord, Signal session data
- Notes apps (Apple Notes, Notion local cache)
- Cryptocurrency wallet.dat files
- Authenticator app data (for some apps)
- VPN credentials
- Screenshots of the desktop

Then the malware sells the package on a market or uses it directly. From compromise to wallet drain can be hours.

The Atomic Wallet hack reportedly used infostealers as part of the kill chain. The Bybit hack used some variant of this against a Safe{Wallet} developer machine.

**Defense (developer-grade OPSEC):**

- **Hardware wallets for everything significant.** Ledger or Trezor. Software wallets only for hot wallets with small balances.
- **Dedicated machine** for high-value operations (multisig signing, treasury management). Not the daily-driver laptop.
- **Browser hygiene:** don't save passwords in the browser. Use 1Password or Bitwarden. Don't auto-fill on every site.
- **Don't run untrusted code on the primary machine.** Containers, VMs, or burner hardware for evaluating anything.
- **EDR on the laptop.** Defender, CrowdStrike, SentinelOne. Catches known infostealer signatures.
- **OS-level disk encryption.** FileVault (Mac), BitLocker (Windows), LUKS (Linux). Defeats some persistence but not active malware.
- **Frequent reboots and patch discipline.** Stay current.
- **Browser separation.** Different browser profiles or containers (Firefox Multi-Account Containers) for different trust levels. Banking and wallet stuff in a clean profile with no extensions.
- **Limit installed browser extensions.** Each one is a JS execution vector with broad permissions.

For Spectre founders: assume your laptop is the most valuable target. Apply hardware-wallet discipline to credential management. Anything you'd worry about a hacker getting must not live unencrypted on the laptop.

---

## 10.5 Deepfakes and CEO impersonation

**Attack.** Attacker uses video/voice deepfakes to impersonate a known person:

- Voice clone of CEO, calls finance team: "wire urgent funds for the deal"
- Deepfake video call: looks like the CEO, asks for wallet signature or credential disclosure
- AI-generated emails that match the CEO's writing style

**Real cases:**

- 2024 Arup, $25M. Finance employee duped by deepfake video call with what looked like the CFO and other execs.
- Multiple crypto firms 2024-2025: voice clone CEO calls instructing wallet operations.

**Defense.**

- **Out-of-band verification for sensitive requests.** Any wire transfer, credential change, wallet operation above a threshold requires a second channel confirmation. Voice → text-back to a known number. Email → in-person or known-Slack confirmation.
- **Code phrases.** Pre-agreed phrases that the impersonator wouldn't know. Old technique, still works.
- **Awareness.** Team knows that deepfakes are possible and don't trust voice or video alone.
- **Specific to crypto wallets:** never sign anything based on someone telling you to. Independently verify the transaction's purpose against an out-of-band confirmation.

---

## 10.6 SIM swap

**Attack.** Attacker convinces your mobile carrier to port your phone number to their SIM. Now they get your SMS 2FA codes, your "verify your identity" calls. Combined with email phishing or password breach, they can take over accounts that rely on SMS for recovery.

**Real cases:**

- 2019-2022 wave against crypto Twitter influencers. Multi-million dollar wallet losses.
- 2023 SEC Twitter account hijack via SIM swap of an authorized user.
- Ongoing; the carriers haven't fully fixed the underlying process.

**Defense.**

- **Set carrier-side PIN or port-out password.** Every major carrier offers this. T-Mobile, Verizon, AT&T all have specific PINs that must be quoted to port the line. Set one.
- **Remove phone number from account recovery flows.** For anything important (email, exchanges, wallets), 2FA via authenticator app or hardware key, never SMS.
- **Use a VoIP number (Google Voice, Twilio) for accounts** that still require a phone number. Harder to SIM-swap; tied to a Google account that itself has hardware-key 2FA.
- **Separate phone for high-value accounts.** Burner-style dedicated line that you don't share publicly.

---

## 10.7 Insider threats

Less common than external but higher impact when they happen. Categories:

**Malicious insider.** Disgruntled team member, exiting employee, contractor with continued access.

**Negligent insider.** Well-intentioned employee whose mistakes cause breaches. Most common variant. Includes: dev who pushes secrets to a public repo, exec who forwards confidential email to personal account, signer who approves without verifying.

**Compromised insider.** An employee whose machine or credentials are compromised. Often indistinguishable from external attack from a forensics perspective.

**For Spectre with a small team:**

- **Access controls.** Every team member has the minimum access for their role. Frontend devs don't need treasury wallet access. Backend devs don't need registrar access.
- **Audit logging.** Every privileged action is logged. Who did what when. Helps with both detection and recovery.
- **Offboarding discipline.** When someone leaves the team (or transitions), revoke access immediately. Shared credentials rotated. Hardware tokens returned. Audit recent activity from their accounts.
- **No single point of compromise.** Treasury multisig, deploy approvals, key signing - distribute across multiple people such that one bad actor can't unilaterally cause harm.
- **The list of who has what access.** Spectre's: Sunny (CEO), Haitam (backend), Alaa (AI/ML), KD (blockchain), Adamski (blockchain), Evgeniy (frontend), Gleb (COO). For each, what do they have? Quarterly review.

Note: Denis and Bruno are no longer on the team per memory. **Verify their access was revoked across every system they had touched:** GitHub, Vercel, Cloudflare, npm (if applicable), Privy, Firebase, Slack, email, any shared cloud accounts, any signing infrastructure. This is offboarding hygiene; should already be done.

---

## 10.8 Physical security

Often overlooked. Concrete threats for a crypto founder:

**Laptop theft or loss.** Especially traveling. Coffee shops, airports, conferences. Disk encryption defends against the casual thief; doesn't defend against an attacker with time and the device.

**Targeted theft.** Higher-end attacker steals a specific person's laptop or wallet because they know it's valuable.

**Coercion / "$5 wrench attack."** Person knows you have crypto; physical threat to make you transfer it. Largely a problem for high-net-worth public figures; growing as crypto adoption rises.

**Physical access to office or home.** Maid attacks, evil-maid attacks, surveillance device installation.

**Conference / event surveillance.** Charging cables that exfiltrate, "free WiFi" that's malicious, USB drops, shoulder surfing at sensitive moments.

**Defense:**

- **Hardware wallets, geographically distributed.** Cold storage in a safe deposit box; daily-use wallet limited. Loss of one doesn't compromise the rest.
- **Multi-sig with geographically distributed signers.** Same idea, on-chain.
- **Travel laptop separate from primary.** Travel laptop has only what you need for the trip. Wipe on return.
- **No charging at random USB ports.** "Juice jacking" is overhyped but USB power is also a data line; use a wall outlet or a charge-only cable.
- **Disable Bluetooth and AirDrop in untrusted environments.**
- **Don't discuss specific amounts publicly.** Don't post about big trades, big sales, big buys.
- **Personal OPSEC: home address.** Don't tie your real address to crypto identities. Use registered agents for company filings if possible. Consider a PO box.
- **For high-net-worth individuals,** specific physical-security advisors exist. Worth consulting if balances justify.

---

## 10.9 Social media OPSEC

What gets posted publicly informs the attacker.

**Common over-shares from crypto founders:**

- "Just spent the weekend at our team retreat in [location]" - reveals travel patterns
- "Excited to announce [partnership]" - tells attackers about upstream relationships to exploit
- Photos containing reflections, screen contents, badges, conference materials
- Stories revealing daily routines, regular venues
- Replies revealing personal opinions / political affiliations that can be used in social engineering

**Practical rules:**

- Post travel stories *after* you've returned, not while away.
- Audit photos before posting. Reflections in eyes, screens visible in background, badges with QR codes, lanyards.
- Don't combine personal and professional accounts. Personal life on a private/locked account.
- For sensitive announcements: from a verified company account, not personal.
- Be especially careful with "behind the scenes" posts that reveal architecture, vendor relationships, or team composition.

---

## 10.10 Communication channel hygiene

**Email.**

- Hardware-key 2FA on the primary work email account.
- Separate email for high-value account recovery (registrar, Coinbase/Kraken, etc.) that's not used for general correspondence.
- Don't auto-forward email to personal accounts; the forwarding rule survives password rotation.

**Slack.**

- 2FA required for all workspace members.
- Audit installed Slack apps. Each one has bot tokens and channel access. Periodic review.
- No secrets in Slack DMs. Use a password manager.
- Workspace audit logs reviewed periodically.

**Telegram / Discord (common in crypto).**

- Both have known fake-mod and look-alike server scams. Don't DM with strangers about wallet operations.
- Telegram channels can be hijacked via SIM swap of the admin's phone. Multi-admin and 2FA help.
- Discord: enable 2FA, server admin role with caution.

**Signal / WhatsApp.**

- For sensitive coordination, Signal is preferred. End-to-end encrypted, disappearing messages, no phone-number-derived metadata at the server.
- WhatsApp end-to-end encryption is fine for the message content but the metadata is Meta-readable.
- For Spectre operational comms involving wallet signing, treasury operations, or sensitive personnel decisions: Signal with disappearing messages, with verified safety numbers between participants.

---

## 10.11 Specific to crypto signing operations

Multisig signing events are high-value targets. Defense in depth:

- **Hardware wallet only.** Software signers are unsafe for non-trivial values.
- **Dedicated signing machine.** Separate from daily-driver laptop. No browser extensions other than the wallet's. No other accounts logged in.
- **Out-of-band verification.** Before signing, every signer calls another signer (or the operations lead) on a known number, confirms the transaction's intent and the destination address character-by-character.
- **Independent transaction simulation.** Tenderly or BlockSec Phalcon. Verify the actual outcome matches the intended outcome.
- **Geographic and operational separation between signers.** Different people, different machines, different locations.
- **Pre-signing process documented.** Steps every signer takes. Reduces the chance of a hurried mistake.
- **The "if anything feels off, stop" rule.** Always honored, no questions asked. If a signer says "wait, this looks weird", everyone pauses.

This is what Bybit and Safe{Wallet} did not adequately have. The signers approved what the UI showed; the UI was lying. Independent verification before signing is the specific control that would have caught it.

---

## 10.12 Spectre social and physical action items

1. **Audit team access** across every system. Who has what? Document, review quarterly.
2. **Confirm Denis and Bruno offboarding** is complete across all systems (per memory, they're no longer on the team).
3. **Hardware keys** for all founders + core devs on: GitHub, Vercel, Cloudflare, Privy, npm (if applicable), AWS/GCP, registrar, email.
4. **Carrier SIM-swap PINs** set on every team member's phone.
5. **Operational rules for recruitment lures.** Discuss with the team. Document. Anyone who's targeted should immediately flag to the team channel.
6. **Treasury multisig signing process.** Documented, drilled, with out-of-band verification step.
7. **Travel OPSEC briefing** before international travel, especially conferences. Burner laptop for high-risk events.
8. **Quarterly insider-threat tabletop.** Walk through "what if a team member's laptop is compromised right now?" - who has access to what, what would the attacker do, how would we know.
9. **Personal email cleanup.** Audit personal accounts for old crypto-related logins, rotate passwords with breach.
10. **No-shame reporting culture.** If anyone clicks a phishing link or runs something they shouldn't have, they tell the team immediately. The investigation is more important than the embarrassment.

---

## 10.13 Incident response: human side

When social engineering or physical compromise is suspected:

**First minutes:**
- The person whose machine/account is potentially compromised: isolate the machine (airplane mode), don't shut it down (preserves volatile evidence), report immediately.
- Revoke active sessions across all accounts the person had access to. Use the account-level "log out everywhere" feature.
- Rotate credentials. Assume everything is compromised. Don't take chances.

**First hours:**
- Forensics on the affected machine. Memory dump if practical. Don't reuse the machine; assume malware persistence.
- Audit recent activity from every account the person had: GitHub, Vercel, Cloudflare, email, Slack, wallet operations.
- Block known-bad IPs at Cloudflare WAF based on what forensics reveals.
- If wallet keys may have been exposed, move funds from any affected wallets immediately.

**First days:**
- Image the affected machine and engage a DFIR firm if the impact is large enough.
- Coordinate with SEAL 911 if on-chain components are involved.
- Document the timeline. What was clicked, what ran, what was accessed.
- Trace lateral movement: did the attacker pivot from this machine to other systems?

**First weeks:**
- Patch the human-side gap. What in the operational procedure allowed this? Process change, training, tooling.
- Blameless post-mortem. The person who got phished did not commit malpractice; the process let it reach them. Fix the process.

---

## 10.14 Further reading

- FBI PSA on TraderTraitor / DPRK (Bybit-specific): https://www.ic3.gov/PSA/2025/PSA250226
- Mandiant on DPRK threat actors: https://www.mandiant.com/resources/north-korea
- Chainalysis on DPRK hacks: https://www.chainalysis.com/blog/north-korea-crypto-hacks-2025/
- TRM Labs reports on DPRK and crypto: https://www.trmlabs.com/
- NIST SP 800-50 (security awareness training): https://csrc.nist.gov/publications/detail/sp/800-50/final
- Krebs on Security (most authoritative writing on real-world social engineering and SIM swap): https://krebsonsecurity.com/
- The Grugq on OPSEC (classic essays on personal security): https://medium.com/@thegrugq
- SEAL (Security Alliance) on responding to crypto compromises: https://securityalliance.org/
