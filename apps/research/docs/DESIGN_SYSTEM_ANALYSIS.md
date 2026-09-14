# Spectre AI Trading Platform - Design System Analysis

> **Comprehensive documentation of the styling architecture, patterns, and conventions**

---

## 1. CSS Organization

### Directory Structure
```
src/
├── index.css                    # Global design tokens, reset, animations, utilities
├── App.css                      # Main layout, 3-column grid, responsive breakpoints
├── styles/
│   ├── mobile-2026.css         # Mobile-first optimizations (iPhone 15/16, Android)
│   └── app-store-ready.css     # PWA/App Store specific styles
├── components/
│   ├── WelcomePage.css         # Main landing page (17,600+ lines)
│   ├── WelcomePage.day-mode.css   # Light theme overrides
│   ├── WelcomePage.cinema-mode.css # Cinema/Netflix-style immersive mode
│   ├── [Component].css         # Component-specific styles (60+ files)
│   └── ...
└── packages/spectre-ui/
    ├── src/
    │   ├── styles/global.css   # Package-specific global styles
    │   ├── tokens/variables.css # Design tokens with spectre- prefix
    │   └── components/
    │       ├── Button/Button.css
    │       ├── Card/Card.css
    │       ├── Input/Input.css
    │       └── ...
```

### CSS Architecture Patterns

**1. Token-Based Approach**
- Root-level CSS variables in `src/index.css` under `:root`
- Package-scoped tokens in `packages/spectre-ui/src/tokens/variables.css` with `--spectre-` prefix
- Component-local variables using `--wp-` or `--cinema-` prefixes

**2. Multi-Mode Theme System**
- **Dark Mode (Default)**: Premium dark theme with glass morphism
- **Day Mode**: Light theme with sentiment-driven accent colors
- **Cinema Mode**: Netflix/Higgsfield-style immersive experience
- **Stock Mode**: Specialized for equity trading interface

**3. CSS Organization Principles**
- BEM-inspired naming (`.spectre-btn--primary`, `.glass-card`)
- Utility-first classes (`.animate-fade-up`, `.glow-text`)
- Performance annotations (containment, content-visibility)

---

## 2. Design Tokens

### Global Tokens (`src/index.css :root`)

#### Background Hierarchy
```css
--bg-void: #000000;           /* Deepest black - void space */
--bg-base: #0c0c0e;           /* Base background */
--bg-surface: #131316;        /* Card surfaces */
--bg-elevated: #1a1a1f;       /* Elevated cards */
--bg-overlay: #222228;        /* Overlays, modals */
--bg-hover: #2a2a30;          /* Hover states */
```

#### Text Hierarchy (Alpha-based)
```css
--text-primary: #ffffff;                      /* Main text */
--text-secondary: rgba(255, 255, 255, 0.72); /* Secondary text */
--text-tertiary: rgba(255, 255, 255, 0.48);  /* Tertiary text */
--text-muted: rgba(255, 255, 255, 0.32);     /* Muted text */
--text-disabled: rgba(255, 255, 255, 0.16);  /* Disabled text */
```

#### Trading Colors
```css
/* Bull/Bear semantic colors */
--bull: #10B981;
--bull-bright: #34D399;
--bull-muted: rgba(16, 185, 129, 0.15);
--bull-glow: rgba(16, 185, 129, 0.4);

--bear: #EF4444;
--bear-bright: #F87171;
--bear-muted: rgba(239, 68, 68, 0.15);
--bear-glow: rgba(239, 68, 68, 0.4);
```

#### Brand Accent (Purple Gradient)
```css
--accent: #8B5CF6;
--accent-secondary: #A78BFA;
--accent-hover: #A78BFA;
--accent-muted: rgba(139, 92, 246, 0.12);
--accent-glow: rgba(139, 92, 246, 0.5);
--accent-gradient: linear-gradient(135deg, #8B5CF6 0%, #6366F1 50%, #4F46E5 100%);
```

#### Typography
```css
--font-display: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
--font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
--font-glass: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
```

#### Glass Morphism
```css
--glass-bg: rgba(19, 19, 22, 0.85);
--glass-bg-light: rgba(255, 255, 255, 0.03);
--glass-border: transparent;
--glass-border-light: transparent;
--glass-glow: rgba(255, 255, 255, 0.05);
--glass-charcoal: #1a1a1e;
```

### Spectre UI Package Tokens (`packages/spectre-ui/src/tokens/variables.css`)

All tokens use `--spectre-` prefix for namespacing:
- `--spectre-bg-base`, `--spectre-text-primary`
- `--spectre-space-4`, `--spectre-radius-lg`
- `--spectre-duration-normal`, `--spectre-easing-out`
- `--spectre-shadow-md`, `--spectre-z-modal`

---

## 3. Theme Patterns

### Day Mode (Light Theme)

**File**: `src/components/WelcomePage.day-mode.css`

```css
.welcome-page.day-mode {
  --wp-day-bg: #f5f5f7;
  --wp-day-surface: #ffffff;
  --wp-day-text: #1e293b;
  --wp-day-muted: #64748b;
}
```

**Characteristics**:
- Sentiment-driven accent colors (bullish=green, bearish=red, neutral=indigo)
- Radial gradient orbs with sentiment-tinted colors
- Subtle grid pattern with lowered opacity
- Multi-color accent line at top edge (BTC orange → purple → ETH blue)

### Cinema Mode

**File**: `src/components/WelcomePage.cinema-mode.css`

```css
.welcome-page.cinema-mode {
  --cinema-bg: #0a0a0f;
  --cinema-card-bg: rgba(15, 15, 20, 0.9);
  --cinema-border: transparent;
  --cinema-text: #fff;
  --cinema-transition: cubic-bezier(0.16, 1, 0.3, 1);
}
```

**Characteristics**:
- Full-bleed immersive layout
- Living sentiment wall with ambient glow
- Animated background breathing effect (`cinema-sentiment-breathe`)
- Fixed canvas overlay for visual effects
- Editorial typography with Playfair Display font

### Theme Provider Pattern

**File**: `packages/spectre-ui/src/tokens/ThemeProvider.tsx`

```typescript
export type ThemeMode = 'dark' | 'light' | 'system';

export function SpectreThemeProvider({ children, defaultTheme = 'dark' }) {
  // Persists to localStorage
  // Syncs with system preference when set to 'system'
  // Applies class-based theming (`spectre-dark`, `spectre-light`)
}
```

---

## 4. Spectre-UI Package Structure

### Package Manifest (`packages/spectre-ui/`)

```
packages/spectre-ui/
├── .storybook/              # Storybook configuration
│   ├── main.ts
│   ├── preview.tsx
│   └── storybook.css
├── src/
│   ├── components/          # UI components (each: Component.tsx, Component.css, stories)
│   │   ├── AuthGate/
│   │   ├── Badge/
│   │   ├── Button/
│   │   ├── Card/
│   │   ├── Input/
│   │   ├── Modal/
│   │   └── Toast/
│   ├── styles/
│   │   └── global.css       # Typography utilities, scrollbar, animations
│   ├── tokens/
│   │   ├── variables.css    # CSS custom properties
│   │   └── ThemeProvider.tsx # React context for theming
│   ├── utils/
│   │   ├── formatters.ts    # Currency, percentages, dates
│   │   └── index.ts
│   └── index.ts             # Public API exports
├── package.json             # @spectre-ai/ui package
└── tsconfig.json
```

### Component Architecture

Each component follows this structure:
```typescript
// Component.tsx
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(...);
```

```css
/* Component.css */
.spectre-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spectre-space-2);
  transition: all var(--spectre-duration-fast) var(--spectre-easing-default);
}

.spectre-btn--primary {
  background: var(--spectre-accent-gradient);
  box-shadow: var(--spectre-shadow-sm), 0 0 20px rgba(139, 92, 246, 0.2);
}
```

---

## 5. Responsive Design Patterns

### Breakpoint Strategy (Mobile-First)

```css
/* Mobile (default) */
@media (max-width: 768px) { ... }

/* Tablet */
@media (min-width: 769px) and (max-width: 1024px) { ... }

/* Desktop */
@media (min-width: 1025px) { ... }

/* Large Desktop */
@media (min-width: 1200px) { ... }
@media (min-width: 1400px) { ... }
@media (min-width: 1600px) { ... }
```

### Grid System

**3-Column Desktop Layout** (`src/App.css`):
```css
.main-layout {
  display: grid;
  grid-template-columns: 380px 1fr 380px;
  gap: var(--sp-4);
}

/* Responsive scaling */
@media (max-width: 1600px) { grid-template-columns: 340px 1fr 340px; }
@media (max-width: 1400px) { grid-template-columns: 300px 1fr 300px; }
@media (max-width: 1200px) { grid-template-columns: 1fr 320px; } /* Hide left panel */
@media (max-width: 900px) { grid-template-columns: 1fr; } /* Single column */
```

### Mobile-First Optimizations (`src/styles/mobile-2026.css`)

**Key Patterns**:
- **Fluid typography** with `clamp()`
- **Dynamic viewport units** (`dvh`, `svh`) for browser chrome handling
- **Safe area awareness** with `env(safe-area-inset-*)`
- **Touch targets** minimum 44px
- **Anti-wobble**: Horizontal axis lock to prevent rubber banding
- **Performance**: Reduced blur, GPU compositing hints

**Mobile CSS Custom Properties**:
```css
@media (max-width: 768px) {
  :root {
    --m-xs: 4px;
    --m-sm: 8px;
    --m-md: 12px;
    --m-text-sm: 0.75rem;
    --m-text-base: 0.8125rem;
    --m-header-h: 52px;
    --m-bottom-nav-h: 76px;
    --m-blur: blur(8px);
  }
}
```

**Bottom Navigation Pattern**:
```css
.app.mobile-bottom-nav-visible .app-main-content {
  padding-bottom: calc(76px + env(safe-area-inset-bottom, 0));
}
```

---

## 6. Animation & Motion Patterns

### Animation Tokens

```css
/* Easing Functions */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);      /* Smooth deceleration */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);   /* Standard easing */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* Bouncy spring */

/* Duration Scale */
--duration-instant: 100ms;
--duration-fast: 150ms;
--duration-base: 250ms;
--duration-slow: 400ms;
--duration-slower: 600ms;
```

### CSS Keyframe Animations

**Entrance Animations**:
```css
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } ... }
@keyframes fadeInDown { from { opacity: 0; transform: translateY(-20px); } ... }
@keyframes scaleIn { from { opacity: 0; transform: scale(0.9); } ... }
```

**Ambient Animations**:
```css
@keyframes breathe {
  0%, 100% { box-shadow: 0 0 20px var(--accent-glow); }
  50% { box-shadow: 0 0 40px var(--accent-glow), 0 0 60px rgba(139, 92, 246, 0.2); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

@keyframes borderGlow {
  0%, 100% { border-color: rgba(139, 92, 246, 0.3); ... }
  50% { border-color: rgba(139, 92, 246, 0.6); ... }
}
```

### Animation Utility Classes

```css
.animate-in { animation: fadeIn var(--duration-base) var(--ease-out); }
.animate-fade-up { animation: fadeInUp var(--duration-slow) var(--ease-out); }
.animate-scale { animation: scaleIn var(--duration-slow) var(--ease-spring); }
.animate-pulse { animation: pulse 2s var(--ease-in-out) infinite; }
.animate-breathe { animation: breathe 3s var(--ease-in-out) infinite; }
.animate-float { animation: float 4s var(--ease-in-out) infinite; }
```

### Stagger Animation Pattern

```css
.stagger-1 { animation-delay: 50ms; }
.stagger-2 { animation-delay: 100ms; }
.stagger-3 { animation-delay: 150ms; }
.stagger-4 { animation-delay: 200ms; }
.stagger-5 { animation-delay: 250ms; }
```

Usage in JSX:
```jsx
{items.map((item, index) => (
  <div key={item.id} style={{ animationDelay: `${index * 0.05}s` }}>
    {item.content}
  </div>
))}
```

### Reduced Motion Support

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Framer Motion Usage

**Status**: Although `framer-motion` is installed (v12.33.0), the codebase primarily uses:
- CSS animations for simple transitions
- Remotion for video/complex compositing (TokenVideoCard, MarketOverview)
- Native CSS transitions for hover states

Key files using motion:
- `src/remotion/*.jsx` - Video composition animations
- `src/components/WelcomePage.jsx` - CSS-based animations with stagger delays

---

## 7. Glass Morphism Patterns

### Core Glass Classes

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

.glass-card {
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-inner), var(--shadow-md);
  transition: all var(--duration-base) var(--ease-out);
}

.glass-card:hover {
  border-color: var(--glass-border-light);
  box-shadow: var(--shadow-inner), var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Safety Notes
- Always include `-webkit-backdrop-filter` for Safari support
- Mobile uses reduced blur (`blur(8px)`) for performance
- Use `isolate` or `z-index` to prevent blur bleeding

---

## 8. Component Conventions

### Button Pattern
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

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(139, 92, 246, 0.45), ...;
}
```

### Card Pattern
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

### Input Pattern
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

---

## 9. Performance Optimizations

### GPU Acceleration
```css
.welcome-page {
  -webkit-overflow-scrolling: touch;
}

.welcome-sidebar-row,
.welcome-market-ai-widget {
  contain: layout style paint;
}

.welcome-market-ai-widget {
  content-visibility: auto;
  contain-intrinsic-size: auto 500px;
}
```

### Scrollbar Styling
```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-full);
  border: 2px solid transparent;
  background-clip: padding-box;
}
```

---

## 10. Key Takeaways

### Design System Maturity
- **Well-structured**: Clear separation between app styles and package styles
- **Token-driven**: Consistent use of CSS custom properties
- **Multi-theme**: Supports dark, light, cinema modes gracefully
- **Mobile-optimized**: Comprehensive mobile-first approach

### Patterns to Adopt
1. **Use the spacing scale** (`--sp-*` or `--spectre-space-*`)
2. **Typography hierarchy** with display/body separation
3. **Glass morphism** for modern depth
4. **Consistent transitions** with custom easing curves
5. **Performance annotations** (containment, content-visibility)

### Patterns to Avoid
1. Hardcoding colors - always use tokens
2. Relying on Framer Motion for simple transitions (use CSS)
3. Forgetting `-webkit-backdrop-filter` for glass effects
4. Missing `prefers-reduced-motion` support
5. Inconsistent border usage (prefer `border-subtle` or none)

---

*Analysis generated for Spectre AI Trading Platform*
*Date: February 2026*
