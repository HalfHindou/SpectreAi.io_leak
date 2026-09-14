# X Feed Redesign v2 - Text Hero + Cinematic Cards

## What went wrong in v1
- 16:9 images too squished in 380px sidebar - looked cramped, not cinematic
- Engagement buttons nearly invisible - users expect to interact
- Text was secondary to image - but crypto tweets are TEXT-heavy
- Cards too compact - felt like a data table, not editorial content

## The New Approach: TEXT FIRST, image supports

The key insight for crypto X feeds: **the text IS the alpha.** Images are supplementary. On a Bloomberg terminal, the news wire text is prominent - images are secondary. But when an image IS present, it should feel premium.

```
New card layout (with image):
┌──────────────────────────────────┐
│                                  │
│  Author Name ✓        · 5m  [𝕏] │  ← header back on top
│  @handle                         │
│                                  │
│  The actual tweet text content   │  ← HERO: 0.875rem, high contrast
│  goes here and it's the most     │     generous line-height (1.6)
│  prominent element on the card.  │     no line-clamp (show full text)
│  Text IS the alpha signal.       │
│                                  │
│  ┌──────────────────────────┐    │
│  │                          │    │  ← 3:2 aspect ratio (~253px)
│  │     IMAGE                │    │     rounded, subtle hover zoom
│  │                          │    │
│  └──────────────────────────┘    │
│                                  │
│  💬 12    🔁 5    ❤ 23    ↗     │  ← full action row, always visible
│                                  │
└──────────────────────────────────┘

Text-only card:
┌──────────────────────────────────┐
│                                  │
│  Author Name ✓        · 5m  [𝕏] │
│  @handle                         │
│                                  │
│  The actual tweet text content   │
│  goes here with more breathing   │
│  room since there's no image.    │
│                                  │
│  💬 12    🔁 5    ❤ 23    ↗     │
│                                  │
└──────────────────────────────────┘
```

## Design Specifics

### Card Container
- `padding: 16px` (generous, not cramped)
- `border-radius: 12px`
- `background: rgba(255,255,255,0.02)` for ALL cards (not just image cards)
- `margin-bottom: 8px` (breathing room between cards)
- Hover: `rgba(255,255,255,0.035)` + left accent line

### Header (top of card, restored)
- Avatar: 24px circle + name (0.8125rem, 600 weight, 0.85 opacity) + verified (12px)
- Handle below name: mono 0.6875rem, 0.25 opacity
- Time: far right, mono 0.625rem, 0.2 opacity
- X link: far right corner, ghost circle, appears on hover

### Text (the hero)
- `font-size: 0.875rem` (bumped up from 0.8125)
- `line-height: 1.6` (generous reading)
- `color: rgba(245,245,247,0.75)` (higher contrast than before)
- NO line-clamp (show full tweet text - crypto alpha needs to be readable)
- `margin: 8px 0 12px`

### Image (below text, 3:2)
- `aspect-ratio: 3/2`
- `border-radius: 10px`
- `object-fit: cover`
- 0.95 opacity default, 1.0 on hover with subtle scale(1.01)
- Video badge: bottom-right glass pill

### Action Row (always visible)
- Full width, `display: flex`, `justify-content: space-around`
- Each button: icon (14px) + count (mono 0.6875rem)
- Default: 0.35 opacity
- Hover per button: brightens + subtle color hint
- Active: colored (reply=blue, RT=green, like=pink)
- Separated from content by thin top border `rgba(255,255,255,0.03)`

## Files
```
apps/trading/src/components/LeftPanel.jsx  (restructure card: header on top, text before image, action row)
apps/trading/src/components/LeftPanel.css  (rewrite tweet styles)
```

## Phases
1. JSX: header on top, text before image, full action row at bottom
2. CSS: generous sizing, 3:2 images, prominent text, visible actions
3. Build + verify
