# Codex Sales Email — Flat-Rate `onPricesUpdated` Request

**To**: help@codex.io (or your sales contact)
**Subject**: Spectre AI — Flat-rate `onPricesUpdated` for Solana/Base/Ethereum networks

---

Hi team,

Spectre AI runs a real-time crypto research platform serving market data across multiple chains. We've spent the last week heavily optimizing our Codex usage (multi-source routing through CoinGecko and Binance for majors, KV-cached snapshot fan-out, per-resolution bar caching, idle-tab gating) and have already cut Codex spend ~40%. We're hitting the architectural limit of what client-side optimization can do.

The remaining cost is dominated by per-user polling of `filterTokens` for price/volume/change. We'd like to migrate that to subscriptions, but the per-event billing model on `onPricesUpdated` makes the cost non-deterministic — a single volatile token could spike events arbitrarily.

**Your docs mention a flat-rate option for unlimited price updates across a network on supported chains.** That's exactly the model we need: predictable monthly cost, no per-event scaling, and we serve every price-update consumer from our own infrastructure layer.

Specifically requesting:
- Flat-rate `onPricesUpdated` coverage for **Solana, Base, Ethereum**
- Plan that includes WebSocket subscriptions (Growth or Enterprise per your tier definitions)
- Pricing for our usage profile (currently ~50-100 DAU, scaling to 1000 over the next quarter)

Two reasons this is the right architecture for us:
1. Our backend already runs WebSocket subscribers (`packages/server/routes/codex-stream.js` uses your `ws` protocol against `graph.codex.io`). The plumbing is in place.
2. Our `worker-candles-codex` already mirrors your getTokenBars data into TimescaleDB on Hetzner. With a network-wide stream we'd ingest once and serve to every user-facing surface for free.

Would you have 20 minutes this week to discuss? Happy to share architecture details if useful — our routing layer is well-documented and we'd like to make sure our usage pattern fits whatever plan you propose.

Best,
Sunny
Founder, Spectre AI
[app.spectreai.io](https://app.spectreai.io)
[click2sunny@gmail.com / contact@spectreai.io]

---

## Why this exact wording

- **Opens with "what we've already optimized"** — proves we're not asking for a discount because we mismanage usage. We've cut 40% on our own.
- **Names the exact primitive** — `onPricesUpdated`, flat-rate, specific networks. Avoids back-and-forth on "what do you mean".
- **Frames it as their model, not a favor** — they document this offering; we're asking to use it.
- **Specific DAU range** — gives them a budget to size pricing against. Not vague "we're growing fast".
- **Proof we'll absorb the data** — mentions our existing WS subscriber + TimescaleDB. Shows we won't ask them to also solve our caching.
- **Asks for a call, not a discount** — Sales prefer conversations, and a 20-min call typically gets us a quote within 48h.

## What to do after they reply

1. **If they offer Growth flat-rate**: ask for the exact monthly $ across our requested networks + the WS connection limit + any soft caps on subscription count.
2. **If they push back on flat-rate**: ask for a metered Growth plan with rate-capped `onPricesUpdated` events (cap at e.g. 10 events/sec per token, accept stale beyond that).
3. **If they say "use the existing per-event pricing"**: that's the answer to defer this and focus on hardening our current Codex-free paths (CG/Spectre/Binance). The flat-rate ask only makes sense if it changes the unit economics.

## Don't send if

You haven't checked the Account B (Hetzner) Codex bill first. If Account B is already at Enterprise tier with flat-rate, this conversation is moot — we just route the Vercel layer through Hetzner. Check `98d8…` dashboard before sending.
