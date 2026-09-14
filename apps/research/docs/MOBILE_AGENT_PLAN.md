# Mobile Experience Agent – Plan & Checklist

## Purpose
An **agent** (guidelines + checklist) that **always considers mobile experience and optimization** for every feature and UI change. Use this before shipping any change and when planning new work.

---

## Core principles

1. **Mobile-first thinking**  
   For any new or changed screen: define mobile layout and touch targets first, then scale up for desktop.

2. **Bottom navigation on small viewports**  
   Primary actions and main sections use a **bottom nav bar** (icons + labels) so thumbs can reach them. Avoid critical controls only at the top on mobile.

3. **Touch targets**  
   Minimum 44×44px (or 48×48px) for interactive elements; adequate spacing between tappable items.

4. **Content hierarchy**  
   Most important content (e.g. Welcome widget / Home) near the top; secondary content (Command center, Top coins, etc.) below or in dedicated tabs.

5. **Values and tables on mobile**  
   Prices, percentages, and tables use **mobile-optimized** formatting: shorter numbers (e.g. 1.2K, 2.4M), fewer columns, horizontal scroll only when necessary, readable font sizes.

6. **Progressive disclosure**  
   On small screens: show a clear primary view first; expand or open sheets/modals for detail instead of cramming everything into one scroll.

---

## Checklist (before shipping)

- [ ] **Viewport**  
  Layout and typography tested at 320px, 375px, 390px, 428px width (portrait).

- [ ] **Bottom nav (when applicable)**  
  On mobile, primary navigation (Home, Command center, Favorites, Top coins) available via bottom bar; current section clearly indicated.

- [ ] **Touch**  
  Buttons/links ≥ 44px; no hover-only critical actions on touch devices.

- [ ] **Top coins / tables**  
  Values use compact formatting (K/M/B, 2–3 decimal places); table has sensible columns or horizontal scroll with visible affordance.

- [ ] **Header / chrome**  
  Fixed header (if any) doesn’t obscure content; safe area (notch/home indicator) respected.

- [ ] **Performance**  
  No unnecessary layout thrash; images/icons sized appropriately for mobile.

---

## Scope for first phase

- **Landing page (Welcome)**  
  Mobile layout with bottom nav; Home = welcome widget first, rest lower; Command center; Favorites + Top coins; Top coins values optimized for mobile.

- **Later**  
  Research Zone, Watchlists, Monarch, and other pages brought under the same mobile rules.

---

## Reference breakpoints (align with existing CSS)

- **Mobile:** `max-width: 767px` (or 768px)
- **Tablet:** `768px–1023px`
- **Desktop:** `1024px+`

Use a single **mobile** breakpoint for “bottom nav + mobile layout” vs “sidebar/desktop layout” so behavior is consistent.
