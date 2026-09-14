# SPECTRE AI — MOBILE AGENT STACK SETUP

You are setting up a mobile-optimised development environment for the Spectre AI app (app.spectreai.io). This is an ADDITIVE setup — you are extending what exists, not replacing it. SPECTRE_DESIGN_LAW.md is law. Nothing you install changes it.

---

## STEP 1 — Read the existing laws first

Before installing anything, read these files in order:
1. `SPECTRE_DESIGN_LAW.md` — this governs everything. Mobile is subordinate to it.
2. `CLAUDE.md` — session boot sequence. Do not modify it.
3. `src/index.css` — the actual CSS token source of truth.

---

## STEP 2 — Install the mobile agent skill stack

Install the following Claude Code skills. Each install command should be run from the project root. Do NOT let any skill generate a new design system — our design system already exists in `src/index.css` and `SPECTRE_DESIGN_LAW.md`.

### 2a. ui-ux-pro-max (design intelligence layer)

```bash
npm install -g uipro-cli
uipro init --ai claude
```

**Critical constraint:** This skill contains a design system generator. DO NOT run it with `--design-system` flag. We already have our design system. Use this skill ONLY for:
- Querying mobile UX patterns: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "crypto fintech dark mobile glassmorphism" --stack react-native`
- Querying accessibility rules: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "touch targets accessibility mobile" --domain ux`
- Querying animation patterns: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "mobile micro-interactions" --domain ux`

Any color, font, or spacing output from this skill is IGNORED. Our tokens from `src/index.css` take precedence.

### 2b. react-native-skills (Vercel Labs — mobile performance)

```bash
mkdir -p .claude/skills/react-native-skills
curl -L "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-native-skills/SKILL.md" \
  -o .claude/skills/react-native-skills/SKILL.md
```

This skill teaches Claude mobile performance rules. These are additive — no design system conflict. Apply all performance rules from this skill to every mobile component.

### 2c. composition-patterns (Vercel Labs — component architecture)

```bash
mkdir -p .claude/skills/composition-patterns
curl -L "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/composition-patterns/SKILL.md" \
  -o .claude/skills/composition-patterns/SKILL.md
```

Additive only. No design system output. Use for mobile component structure.

### 2d. web-interface-guidelines (Vercel Labs — accessibility + touch)

```bash
mkdir -p .claude/skills/web-interface-guidelines
curl -L "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/web-design-guidelines/SKILL.md" \
  -o .claude/skills/web-interface-guidelines/SKILL.md
```

Use for WCAG compliance, touch target enforcement, and ARIA attributes. Color/visual outputs ignored — SPECTRE_DESIGN_LAW.md governs visuals.

---

## STEP 3 — Create MOBILE_BOOT.md

Create a new file called `MOBILE_BOOT.md` in the project root with this exact content:

```markdown
# SPECTRE MOBILE BOOT — Read after SPECTRE_DESIGN_LAW.md

> This file EXTENDS the design law for mobile contexts. It never overrides it.
> If any rule here conflicts with SPECTRE_DESIGN_LAW.md — the law wins.

---

## MOBILE DESIGN HIERARCHY

1. SPECTRE_DESIGN_LAW.md — absolute law
2. src/index.css — token source of truth  
3. MOBILE_BOOT.md (this file) — mobile addons only

---

## MANDATORY MOBILE RULES (additive to the law)

### Touch targets
- Every tappable element: minimum 44×44px hit area (iOS HIG + WCAG 2.5.5)
- Bottom navigation items: 56px height minimum
- Price rows in lists: 56px minimum height (finger-friendly)
- Floating action buttons: 56px diameter

### Performance (from react-native-skills)
- Use FlashList instead of FlatList for ALL list components
- Memoize every list item component with React.memo()
- Never create inline style objects inside render — extract to StyleSheet
- Stabilize all callback references with useCallback()
- Never put expensive operations inside list item components
- Use itemType for heterogeneous lists

### Gesture layer
- Swipe right to go back: always use native gesture handler, never override
- Long press threshold: 400ms (platform default)
- Pull-to-refresh: always native RefreshControl, never custom spinner
- Loading states: skeleton shimmer ONLY (law already mandates this — enforced here too)

### Layout viewport
- Design at 390px width (iPhone 15 base), scale up to tablet
- Safe area insets: always account for notch + home indicator
- Bottom sheet pattern for contextual menus (not popups, not modals)
- Tab bar lives above home indicator safe area — 83px from screen bottom on iOS

### Spectre design tokens → mobile mapping
- Our CSS variables do not directly translate to React Native StyleSheet
- Map them manually as a constants file: `src/constants/mobileTokens.js`
- NEVER use hardcoded hex — always reference mobileTokens.js which mirrors src/index.css

```javascript
// src/constants/mobileTokens.js — generated from src/index.css
export const colors = {
  bgVoid:     '#000000',
  bgBase:     '#0c0c0e',
  bgSurface:  '#131316',
  bgElevated: '#1a1a1f',
  bgOverlay:  '#222228',
  bgHover:    '#2a2a30',
  textPrimary:   'rgba(255,255,255,1)',
  textSecondary: 'rgba(255,255,255,0.72)',
  textTertiary:  'rgba(255,255,255,0.48)',
  textMuted:     'rgba(255,255,255,0.32)',
  bull:   '#10B981',
  bear:   '#EF4444',
  accent: '#8B5CF6',
  borderSubtle:  'rgba(255,255,255,0.04)',
  borderDefault: 'rgba(255,255,255,0.08)',
  borderStrong:  'rgba(255,255,255,0.14)',
  borderAccent:  'rgba(139,92,246,0.4)',
}
export const radius = { sm: 8, md: 12, lg: 16, xl: 24 }
export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 }
export const fonts = {
  display: 'SpaceGrotesk',  // load via expo-font or react-native-google-fonts
  body:    'Inter',
  mono:    'JetBrainsMono', // ALL prices, numbers, addresses — non-negotiable
}
```

### Glass cards on mobile
- backdrop-filter does not work in React Native — simulate glass with:
  ```javascript
  // Mobile glass card equivalent
  {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8, // Android
  }
  ```
- Top edge highlight: add a 1px view at the top of every card with `backgroundColor: 'rgba(255,255,255,0.18)'`

### Icons on mobile
- spectreIcons are SVG — use react-native-svg to render them
- Wrap each icon: `<SvgXml xml={spectreIcons.iconName} width={24} height={24} />`
- NEVER import react-native-vector-icons, Lucide, or any external icon library
- Icon touch targets: wrap in a 44×44 Pressable with transparent background

### Animations
- Use react-native-reanimated v3 for all animations (not Animated API)
- Translate-Y lift on press: translateY(-2) — same as web hover, adapted to press
- Entry animations: FadeIn + SlideInDown from reanimated entering/exiting
- Number morphing on price change: digit-by-digit reanimated transition
- Stagger card entry: 50ms per card using reanimated with delay
- All animations respect AccessibilityInfo.isReduceMotionEnabled()

### Navigation
- Bottom tab bar: 5 items max, use spectreIcons for tab icons
- Active tab: `--accent` (#8B5CF6) tint on icon, full opacity label
- Inactive tab: icon at 0.48 opacity, label hidden or 0.32 opacity
- Stack navigation header: transparent, content scrolls under it
- No floating hamburger menus — we are tab-bar native

---

## WHAT NOT TO DO ON MOBILE (extends the law)

| ❌ DO NOT | Why |
|---|---|
| Use FlatList for long lists | FlashList is mandatory — 10x performance |
| Hardcode hex colors | Use mobileTokens.js mirror of src/index.css |
| Import any icon library other than spectreIcons | Law violation |
| Use backdrop-filter in React Native | Doesn't work — use glass simulation above |
| Create touch targets under 44px | Fails accessibility + feels bad |
| Use platform default blue for links | We are purple (#8B5CF6) — update tintColor globally |
| Show loading spinners | Skeleton shimmer only — law mandates this |
| Use Tailwind or NativeWind defaults | Wrong design language — always our tokens |
| Override gesture back navigation | Never fight native gestures |
| Design for 375px (iPhone SE) as base | Design at 390px (iPhone 15), test at 375px |

---

## MOBILE CREATIVE MANDATE (extends law section: Creative Agent)

Every mobile screen must have:
1. **A "hold phone and show someone" moment** — one element that reads beautifully at arm's length
2. **Haptic feedback** on key interactions: price alerts, successful trades, pull-to-refresh completion
3. **Contextual bottom sheets** instead of navigation for quick data — tap a token price, get a glass bottom sheet with sparkline + stats, not a new screen
4. **Live price tickers** in list rows — if a price updates, the number morphs digit-by-digit, not hard-swaps
5. **Ambient glow behind hero prices** — faint token-colored radial gradient, same as desktop law

```

---

## STEP 4 — Update CLAUDE.md boot sequence

Add the following line to the boot sequence section of CLAUDE.md, AFTER the existing SPECTRE_DESIGN_LAW.md read instruction:

```
4. Read `MOBILE_BOOT.md` if working on any mobile, React Native, or responsive component.
```

Do NOT remove or reorder existing CLAUDE.md entries. Append only.

---

## STEP 5 — Create mobileTokens.js

Create `src/constants/mobileTokens.js` using the token values from step 3 above. This is the single source of truth for mobile — it mirrors `src/index.css`. Alaa or Haitham should add a script to auto-generate this file from src/index.css CSS variables as a future task.

---

## STEP 6 — Verify no conflicts

Run the following check after setup:

1. Confirm `.claude/skills/ui-ux-pro-max/` exists and contains SKILL.md
2. Confirm `.claude/skills/react-native-skills/` exists and contains SKILL.md  
3. Confirm `.claude/skills/composition-patterns/` exists and contains SKILL.md
4. Confirm `.claude/skills/web-interface-guidelines/` exists and contains SKILL.md
5. Confirm `MOBILE_BOOT.md` exists at project root
6. Confirm `src/constants/mobileTokens.js` exists with correct token values
7. Confirm SPECTRE_DESIGN_LAW.md is UNCHANGED
8. Confirm CLAUDE.md has the new line appended (not replaced)

Report what was installed, what was created, and confirm zero modifications to existing design law files.

---

## WHAT THIS SETUP DOES NOT DO

- Does NOT change SPECTRE_DESIGN_LAW.md
- Does NOT change CLAUDE.md (except one appended line)
- Does NOT change src/index.css
- Does NOT generate a new Spectre design system (we have one)
- Does NOT install shadcn/ui, Tailwind, or any UI framework
- Does NOT add any external icon libraries
- Does NOT touch existing components

---

## AGENT PLUGINS — SEPARATE INSTALLS (do these manually, not via this prompt)

These are Claude Code plugins installed separately via the Claude marketplace or slash commands. Do NOT run these from this prompt — they are interactive and quota-intensive:

- **Superpowers** (`/install-skill superpowers`) — for complex multi-agent mobile feature builds
- **Ralph Wiggum** (`/install-plugin ralph-loop`) — for visual regression testing of mobile simulator — warn before running, it consumes significant quota
- **Shipyard** (`/install-skill shipyard`) — for GCP/OVH security audits before mobile API changes
- **/code-review** — already available in Claude Code by default, no install needed

---

End of setup prompt. Confirm each step as complete before proceeding to the next.
