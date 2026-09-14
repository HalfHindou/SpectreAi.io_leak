---
paths:
  - "apps/research/src/pages/x-dash/**"
  - "apps/research/src/hooks/useXDash*.js"
---

# Match Structure — add a CA-match dimension (spec)

**Created:** 2026-07-04
**Requested by:** Sunny
**Status:** App interim SHIPPED (drawer tweet CA-badge + sample read); full board-wide field = data-lane TODO
**Why:** the `usedot-ai` / `$DOT` / Polkadot collision. Cashtag + handle tracking both misfire; the contract address is the only project-unique key.

## The idea

Today `match_structure` on a token = **both / cashtag-only / handle-only** — each mention post classified by whether it contains the `$cashtag` and/or `@handle`. Add a fourth signal: **does the post contain the token's contract address (CA)?**

### Why CA-match is the most valuable signal
- **Project-unique.** A cashtag ("$DOT") collides across tokens; a CA is one token. This is exactly what would have stopped `usedot-ai` reading as Polkadot.
- **Freshness.** New launches are shared by CA far more than by cashtag/handle → a high CA-match share is a strong "this is fresh / real launch" input. Feed it into the novelty/freshness score.
- **Correct-CA for users.** A post that contains the CA is the one a user should open to copy the *right* address → fewer "bought the wrong CA" mistakes (Polkadot instead of usedot-ai).
- **Survives X-account loss.** If a project's X account is suspended or renamed, handle-tagging stops but CA-posting continues — CA-match keeps tracking where handle/cashtag go dark.

## Data-lane work (collector / data-api)

Per token, over each window (24h / 7d / …), compute from the mention posts already ingested:

```
ca_match_24h            int    # posts whose text contains the token's contract address
ca_match_share_24h      float  # ca_match_24h / external_mentions_24h  (0..1)
```

- **Where:** the classifier that already sets `both/cashtag/handle` per post is the natural home (it has the post text + the token's known `contract_address`). If that lives on the collector box (SSH-denied), the alternative is a **data-api worker that re-scans stored post text** for the token's CA — feasible only if raw/normalized post bodies are retained.
- **Matching:** case-insensitive substring for EVM (`0x…40hex`); exact/base58 for Solana. Also match common obfuscations if cheap (spaces stripped, `CA:` prefix) — but a plain substring already catches the vast majority.
- **Surface it** in the same token-detail payload that carries `match_structure` (drawer reads `matchStructure`), e.g. add `ca_match` / `ca_match_share` alongside `both_match / cashtag_only / handle_only`.
- **Freshness:** once `ca_match_share` exists, add it as a positive term to the novelty/freshness computation (high CA-share early = fresh-launch bump).

## App work

- **DONE (interim, this PR):** the drawer tweet feed now badges posts that contain the CA (green "✓ CA") and shows a sample-based read "N/M shown posts include the contract". Purely client-side over the already-fetched tweet sample — labeled sample-based, no new data dependency.
- **TODO (when the field lands):** render a real **"CA MATCH %"** segment in the Match Structure bar (`xd-token-drawer.jsx`, the `matchStructure` section) from `ca_match_share`, and wire `ca_match_share` into the freshness/novelty score. Trivial once the payload carries it — gate on presence so it no-ops until the data ships.
