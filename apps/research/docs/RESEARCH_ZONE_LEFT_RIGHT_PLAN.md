# Research Zone – Left Panel & Right Panel Plan

## Goal
1. **Left panel** – Match **landing page UI** (Welcome widget glass style): same gradient, border, border-radius, box-shadow, card style, typography, and structure as the welcome/watchlist widgets on the landing page.
2. **Right panel** – **Wider** (more space), **better look and structure** for News feed, Tweets, and About; consistent **UI icons** and hierarchy.

---

## 1. Landing page UI reference (to match)

- **Container (welcome-widget-glass):**  
  `background: linear-gradient(168deg, #07060a 0%, #09080d 35%, #040306 70%, #020103 100%)`  
  `border: 1px solid rgba(255, 255, 255, 0.2)`  
  `border-radius: 24px`  
  `box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(255,255,255,0.06), inset 0 0 24px -8px rgba(255,255,255,0.06), 0 4px 12px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.3)`

- **Inner cards (welcome-widget-restyled .welcome-widget-price-card):**  
  `background: linear-gradient(180deg, #0c0c10 0%, #08080c 100%)`  
  `border: 1px solid rgba(255,255,255,0.12)` (or var(--glass-border-neumorphic))  
  `border-radius: 16px`  
  `box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 3px 10px rgba(0,0,0,0.35)`

- **Labels:** `color: rgba(255,255,255,0.5)`, `font-weight: 600`, `letter-spacing: 0.1em` (or section title style).
- **Values:** `color: #fff`, `font-weight: 700`.
- **Font:** `var(--font-glass, 'Outfit', sans-serif)`.

---

## 2. Left panel tasks

| ID | Task |
|----|------|
| L1 | Apply welcome-widget-glass style to `.research-zone-lite-left`: same gradient, border rgba(255,255,255,0.2), border-radius 24px, same inset + outer box-shadow. Remove or align ::before accent with landing. |
| L2 | Apply welcome-widget-restyled price-card style to `.research-zone-lite-card` (token, price, metrics, range, ATH): gradient #0c0c10 → #08080c, border-radius 16px, inset + soft outer shadow. |
| L3 | Symbol switcher: restyle to match landing (e.g. pill/tab style or compact glass cards). Use same glass border and bg as landing pills. |
| L4 | Section titles (Categories, Price performance, All-time): match landing label style – uppercase, letter-spacing, color rgba(255,255,255,0.5). Card labels same. |

---

## 3. Right panel tasks

| ID | Task |
|----|------|
| R1 | Increase right panel width: `320px` → `380px` (flex: 0 0 380px; width: 380px). Adjust layout if needed. |
| R2 | News feed: (1) Section header – icon + "News about {token}" + Live badge + refresh button with icon. (2) News items – clear hierarchy (source + time, title, summary); optional small icon per item; external link icon. Use spectreIcons.news or consistent icon. |
| R3 | Tweets: (1) Section header – icon + "Tweets about {symbol}". (2) Tweet cards – avatar, name/handle/time, content, preview card, actions with heart and retweet icons (SVG). Improve spacing and typography. |
| R4 | About: (1) Section header – icon + "About {token}". (2) Description text. (3) Links row – Website, Twitter, Reddit, Explorer as buttons/pills with icons (globe, twitter, reddit, explorer SVGs). |
| R5 | Right cards (News, Tweets, About): ensure card title uses same pattern – icon (larger/clearer) + uppercase label; consistent padding and gap. |

---

## 4. Task checklist

- [ ] L1 Left – glass container style
- [ ] L2 Left – card style (price-card match)
- [ ] L3 Left – symbol switcher match landing
- [ ] L4 Left – section titles & labels
- [ ] R1 Right – width 380px
- [ ] R2 Right – News feed structure & icons
- [ ] R3 Right – Tweets structure & icons
- [ ] R4 Right – About structure & link icons
- [ ] R5 Right – card titles consistency
