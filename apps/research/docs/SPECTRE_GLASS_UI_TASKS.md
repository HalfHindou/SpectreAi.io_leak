# Spectre Glass UI – Task Plan

**Design reference:** `file:///Users/sunny/Downloads/spectre-glass-v2_1.html`  
**Target style:** Dark glass / neumorphic – capsule/pill buttons, circular icon buttons, soft highlights and shadows, dark charcoal surfaces, white text/icons, subtle depth.

---

## Phase 0: Design Reference & Setup (do first)

- [ ] **0.1** Copy or link the design file into the project so it’s accessible (e.g. `public/design-reference/spectre-glass-v2_1.html` or `docs/spectre-glass-v2_1.html`). *Current path is outside workspace (Downloads) so Cursor cannot read it.*
- [ ] **0.2** Open `spectre-glass-v2_1.html` in a browser and document:
  - All icon SVGs (Customise button, plus icon, any others) and their markup/CSS.
  - Exact colors (background, button fill, border, shadow, highlight).
  - Border-radius values (pill vs circle).
  - Box-shadow / highlight / inset values for the “raised” glass effect.
- [ ] **0.3** Extract or list CSS variables / tokens from the design file (e.g. `--glass-bg`, `--glass-border`, `--glass-shadow`, `--glass-highlight`) for reuse across the app.
- [ ] **0.4** Decide where to store shared assets: either inline SVGs in components, or a small icon set in `src/assets/icons/` / `public/icons/` and how they’ll be imported.

---

## Phase 1: Understand Landing Page Redesign

- [ ] **1.1** Map the **current** landing (Welcome) structure:
  - `WelcomePage.jsx`: main layout, `welcome-page`, `welcome-bg`, `welcome-section-trending`, `welcome-sidebar-row`, `welcome-widget`, etc.
  - Key sections: Trending ticker, left sidebar (Welcome Widget + possibly more), main content area, right sidebar (watchlist/Command Center).
- [ ] **1.2** From the design file, list which **landing sections** it defines (hero, nav, cards, CTAs, etc.) and name them so we can align Welcome page sections to “Spectre Glass” equivalents.
- [ ] **1.3** Write a short “Landing page redesign summary”: which sections stay, which are renamed, which are new, and in what order. No code yet – understanding only.
- [ ] **1.4** Identify any **new components** implied by the design (e.g. glass card, pill button, icon-only circle button) and add them to the task list for later implementation.

---

## Phase 2: Welcome Widget – Styling Tasks (step-by-step)

Start implementation with the **Welcome Widget** only. Apply Spectre Glass style so it matches the reference (dark glass, neumorphic depth, white text/icons).

### 2.1 Container (card)

- [ ] **2.1.1** Update `.welcome-widget` (and `.welcome-widget-glass` if used) to match design:
  - Background: dark charcoal/glass (from design tokens).
  - Border: subtle light border (e.g. `rgba(255,255,255,0.08–0.12)`).
  - Border-radius: consistent with reference (e.g. 16–20px or as specified).
  - Box-shadow: soft top highlight + soft bottom shadow for “raised” glass; optional subtle inset.
- [ ] **2.1.2** Ensure padding and gap align with design; adjust if the reference uses different spacing.

### 2.2 Profile row (avatar + “Welcome” + name)

- [ ] **2.2.1** **Avatar ring** (`.welcome-widget-avatar-ring`):
  - Apply same glass/neumorphic treatment: subtle highlight on top edge, soft shadow below.
  - Border and radius to match reference (circular).
  - Hover/focus: slightly stronger highlight or shadow, no harsh outlines unless for a11y.
- [ ] **2.2.2** **Avatar circle** (`.welcome-widget-avatar`):
  - Inner fill color from design (dark gray/charcoal).
  - Border and any inner shadow to match reference.
- [ ] **2.2.3** **“Welcome” label** (`.welcome-widget-label`):
  - Font size, weight, color (e.g. white or high-contrast gray) from design.
- [ ] **2.2.4** **Name display / edit** (`.welcome-widget-name-display`, `.welcome-widget-input`):
  - Text style and any pill/capsule styling if the design shows an input or name chip in that style.

### 2.3 Price cards row

- [ ] **2.3.1** **Price card container** (`.welcome-widget-price-card`):
  - Style as small glass/neumorphic cards: dark fill, soft border, top highlight, bottom shadow.
  - Border-radius (e.g. pill-like or rounded rect) per design.
  - Hover: subtle lift (e.g. shadow increase or slight translateY).
- [ ] **2.3.2** **Card header** (logo + symbol + info button) (`.welcome-widget-price-card-head`):
  - Ensure logo/avatar size and spacing match design.
  - If the design has an **icon button** (e.g. info “i” or chevron): restyle as **circular glass button** (same treatment as “plus” in reference – dark fill, soft highlight, white icon).
- [ ] **2.3.3** **Price value & change** (`.welcome-widget-price-value`, `.welcome-widget-price-change`):
  - Typography and positive/negative colors from design; ensure contrast.
- [ ] **2.3.4** **Mcap / Index card** (`.welcome-widget-mcap-card`):
  - Same glass treatment as other cards; icon (◆) and sublabel styling from design.

### 2.4 Icons and buttons inside the widget

- [ ] **2.4.1** Replace or restyle any **icon-only buttons** (e.g. info, edit) to **circular glass style**:
  - Circle size from reference.
  - Dark charcoal bg, soft highlight top, shadow bottom, white icon.
- [ ] **2.4.2** If the design uses a **pill/capsule button** (e.g. “Customise”): introduce a reusable class (e.g. `.glass-pill-btn`) and apply to any such button in the Welcome Widget (if any).
- [ ] **2.4.3** Use **icons from the design file** where applicable (same SVG markup or exported assets) so the look is consistent.

### 2.5 Optional: Fear & Greed / Dominance / other compact blocks

- [ ] **2.5.1** If the Welcome Widget includes **Fear & Greed** or **Dominance** compact blocks (`.welcome-widget-fear-greed-compact`, `.welcome-widget-dominance-compact`, etc.): apply the same glass card treatment (background, border, shadow, radius) so the whole widget feels one system.
- [ ] **2.5.2** Any small action or “more” buttons in those blocks: use the same circular or pill glass style.

### 2.6 Polish and responsiveness

- [ ] **2.6.1** Check contrast (WCAG) for text and icons on the new glass backgrounds.
- [ ] **2.6.2** Test Welcome Widget at different viewport widths; adjust padding, font sizes, or card wrap if needed.
- [ ] **2.6.3** Reduce motion / prefers-reduced-motion: ensure hover/focus effects are optional or subtle where appropriate.

---

## Phase 3: After Welcome Widget (later)

- [ ] **3.1** Reuse the same design tokens and button/icon styles on **next** high-visibility area (e.g. Header, Navigation, or Command Center).
- [ ] **3.2** Introduce shared components (e.g. `GlassCard`, `GlassPillButton`, `GlassIconButton`) and refactor Welcome Widget to use them.
- [ ] **3.3** Roll out Spectre Glass across the rest of the landing and app per a separate task list.

---

## Summary: Where We Start

| Phase | Focus | Output |
|-------|--------|--------|
| 0 | Design reference & tokens | Design file in repo; documented colors/shadows/icons; CSS variables. |
| 1 | Landing redesign understanding | Written map of current vs new sections; list of new components. |
| 2 | Welcome Widget only | All Welcome Widget styles and icons updated to Spectre Glass. |
| 3 | Later | Rest of app; shared components. |

**Start with:** Phase 0 (so we can read the design) and Phase 1 (so we know what we’re redesigning). Then implement Phase 2 step-by-step, beginning with **2.1 Container** and **2.2 Profile row**.
