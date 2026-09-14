# Spectre AI Trading Platform - Design System

> **Premium Apple-Style Design System**  
> Silicon Valley VC-Funded Startup Aesthetic with WOW Effects

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Design Tokens](#design-tokens)
3. [Typography](#typography)
4. [Color System](#color-system)
5. [Spacing & Layout](#spacing--layout)
6. [Component Patterns](#component-patterns)
7. [Animations & Transitions](#animations--transitions)
8. [Glass Morphism](#glass-morphism)
9. [Glow Effects](#glow-effects)
10. [Usage Guidelines](#usage-guidelines)

---

## Design Philosophy

### Core Principles

1. **Premium Dark Theme** - Deep, rich blacks with subtle gradients
2. **Glass Morphism** - Frosted glass effects with backdrop blur
3. **Smooth Animations** - Apple-like transitions with cubic-bezier easing
4. **Visual Hierarchy** - Clear information architecture with proper contrast
5. **WOW Effects** - Subtle but impressive visual flourishes
6. **Professional Polish** - Institutional-grade trading platform aesthetic

### Design Language

- **Minimal but Rich** - Clean interfaces with depth and texture
- **Dark First** - Optimized for dark mode with high contrast
- **Motion as Feedback** - Animations provide context and delight
- **Glass & Glow** - Modern frosted glass with accent glows
- **Gradient Accents** - Purple/violet gradients for brand identity

---

## Design Tokens

### CSS Variables Location

All design tokens are defined in `src/index.css` under `:root`.

---

## Typography

### Font Families

```css
--font-display: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
--font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
```

**Usage:**
- **Display Font** (`Space Grotesk`) - Headings, hero text, brand elements
- **Body Font** (`Inter`) - Body text, UI labels, descriptions
- **Mono Font** (`JetBrains Mono`) - Prices, addresses, code, numbers

### Type Scale

| Class | Font Size | Font Weight | Line Height | Use Case |
|-------|-----------|-------------|-------------|----------|
| `.display-hero` | `clamp(2.5rem, 5vw, 4.5rem)` | 700 | 1.05 | Hero headlines |
| `.display-xl` | `3rem` | 700 | 1.15 | Large headings |
| `.display-lg` | `2.25rem` | 700 | 1.15 | Section headings |
| `.display-md` | `1.75rem` | 600 | 1.2 | Subsection headings |
| `.display-sm` | `1.375rem` | 600 | 1.25 | Card titles |
| `.heading` | `1.125rem` | 600 | 1.3 | Component headings |
| `.subheading` | `0.75rem` | 600 | 1.4 | Labels, captions |
| `.body-lg` | `1.0625rem` | 400 | 1.7 | Large body text |
| `.body` | `0.9375rem` | 400 | 1.6 | Default body text |
| `.body-sm` | `0.8125rem` | 400 | 1.5 | Small body text |
| `.caption` | `0.75rem` | 400 | 1.4 | Captions, metadata |

### Letter Spacing

- **Display Text**: `-0.04em` to `-0.025em` (tighter for large text)
- **Body Text**: `-0.01em` (slightly tighter)
- **Uppercase Labels**: `0.05em` to `0.1em` (more spacing)

### Font Features

```css
font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
```

Enables OpenType features for better typography.

---

## Color System

### Background Hierarchy

```css
--bg-void: #000000;           /* Deepest black - void space */
--bg-base: #030304;           /* Base background */
--bg-surface: #0a0a0c;        /* Card surfaces */
--bg-elevated: #101012;        /* Elevated cards */
--bg-overlay: #161618;         /* Overlays, modals */
--bg-hover: #1c1c20;          /* Hover states */
```

**Usage Guidelines:**
- Use `--bg-base` for main page background
- Use `--bg-surface` for cards and panels
- Use `--bg-elevated` for nested cards or elevated elements
- Use `--bg-overlay` for modals and overlays
- Use `--bg-hover` for interactive hover states

### Text Hierarchy

```css
--text-primary: #ffffff;                    /* Main text */
--text-secondary: rgba(255, 255, 255, 0.72); /* Secondary text */
--text-tertiary: rgba(255, 255, 255, 0.48); /* Tertiary text */
--text-muted: rgba(255, 255, 255, 0.32);    /* Muted text */
--text-disabled: rgba(255, 255, 255, 0.16); /* Disabled text */
```

**Usage:**
- **Primary**: Headings, important labels, values
- **Secondary**: Body text, descriptions
- **Tertiary**: Metadata, timestamps
- **Muted**: Placeholders, hints
- **Disabled**: Disabled UI elements

### Trading Colors

```css
/* Bull (Green) - Positive, gains, buys */
--bull: #10B981;
--bull-bright: #34D399;
--bull-muted: rgba(16, 185, 129, 0.15);
--bull-glow: rgba(16, 185, 129, 0.4);

/* Bear (Red) - Negative, losses, sells */
--bear: #EF4444;
--bear-bright: #F87171;
--bear-muted: rgba(239, 68, 68, 0.15);
--bear-glow: rgba(239, 68, 68, 0.4);
```

**Usage:**
- Use `--bull` for positive price changes, buy indicators
- Use `--bear` for negative price changes, sell indicators
- Use `--bull-muted` / `--bear-muted` for subtle backgrounds
- Use `--bull-glow` / `--bear-glow` for glow effects

### Brand Accent Colors

```css
/* Primary Accent - Purple Gradient */
--accent: #8B5CF6;                    /* Primary purple */
--accent-secondary: #A78BFA;         /* Lighter purple */
--accent-hover: #A78BFA;             /* Hover state */
--accent-muted: rgba(139, 92, 246, 0.12);
--accent-glow: rgba(139, 92, 246, 0.5);
--accent-gradient: linear-gradient(135deg, #8B5CF6 0%, #6366F1 50%, #4F46E5 100%);

/* Secondary Accents */
--cyan: #06B6D4;
--cyan-glow: rgba(6, 182, 212, 0.4);
--amber: #F59E0B;
--violet: #A855F7;
--pink: #EC4899;
--blue: #3B82F6;
```

**Usage:**
- Use `--accent` for primary CTAs, active states
- Use `--accent-gradient` for buttons, hero elements
- Use `--accent-muted` for subtle backgrounds
- Use `--accent-glow` for glow effects

### Border Colors

```css
--border-subtle: rgba(255, 255, 255, 0.04);  /* Very subtle borders */
--border-default: rgba(255, 255, 255, 0.08);  /* Default borders */
--border-strong: rgba(255, 255, 255, 0.14);  /* Strong borders */
--border-accent: rgba(139, 92, 246, 0.4);    /* Accent borders */
```

**Usage:**
- Use `--border-subtle` for card dividers
- Use `--border-default` for card borders
- Use `--border-strong` for hover states
- Use `--border-accent` for active/focused states

### Shadows

```css
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.5);
--shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.6), 0 1px 2px rgba(0, 0, 0, 0.4);
--shadow-md: 0 4px 16px rgba(0, 0, 0, 0.5), 0 2px 4px rgba(0, 0, 0, 0.3);
--shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.6), 0 4px 8px rgba(0, 0, 0, 0.4);
--shadow-xl: 0 16px 48px rgba(0, 0, 0, 0.7), 0 8px 16px rgba(0, 0, 0, 0.5);
--shadow-glow: 0 0 40px var(--accent-glow);
--shadow-glow-sm: 0 0 20px var(--accent-glow);
--shadow-inner: inset 0 1px 0 rgba(255, 255, 255, 0.06);
```

**Usage:**
- Use `--shadow-sm` for small cards
- Use `--shadow-md` for standard cards
- Use `--shadow-lg` for elevated cards
- Use `--shadow-glow` for accent elements
- Use `--shadow-inner` for inset depth

---

## Spacing & Layout

### Spacing Scale (4px base)

```css
--sp-0: 0;
--sp-1: 4px;   /* 0.25rem */
--sp-2: 8px;   /* 0.5rem */
--sp-3: 12px;  /* 0.75rem */
--sp-4: 16px;  /* 1rem */
--sp-5: 20px;  /* 1.25rem */
--sp-6: 24px;  /* 1.5rem */
--sp-8: 32px;  /* 2rem */
--sp-10: 40px; /* 2.5rem */
--sp-12: 48px; /* 3rem */
--sp-16: 64px; /* 4rem */
```

**Usage Guidelines:**
- Use `--sp-1` to `--sp-2` for tight spacing (icons, badges)
- Use `--sp-3` to `--sp-4` for component padding
- Use `--sp-6` to `--sp-8` for section spacing
- Use `--sp-12` to `--sp-16` for major layout spacing

### Border Radius

```css
--radius-xs: 4px;
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 24px;
--radius-2xl: 32px;
--radius-full: 9999px;
```

**Usage:**
- Use `--radius-sm` for small elements (badges, chips)
- Use `--radius-md` for buttons, inputs
- Use `--radius-lg` for cards, panels
- Use `--radius-xl` for large cards, modals
- Use `--radius-full` for circular elements

### Grid System

The platform uses a **3-column layout**:

```css
.main-layout {
  grid-template-columns: 380px 1fr 380px; /* Left | Center | Right */
  gap: var(--sp-4);
}
```

**Responsive Breakpoints:**
- `1600px`: Columns reduce to `340px`
- `1400px`: Columns reduce to `300px`
- `1200px`: Left panel hides, `1fr 320px`
- `900px`: Single column layout

---

## Component Patterns

### Buttons

#### Primary Button

```css
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-5);
  background: var(--accent-gradient);
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  box-shadow: 0 4px 14px rgba(139, 92, 246, 0.35), inset 0 1px 0 rgba(255,255,255,0.15);
}
```

**Usage:** Primary CTAs, main actions

#### Secondary Button

```css
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-5);
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
```

**Usage:** Secondary actions, alternative CTAs

#### Ghost Button

```css
.btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
```

**Usage:** Tertiary actions, icon buttons

### Cards

#### Standard Card

```css
.glass-card {
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-inner), var(--shadow-md);
  transition: all var(--duration-base) var(--ease-out);
}
```

**Usage:** Content cards, panels, containers

### Inputs

```css
.input {
  width: 100%;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: 0.9375rem;
  color: var(--text-primary);
  transition: all var(--duration-fast) var(--ease-out);
}

.input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}
```

**Usage:** Text inputs, search bars, form fields

### Badges & Pills

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-1) var(--sp-2);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}
```

**Usage:** Status indicators, labels, tags

---

## Animations & Transitions

### Easing Functions

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);      /* Smooth deceleration */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);   /* Standard easing */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* Bouncy spring */
```

**Usage:**
- `--ease-out`: Most UI transitions (buttons, cards)
- `--ease-in-out`: Standard animations
- `--ease-spring`: Playful, bouncy effects

### Duration Scale

```css
--duration-instant: 100ms;  /* Instant feedback */
--duration-fast: 150ms;     /* Quick transitions */
--duration-base: 250ms;      /* Standard transitions */
--duration-slow: 400ms;      /* Slow, deliberate */
--duration-slower: 600ms;    /* Very slow */
```

**Usage:**
- `--duration-instant`: Hover states, micro-interactions
- `--duration-fast`: Button clicks, toggles
- `--duration-base`: Card hovers, modal opens
- `--duration-slow`: Page transitions, complex animations

### Animation Classes

```css
.animate-in { animation: fadeIn var(--duration-base) var(--ease-out); }
.animate-fade-up { animation: fadeInUp var(--duration-slow) var(--ease-out); }
.animate-fade-down { animation: fadeInDown var(--duration-slow) var(--ease-out); }
.animate-scale { animation: scaleIn var(--duration-slow) var(--ease-spring); }
.animate-slide-left { animation: slideInLeft var(--duration-slow) var(--ease-out); }
.animate-slide-right { animation: slideInRight var(--duration-slow) var(--ease-out); }
.animate-pulse { animation: pulse 2s var(--ease-in-out) infinite; }
.animate-breathe { animation: breathe 3s var(--ease-in-out) infinite; }
.animate-float { animation: float 4s var(--ease-in-out) infinite; }
```

**Usage:**
- Apply animation classes to elements for entrance effects
- Use stagger delays for lists: `.stagger-1`, `.stagger-2`, etc.

---

## Glass Morphism

### Glass Effects

```css
.glass {
  background: var(--glass-bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-inner), var(--shadow-lg);
}

.glass-subtle {
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
}
```

**Glass Variables:**
```css
--glass-bg: rgba(16, 16, 20, 0.75);
--glass-bg-light: rgba(255, 255, 255, 0.03);
--glass-border: rgba(255, 255, 255, 0.08);
--glass-border-light: rgba(255, 255, 255, 0.12);
--glass-glow: rgba(139, 92, 246, 0.15);
```

**Usage:**
- Use `.glass` for main glass panels
- Use `.glass-subtle` for lighter glass effects
- Always include `-webkit-backdrop-filter` for Safari support

---

## Glow Effects

### Glow Classes

```css
.glow {
  box-shadow: var(--shadow-glow);
}

.glow-sm {
  box-shadow: var(--shadow-glow-sm);
}

.glow-text {
  text-shadow: 0 0 20px var(--accent-glow);
}

.glow-border {
  border: 1px solid var(--border-accent);
  box-shadow: 0 0 20px rgba(139, 92, 246, 0.15), inset 0 0 20px rgba(139, 92, 246, 0.05);
}
```

**Usage:**
- Use `.glow` for accent elements
- Use `.glow-text` for important text
- Use `.glow-border` for highlighted borders

---

## Usage Guidelines

### Do's ✅

1. **Use Design Tokens** - Always use CSS variables, never hardcode values
2. **Consistent Spacing** - Use the spacing scale (`--sp-*`)
3. **Proper Typography** - Use the type scale classes
4. **Smooth Animations** - Use provided easing functions
5. **Glass Effects** - Use glass morphism for modern depth
6. **Accessibility** - Maintain proper contrast ratios
7. **Responsive** - Test on multiple screen sizes

### Don'ts ❌

1. **Don't Hardcode Colors** - Always use CSS variables
2. **Don't Skip Transitions** - All interactive elements should animate
3. **Don't Overuse Glow** - Use glow effects sparingly
4. **Don't Mix Fonts** - Stick to the defined font families
5. **Don't Ignore Hierarchy** - Use proper text opacity levels
6. **Don't Break Glass** - Maintain backdrop-filter consistency

### Component Checklist

When creating a new component:

- [ ] Uses design tokens (colors, spacing, typography)
- [ ] Has proper hover states with transitions
- [ ] Includes glass morphism if appropriate
- [ ] Uses correct border radius scale
- [ ] Has proper text hierarchy
- [ ] Includes smooth animations
- [ ] Is responsive
- [ ] Has proper focus states for accessibility

---

## Examples

### Example: Button Component

```jsx
<button className="btn-primary">
  <span>Connect Wallet</span>
</button>
```

### Example: Card Component

```jsx
<div className="glass-card">
  <h3 className="heading">Token Stats</h3>
  <p className="body">Market cap and volume data</p>
</div>
```

### Example: Input Component

```jsx
<input 
  type="text" 
  className="input" 
  placeholder="Search tokens..."
/>
```

### Example: Badge Component

```jsx
<span className="badge">
  <span className="status-live"></span>
  Live
</span>
```

---

## Resources

- **Main Stylesheet**: `src/index.css`
- **Component Styles**: `src/components/*.css`
- **Fonts**: Google Fonts (Inter, Space Grotesk, JetBrains Mono)

---

## Version

**Design System v1.0**  
Last Updated: 2024

---

## Contributing

When adding new components or styles:

1. Follow the existing design token system
2. Use CSS variables for all values
3. Include hover and focus states
4. Add smooth transitions
5. Test on multiple screen sizes
6. Document any new patterns in this file

---

**Built with ❤️ for Spectre AI Trading Platform**
