# Fear & Greed Page – Design Plan

## Concept: "Is PA Real?"

Show when **price action (PA)** aligns with or diverges from **narrative**: sometimes Crypto Twitter is crying (bearish social sentiment) while whales are buying (on-chain accumulation). When they diverge, **price tends to follow positioning—not posts.**

---

## Layout (top → bottom)

### 1. Hero row: Gauge + Chart
- **Left – Fear and Greed Gauge**
  - Semi-circular gauge (0–100): red (Fear) → yellow (Neutral) → green (Greed).
  - Needle pointing at current value.
  - Big label: e.g. **"30 Fear"**.
  - **Comparison strip** under gauge: "vs yesterday +1", "vs last week +1", "vs last month +10" (from history).
- **Right – Fear and Greed Chart**
  - Historical line chart (time vs value 0–100).
  - Line color by segment: red/orange (fear), yellow (neutral), green (greed).
  - Tooltip on hover: date + value.

### 2. Divergence / Narrative row (2 cards)
- **CT Crying Meter**
  - Title + status tag (e.g. Neutral / Bearish / Bullish).
  - Copy: Spectre AI tracks X sentiment; CT can be bearish while on-chain shows accumulation; "price tends to follow positioning—not posts."
- **Market Mood**
  - **Majors:** total cap, USDT dominance, DXY (short bullets).
  - **Micros:** altseason, narratives, L1s, memes.
  - **ETH/BTC:** extreme fear / accumulation zone, volume–cap correlation.

### 3. Contributing factors (4 cards, 2×2 or row)
- **Price & Volatility**
  - Sub-gauges: **Herd Sentiment** (x/100 bar), **Smart Money Flow** (x/100 bar).
  - Tag: e.g. "Contrarian Cautious."
- **On-chain**
  - Score + label (e.g. "9 Fear") – "whales buying, real inflows."
- **Derivatives & Liquidity**
  - Score + label (e.g. "27 Fear").
- **Social**
  - Score + label (e.g. "12 Fear") – ties to CT Crying Meter.

### 4. Footer
- "Powered by Spectre AI" + "Data: Alternative.me Fear & Greed API."

---

## Data

| Source | Use |
|--------|-----|
| Alternative.me F&G API | Main index value, classification, history (gauge, chart, vs yesterday/week/month). |
| Mock (for now) | Herd Sentiment, Smart Money Flow, CT Crying Meter status, On-chain / Derivatives / Social scores, Market Mood bullets. |

Later: plug real APIs for social, on-chain, derivatives; keep same UI.

---

## Copy (CT Crying Meter)

> Spectre AI tracked X sentiment across high-impact accounts and engagement clusters in real time. Current readings show persistent bearish sentiment across CT, driven largely by high-engagement posts recycling fear-based narratives. A significant portion of this activity aligns with engagement farming, not new information or changes in positioning. At the same time, on-chain data indicates continued accumulation from larger wallets on Bitcoin and Ethereum. **This divergence is key: when social sentiment grows louder while capital moves quietly in the opposite direction, history suggests that price tends to follow positioning—not posts.**

---

## Visual style

- Dark cards, subtle borders, same glass tone as rest of app.
- Gauge: clear red–yellow–green arc; needle and number prominent.
- Chart: clean line, color-coded segments, minimal tooltip.
- Tags: pill-style (e.g. "Contrarian Cautious", "Neutral").
- Bars: purple or theme-colored progress bars for Herd / Smart Money.
