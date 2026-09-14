# 07 - Web3 and DeFi

The highest-stakes category for Spectre. Crypto frontends and smart contracts have a unique property: a successful attack often produces immediate, irreversible, public, on-chain loss. There is no "rotate the password and call the bank." Multi-chain EVM and Solana exposure across research, trading, and the token tax contracts makes this surface broad.

The defining 2025 lesson, from Bybit: most large crypto thefts in 2025 did not exploit smart contract bugs. They exploited frontends, dependencies, developer machines, and human signers. Smart contract audits are necessary but never sufficient.

---

## 7.1 The 2025 Web3 attack landscape

By the numbers (Scam Sniffer, Chainalysis, Halborn, SlowMist):

- **Total stolen 2025: ~$3.4B across DeFi exploits, exchange compromises, phishing.**
- **Bybit, $1.46B** (Feb 21 2025) is the single largest crypto theft ever. Front-end JS injection via a compromised Safe{Wallet} developer machine.
- **Phishing/drainer losses: $83.85M** across ~106K victims (down 83% YoY but still active).
- **Permit and Permit2 signature phishing accounted for 38% of losses in cases over $1M.** Single largest: $6.5M in September from one Permit signature.
- **EIP-7702 malicious signatures emerged post-Pectra upgrade**, allowing attackers to bundle multiple actions into a single user signature. $2.54M lost in August across two cases.
- **Address poisoning: $62M+ in two months** (Dec 2025 - Jan 2026), including a single $50M loss from copying a planted look-alike address.
- **Cetus $223M** (May 2025) integer overflow on Sui.
- **KelpDAO rsETH bridge $290M** (April 2026) via LayerZero DVN RPC poisoning.
- **Off-chain vectors accounted for 80.5% of stolen funds in 2024-2025**, compromised accounts made up 55.6% of all incidents. The pattern is consistent.

The drainer kit ecosystem (Inferno, Angel, Pink, Venom and successors) industrialized phishing. Affiliates drive traffic, operators maintain code, revenue is shared. New drainers spin up as old ones exit.

---

## 7.2 Wallet drainers: how they work

**Anatomy.** A drainer is JavaScript that runs on a page where the user has a connected wallet. It:

1. Calls `eth_requestAccounts` or `solana.connect` to inventory the user's holdings.
2. Queries balances and approvals to identify high-value targets.
3. Crafts a malicious transaction or signature request: an ERC-20 `permit`, `permit2`, `setApprovalForAll`, `increaseAllowance`, a malicious `Seaport` order, an EIP-7702 authorization, or a direct transfer.
4. Presents the request via the wallet UI, often with misleading framing ("Confirm to claim airdrop", "Verify ownership", "Mint NFT").
5. Once signed, the attacker sweeps funds. For long-lived approvals, sweeping happens asynchronously.

**Where drainer JS comes from:**

- **Phishing site.** Look-alike domain, user clicks link from Discord/Twitter/email.
- **Compromised legitimate site.** Bybit-style supply chain or DNS hijack. Drainer runs on the real domain users trust.
- **Compromised dependency.** September 2025 npm `chalk`/`debug` attack: drainer in 18 packages, 2.6B weekly downloads, ran inside every Web3 dApp that built with the poisoned versions.
- **Malicious browser extension.** Reads or rewrites transactions before the legit wallet sees them. Trust Wallet extension backdoor (Dec 2025) exfiltrated mnemonics.
- **PEPE-style site takeover.** PEPE official site compromised in CW49 2025, redirected to Inferno-style drainer.

**Defense for Spectre dApps:**

- Wallet-connected pages live on a dedicated subdomain with minimal dependencies (see 7.7).
- CSP `connect-src` allowlist restricted to known RPC endpoints (see 7.8).
- Subresource Integrity on any external script.
- Transaction simulation and human-readable preview before signing (see 7.3).
- Periodic audit of `dist/` output for unexpected new chunks or hash drift.

---

## 7.3 Permit, Permit2, and signature phishing

**Permit (EIP-2612).** ERC-20 extension that lets the owner approve a spender via a *signed message* instead of an on-chain transaction. No gas, no separate approval tx. The spender submits the signature on-chain to claim the approval.

**Permit2 (Uniswap).** Universal approval contract. Users approve Permit2 once for the maximum, then any dApp can request narrow per-tx authorizations via signature. Reduces approval friction. Also concentrates attack surface: any compromised dApp can ask for an arbitrary Permit2 signature on any token the user holds.

**The phishing flow:**

1. User lands on a phishing page (or compromised legit page).
2. Page requests a "verification signature" or "claim signature".
3. Wallet UI shows `eth_signTypedData_v4` payload. To most users this looks like a benign signature, not a transaction. **No gas, no scary "Confirm" button highlighting fund transfer.**
4. User signs. The signature is a valid Permit or Permit2 grant.
5. Attacker submits it on-chain. Tokens drain.

**Why it works:** wallet UIs historically don't surface Permit semantics well. Users have learned "signing a message is safe" from years of "Sign in with Ethereum" flows. Permit signatures look identical to login signatures.

**Real 2025 cases:**

- $6.5M single Permit signature loss in September 2025 (the year's largest individual phishing).
- $3.02M SLVon and XAUt theft in January 2026 via malicious `permit` and `increaseAllowance`.
- $1.08M aEthLBTC theft, same vectors.

**EIP-7702 (post-Pectra, May 2025).** Lets externally-owned accounts (EOAs) temporarily delegate to a contract via signature. Bundles multi-step operations into one user sign. Attackers immediately weaponized it: one malicious 7702 signature drains all assets across many contracts in one shot. $2.54M in August across two cases, more since.

**Defense.**

- For Spectre dApps that request signatures: explicitly tell users what the signature does in plain language above the wallet popup. "You are about to grant [contract] permission to spend up to [amount] of [token]." Not "Please confirm."
- Never use `permit` for non-essential operations; require an on-chain approval users can see and reason about.
- Block `eth_signTypedData_v4` requests that look like blanket approvals. Render a typed warning.
- For users: educate that signing a message can drain assets. Use Rabby or similar wallets that decode and warn on Permit/Permit2/7702 signatures. Set spend limits.
- Spectre research/trading apps should integrate Blockaid or GoPlus simulation: shows users what a signature actually authorizes before they sign.

---

## 7.4 Address poisoning and dust attacks

**Attack.** Attacker watches a user's wallet activity. Generates a vanity address with the same first and last characters as one the user transacts with frequently (`0xABCD...1234` matches `0xABCD9999991234`). Sends a tiny "dust" transaction from the look-alike address to the user, planting it in transaction history.

Later, the user copies "the address they just sent to" from history. They grab the look-alike instead of the real one. Funds go to the attacker.

**Real 2025-2026 cases:**

- **December 2025: $50M loss.** Single victim copied a poisoned look-alike from history.
- **January 2026: $12.25M (4,556 ETH) loss.** Same pattern.
- $62M+ total across two months.

Low transaction fees make running thousands of poisoning campaigns near-free. Attackers run them at scale; even a tiny conversion rate is profitable.

**Defense.**

- Never copy addresses from transaction history without verifying the full string. Address book / saved contacts with explicit user-set names.
- For Spectre research/trading UIs: when displaying historical transactions, render the full address (not just `0xABCD...1234`) and color-flag any address that's character-similar to one in the user's history.
- Hardware wallets that display full destination addresses on-device. The signer verifies on the trusted screen, not the laptop.

---

## 7.5 Smart contract vulnerabilities

OWASP Smart Contract Top 10 2025 ranks these by frequency and impact. Spectre's exposure: the token tax fee proxy contracts on Ethereum mainnet since Nov 2023.

### Reentrancy (SC01)

**Attack.** Contract makes an external call before updating its own state. The called contract calls back into the original function, draining funds before state catches up.

```solidity
// VULNERABLE
function withdraw(uint amount) public {
    require(balances[msg.sender] >= amount);
    (bool ok, ) = msg.sender.call{value: amount}("");  // external call FIRST
    require(ok);
    balances[msg.sender] -= amount;  // state update AFTER
}
```

Attacker's contract has a `receive()` that calls `withdraw` again. The balance is still the original value, the check passes, ETH flows out repeatedly until the contract is empty.

**Real cases:** The DAO 2016 ($60M, the original). Cream Finance 2021 ($130M). Multiple in 2024-2025.

**Fix.**

- **Checks-Effects-Interactions pattern.** Validate → update state → external call. Never the other way.
- **`ReentrancyGuard`** modifier (OpenZeppelin). Sets a flag, blocks re-entry.
- **Pull payments** instead of push: user calls to withdraw, no external calls during the withdraw flow.
- For cross-function reentrancy (call A re-enters via B), the guard must cover related state.

### Integer overflow and underflow (SC03)

**Attack.** Arithmetic wraps around silently in Solidity <0.8.0 or in unchecked blocks. Subtraction below zero wraps to max uint. Multiplication beyond uint max wraps.

**Real 2025 case: Cetus $223M (May 2025).** Bug in liquidity calculation on Sui blockchain. Attacker deposited a tiny amount, the contract calculated huge phantom liquidity due to overflow, flash-loaned and drained ~$223M. Validators froze ~$160M, ~$63M unrecoverable.

**Fix.**

- Solidity ≥0.8.0 has built-in overflow checks. Don't use `unchecked` blocks for value-handling math unless you've proven correctness.
- For older code, use OpenZeppelin SafeMath.
- Sui/Move and Solana programs: verify the arithmetic model and any saturating-vs-wrapping behavior.

### Access control (SC02)

**Attack.** Privileged functions (`mint`, `withdraw`, `upgrade`, `setOwner`, `setFee`) callable by anyone. Missing `onlyOwner` modifier. Or wrong role check. Or `tx.origin` instead of `msg.sender` for auth.

**Real cases:** Numerous. Audius governance takeover 2022 ($6M). 88mph admin function 2021. Recurring through 2025.

**Fix.**

- OpenZeppelin AccessControl or Ownable.
- Multi-sig for owner functions, time-lock for governance changes.
- `msg.sender` for direct caller auth. `tx.origin` is legacy and dangerous; allows phishing via intermediate contracts.
- Linter: Slither flags missing modifiers.

### Oracle manipulation (SC04)

**Attack.** Smart contract reads a price from an external source. If the source is manipulable (a single AMM spot price, a low-liquidity pool, a centralized API), the attacker manipulates the source then triggers logic that depends on the manipulated value.

**Real 2025 cases:**

- **Loopscale (April 2025, Solana).** Read token prices from DEXs without freshness validation. Hacker flash-loaned and traded RateX PT to skew price, then triggered liquidations.
- **Dexodus (May 2025).** $300K loss. Protocol didn't check freshness of oracle signatures, hacker replayed old prices.
- Long history through 2024 of similar attacks against price-oracle-dependent lending.

**Fix.**

- Use Chainlink, Pyth, or equivalent decentralized oracle with TWAP (time-weighted average price), not a single AMM spot.
- Multiple oracle sources with deviation checks; reject if sources diverge beyond threshold.
- Validate signature freshness (timestamps) on push-style oracles.
- Circuit breakers: pause trading if prices move beyond N% in one block.

### Flash loan attacks (SC07)

**Attack.** Attacker borrows millions in a single atomic transaction. Uses the temporary capital to:

- Manipulate AMM prices (corner thin pools)
- Bypass governance thresholds (snapshot voting with borrowed tokens)
- Trigger oracle-dependent code at unfavorable prices
- Exploit composable protocol assumptions (protocol A trusts protocol B's reported state, which is borrowed-induced)

Repays the loan in the same tx. If profit exceeds gas, attack succeeds. Flash loans aren't bugs; they're amplifiers of other bugs.

**Real 2025 cases:** PulsePot January 2025, Cetus May 2025 (combined flash loan + integer overflow), recurring through the year.

**Fix.**

- Don't rely on AMM spot price for anything financially significant. Use TWAP.
- Snapshot governance voting power before proposal creation, not at vote time, with delay.
- Reentrancy guards on cross-protocol interactions.
- Stress-test with simulated flash loans during audit.

### MEV and front-running

**Attack.** Bots watching the mempool see your transaction before it's confirmed. They submit a copy with higher gas, or sandwich it (their tx before, then yours, then their second tx). User gets worse execution; bot extracts the difference.

**Defense for end users:**

- Submit via private mempool (Flashbots Protect, MEV-Share, CowSwap).
- Slippage limits on every swap.
- For Spectre research/trading interfaces: surface slippage clearly, default to tight limits, offer private RPC integration.

For protocols: use commit-reveal schemes for sensitive operations, batch auctions, or order-flow protection.

### Unchecked external calls (SC09)

Forgetting to check the return value of `.call`. If the call silently fails, your contract continues as if it succeeded. Cost: $550K+ aggregated in 2024.

**Fix.** Always check return values. Solidity warns but doesn't enforce.

### Faulty input validation (SC ranking, SC10)

The #1 root cause across 2020-2024 by occurrence (~34.6% of contract exploits). Sloppy bounds-checking, missing zero-address checks, missing length checks.

**Fix.** Explicit `require` for every assumption the function depends on. Treat function inputs as adversarial.

---

## 7.6 Bridge exploits

Cross-chain bridges are 2022-2025's highest-loss category. Custodial bridges hold large pooled assets on both ends, making them giant targets.

**2022-2024 catalog (still instructive):**

- Ronin Bridge (Axie Infinity), March 2022: $625M. Validator key compromise via social engineering recruit-themed lure.
- Wormhole, Feb 2022: $325M. Signature verification bug.
- Nomad, August 2022: $190M. Anyone-can-spoof bug, free-for-all withdrawal.
- BNB Chain Bridge, Oct 2022: $570M. IAVL proof verification bug.

**2025-2026:**

- **KelpDAO rsETH (April 2026): $290M.** Attacker poisoned RPC infrastructure of the sole LayerZero DVN, fabricated messages, minted rsETH backed by nothing.
- Multiple smaller bridge incidents through 2025 with similar root causes: trust assumptions on off-chain components.

**Defense (for protocols building bridges):**

- Multiple independent validators, with no single point of compromise.
- DVN diversity for LayerZero-style bridges; one DVN compromise should not be sufficient.
- Conservative trust assumptions; assume any one validator can be compromised.
- Withdrawal rate limits, circuit breakers, time-locked emergency pauses.

For Spectre: if any future product touches bridges, the trust model needs explicit external review. Most teams underestimate the off-chain components.

---

## 7.7 The Bybit playbook in detail

Worth dissecting because it represents the modern attack pattern for crypto exchanges, dApps, and any frontend that brokers high-value signing. The defenses below apply directly to anything Spectre builds that handles user wallet operations.

**Timeline:**

- **Feb 4 (approx):** Lazarus compromises a Safe{Wallet} developer machine via social engineering (recruiter-themed phishing, infected job application or interview tooling).
- **Feb 18:** Attacker deploys their malicious implementation contract at `0xbDd077f651EBe7f7b3cE16fe5F2b025BE2969516`, preparing for execution.
- **Feb 19:** Attacker injects malicious JavaScript into Safe{Wallet}'s AWS S3 bucket. The injected code is conditional: it only activates when the transaction originator is Bybit's cold wallet address.
- **Feb 21:** Bybit signers (including CEO Ben Zhou) initiate a routine cold-to-warm transfer via Safe{Wallet}. The frontend displays a normal transaction. The data sent to signers' Ledger devices is different: a `delegatecall` to the attacker's implementation contract. Signers approve what they see, not what they actually signed.
- **Feb 21 +seconds:** Once 3 signatures collected, the multisig executes the delegatecall. The attacker's contract uses the `_transfer` slot trick to overwrite the Safe proxy's `masterCopy` slot, replacing the Gnosis Safe logic with the attacker's contract. Five drain transactions follow. ~401,347 ETH (~$1.46B) gone.
- **Feb 21 +2 minutes:** Attacker removes the malicious code from S3 to obscure forensics.

**The five compounding failures:**

1. **Safe{Wallet} developer machine had access to production S3.** No separation between developer workstation and production deployment infrastructure.
2. **No artifact integrity verification.** S3 served whatever was there. No SRI, no signed deploys, no reproducible builds, no integrity monitoring.
3. **The Safe UI was the source of truth for what signers signed.** Hardware wallets verify the data shown to them, but signers approved based on what the laptop screen displayed, not the Ledger display.
4. **Delegatecall has no human-readable rendering.** Even on the Ledger, the signers saw opaque bytes. Recent delegatecall transactions in Bybit's history (the legitimate mETH transfer on Jan 14) had set the precedent for "this is normal."
5. **No raw-transaction validation at sign time.** Multisig signers signed without an independent off-chain validation step comparing intended-vs-actual.

**Defenses that would have helped:**

- **Subresource Integrity on the Safe UI.** Browser would have refused to execute the modified JS. Bybit could have enforced this client-side via a hardening browser extension or pinned-script policy.
- **Reproducible builds and deploy diff monitoring.** Safe ships a versioned bundle; Bybit could have run a verification step before each signing session: fetch current `app.safe.global` bundle, hash it, compare against known-good hash.
- **Independent transaction validation.** Tool like Safe's own "verify on a second device" or BlockSec Phalcon: parse the raw multisig transaction on a separate machine, render in plain English ("delegatecall to 0xbDd0... with selector 0x7f1ac8e3"), require signer to confirm. Mismatch with displayed UI → abort.
- **Hardware wallet that decodes delegatecall.** Newer Ledger and GridPlus Lattice1 firmware decode common multisig operations and show targets/selectors. Still limited for arbitrary delegatecalls; show clearly that this is a privileged operation requiring extra scrutiny.
- **Tighter S3 controls on Safe's side.** Object versioning + lock + access logging + alerts on any `PutObject` from non-CI principals. Probably the highest-impact fix.

**For Spectre directly:**

- Any code path where a Spectre frontend constructs and presents a transaction for user signing: render a human-readable summary above the wallet prompt. "You are about to send X tokens to address Y. The transaction will execute Z."
- For internal team multisig (if any): use a hardware-wallet-only signing flow with a second-device verification step.
- Audit the deploy pipeline for Spectre's wallet-touching pages. Any path where someone with developer access could inject JS that reaches production without a second pair of eyes is the Bybit pattern.

---

## 7.8 Frontend hardening for dApps

The Bybit lesson concretely: frontend integrity deserves the same attention as on-chain code. Practical steps for Spectre's wallet-connected surfaces:

1. **Dedicated subdomain with minimal dependencies.** `app.spectreai.io` for wallet interactions, separate from marketing, blog, analytics-heavy pages. Audit the dependency tree: every package on this domain runs in the same JS context as `window.ethereum`.

2. **Strict CSP**:
   ```
   Content-Security-Policy:
     default-src 'self';
     script-src 'self' 'sha256-...' 'sha256-...';
     connect-src 'self' https://api.spectreai.io https://mainnet.infura.io https://api.mainnet-beta.solana.com;
     img-src 'self' data: https:;
     style-src 'self' 'unsafe-inline';
     frame-ancestors 'none';
     object-src 'none';
     base-uri 'self';
     upgrade-insecure-requests;
   ```
   `connect-src` is the critical one. Drainer that gets injected can't talk to its C2 if the list is restrictive. List only the RPC endpoints and your own API.

3. **Subresource Integrity on every external script.** No exceptions. If a script can't be SRI-pinned, host it yourself.

4. **No third-party analytics on wallet pages.** Move PostHog, Google Analytics, error reporting off this origin or self-host through a same-origin proxy. Each external script is a future supply chain risk.

5. **Build artifact monitoring.** Vercel publishes a build hash. Cron job: fetch the deployed bundle, verify hash matches the most recent CI build, alert on mismatch.

6. **Transaction simulation before sign.** Tenderly, Alchemy Simulation, or Blockaid integration. Show the user what the tx will actually do (token transfers, approvals, storage changes) before the wallet popup.

7. **Defensive wallet integration.** Use a wallet abstraction layer (wagmi, ethers v6) with explicit method allow-lists. Don't expose arbitrary `eth_sendTransaction` or `eth_signTypedData_v4` through your code without wrapping with validation.

8. **Approval revocation UX.** Surface existing approvals on Spectre's research dashboard with one-click revoke. Reduces user exposure to old approvals that drainers can re-use.

---

## 7.9 Spectre token tax contract considerations

Spectre's 5% token transaction tax on Ethereum mainnet (since Nov 2023) is on-chain protocol revenue. The fee proxy contracts handling this are a meaningful attack surface.

Items to confirm in current contracts:

- [ ] Owner functions (set fee rate, set treasury, set router) gated by multisig, not a single EOA.
- [ ] Time-lock on parameter changes; instant changes are a rug-pull-shaped foot-gun.
- [ ] No `selfdestruct` or arbitrary `delegatecall` paths.
- [ ] Reentrancy guards on any function that calls external contracts (the swap router on receive).
- [ ] No integer overflow paths in fee calculation (Solidity ≥0.8 helps but doesn't replace review).
- [ ] Emergency pause function (Pausable pattern) controlled by multisig.
- [ ] Treasury address change requires multisig signature + delay.
- [ ] Token transfer hooks (`_beforeTokenTransfer`) don't introduce reentrancy via external calls.
- [ ] If upgradeable (UUPS/Transparent proxy): upgrade authorization is multisig + time-lock, and the implementation isn't initializable by anyone.
- [ ] No external auditor's findings outstanding.

If Spectre hasn't had a formal audit recently, it's worth scheduling one with a reputable firm (Trail of Bits, OpenZeppelin, ConsenSys Diligence, Sigma Prime, BlockSec). For contracts touching cumulative revenue, audit cost is small relative to the on-chain balance.

---

## 7.10 Solana-specific risks

Different VM, different bug classes. If Spectre has meaningful Solana exposure:

- **Missing signer checks.** Anchor and Solana programs require explicit `is_signer` checks on accounts that should be signing the tx. Forgetting one allows attackers to substitute their account.
- **Missing owner checks.** Token accounts must be owned by the expected program. Skipping verification means attackers swap in their own accounts.
- **Account confusion / type confusion.** Anchor reduces this with discriminators; raw programs are vulnerable.
- **PDA hijacking.** Program-derived addresses with predictable seeds let attackers pre-claim accounts.
- **Reinitialization.** Initialize function callable twice, second call by attacker.
- **Closing accounts without zeroing balances.** Funds leak.
- **Integer arithmetic.** Solana programs typically use Rust; overflow panics by default, but `wrapping_add` and `unchecked` paths exist.

Anchor framework + sealevel-attacks (https://github.com/coral-xyz/sealevel-attacks) is the canonical resource. Audit firms doing Solana: OtterSec, Halborn, Neodyme.

---

## 7.11 Multisig hygiene for team operations

If Spectre operates any multisig (treasury, governance, contract upgrade authority):

- **Hardware wallets only for signers.** No software wallets, no copy-paste from password managers, no browser extensions other than the wallet's official one on a dedicated browser profile.
- **Signer machines hardened.** Separate machine if feasible, or dedicated user account, no other browser activity. Treat the signing machine like a HSM.
- **Threshold high enough.** 3-of-5 minimum for treasury. Higher for sensitive operations.
- **Geographic and operational distribution of signers.** No two signers on the same physical machine; no single phishing campaign should hit all of them.
- **Off-band verification of every transaction.** Before signing, signer calls another signer (Signal, in-person), independently confirms the transaction's intent and the destination address.
- **Independent transaction validation.** Tool like Safe's "Tenderly simulation" tab, or a manual `cast` decode, before signing. Don't trust the Safe UI as the only source.
- **Regular drills.** Practice the response: what does the team do if one signer is compromised? Tested before it's needed.

---

## 7.12 Off-chain risk: RPC endpoints

Your dApp is only as honest as the RPC endpoint it talks to. If `mainnet.infura.io` is hijacked, lying, or returning stale data, your frontend serves users a falsified view of chain state.

KelpDAO bridge attack (April 2026, $290M): attacker poisoned RPC infrastructure of the sole LayerZero DVN.

**Defenses:**

- Multiple independent RPC providers with deviation checks. Spectre's research app could query Alchemy, Infura, and QuickNode in parallel and flag divergence.
- For high-stakes operations, query directly via a self-hosted node (Spectre has OVH blockchain nodes; use them for critical paths).
- Keep RPC endpoints in `connect-src` CSP allowlist. Hijacked RPC traffic to an unlisted host gets blocked.

---

## 7.13 Detection: on-chain monitoring

For Spectre's token tax contracts and any user-facing wallet flows:

- **Forta** or **Defender Sentinel** alerts on:
  - Any function call to `setOwner`, `upgradeTo`, `setFee`, or other admin
  - Large outflows (>X% of treasury) in single tx
  - Multiple failed transactions from same address (probing)
  - Approvals to known drainer addresses
- **Chainalysis Reactor** or **TRM Labs** for incident response and address screening if a compromise happens.
- **OpenZeppelin Defender** for incident response automation.

---

## 7.14 If a Web3 compromise happens

Specific to the on-chain dimension. General IR is in `SKILL.md`.

1. **Pause contracts** if pause function exists. Buy time.
2. **Tell users immediately.** Twitter, Discord, in-app banner. Tell them to revoke approvals via revoke.cash or Etherscan. Specifically name the malicious contract address if known.
3. **Contact SEAL 911** (https://securityalliance.org/) for incident response support. They coordinate with exchanges, bridges, and analytics firms in real-time.
4. **Engage Chainalysis or TRM Labs** for forensics and fund tracking.
5. **Notify CEX compliance teams** to block deposits from attacker addresses. Binance, Coinbase, Kraken, OKX, Bybit, eXch (the last one declined to cooperate in the Bybit case).
6. **File with law enforcement** (FBI IC3 for US nexus; local equivalent elsewhere) and document the incident publicly.
7. **Publish a forensic post-mortem.** Quickly, honestly. Builds long-term trust; concealment destroys it.

---

## 7.15 Quick Web3 audit checks

```bash
# Wallet pages on minimal-dep subdomain?
# Check the dependency count
cd path/to/wallet-app && npm ls --all | wc -l

# CSP connect-src restrictive?
curl -sI https://app.spectreai.io | grep -i content-security-policy

# Any third-party scripts on wallet pages?
curl -s https://app.spectreai.io | grep -oE '<script[^>]*src="[^"]+"' | grep -v "spectreai.io"

# SRI on every external script
curl -s https://app.spectreai.io | grep -oE '<script[^>]*src="[^"]+"' | grep -v integrity=

# Smart contract: missing modifiers
slither path/to/contracts --print modifiers

# Smart contract: classic vuln patterns
slither path/to/contracts

# Anchor program: signer/owner checks
cargo install anchor-cli
anchor verify
```

---

## 7.16 Further reading

- OWASP Smart Contract Top 10 2025: https://owasp.org/www-project-smart-contract-top-10/
- SEAL (Security Alliance) 911: https://securityalliance.org/
- Rekt News (post-mortems): https://rekt.news/
- DeFi Hacks Reproduce (educational PoCs): https://github.com/SunWeb3Sec/DeFiHackLabs
- Sealevel Attacks (Solana): https://github.com/coral-xyz/sealevel-attacks
- Halborn Top 100 DeFi Hacks Report 2025: https://www.halborn.com/reports/top-100-defi-hacks-2025
- Scam Sniffer reports: https://drops.scamsniffer.io/
- Bybit incident analysis (NCC Group): https://www.nccgroup.com/research/in-depth-technical-analysis-of-the-bybit-hack/
- Bybit incident (BlockSec): https://blocksec.com/blog/bybit-incident-a-web2-breach-enables-the-largest-crypto-hack-in-history
- Bybit incident (SlowMist): https://slowmist.medium.com/bybits-1-5-billion-theft-unveiled-safe-wallet-front-end-code-tampered-84b78f0fa9c2
