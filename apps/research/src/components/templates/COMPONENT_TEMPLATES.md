# Spectre Component Templates
# COPY THESE. DO NOT INVENT YOUR OWN.

When building a new component, search this file first. If a matching pattern exists, COPY it and only change content/props. Do not modify the styles.

---

## Glass Card

The primary surface in Spectre. Use for any content container.

```jsx
<div className="glass-card">
  {/* content */}
</div>
```

```css
.glass-card {
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--sp-4) var(--sp-5);
}
.glass-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
  transition: all var(--duration-base) var(--ease-out);
}
.app.app-day-mode .glass-card {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
}
```

---

## Metric Display (with "i" button slot)

For any stat/metric value with label.

```jsx
<div className="metric-display">
  <span className="metric-label">Market Cap</span>
  <div className="metric-value-row">
    <span className="metric-value">$380.2B</span>
    <span className="metric-change positive">+5.2%</span>
    {/* IButton goes here */}
  </div>
</div>
```

```css
.metric-display {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.metric-label {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.metric-value {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}
.metric-value-row {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}
.metric-change {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
}
.metric-change.positive { color: var(--bull); }
.metric-change.negative { color: var(--bear); }
.app.app-day-mode .metric-label { color: #64748b; }
.app.app-day-mode .metric-value { color: #0f172a; }
```

---

## Data Chip

Inline pill for small data points (protocol names, values).

```jsx
<span className="data-chip">
  <span className="data-chip-label">Aave</span>
  <span className="data-chip-value positive">+$18.2M</span>
</span>
```

```css
.data-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border-default);
  font-family: var(--font-mono);
  font-size: 11px;
}
.data-chip-label { color: var(--text-muted); }
.data-chip-value { color: var(--text-primary); font-weight: 500; }
.data-chip-value.positive { color: var(--bull); }
.data-chip-value.negative { color: var(--bear); }
.app.app-day-mode .data-chip {
  background: #f8fafc;
  border-color: rgba(0,0,0,0.06);
}
.app.app-day-mode .data-chip-label { color: #94a3b8; }
.app.app-day-mode .data-chip-value { color: #0f172a; }
```

---

## Section Header

Standard heading + subtitle row for any panel/section.

```jsx
<div className="section-header">
  <h3 className="section-title">Market Overview</h3>
  <span className="section-subtitle">Updated 2 min ago</span>
</div>
```

```css
.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--sp-4);
}
.section-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}
.section-subtitle {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-muted);
}
.app.app-day-mode .section-title { color: #0f172a; }
.app.app-day-mode .section-subtitle { color: #94a3b8; }
```

---

## Badge / Tag

Status pills for categorization.

```jsx
<span className="badge badge-green">Signal</span>
<span className="badge badge-amber">Building</span>
<span className="badge badge-purple">Promoted</span>
```

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.badge-green { background: rgba(16,185,129,0.12); color: #10B981; }
.badge-amber { background: rgba(245,158,11,0.12); color: #F59E0B; }
.badge-purple { background: rgba(139,92,246,0.12); color: #8B5CF6; }
.badge-red { background: rgba(239,68,68,0.12); color: #EF4444; }
/* Day mode: same colors work on white bg */
```

---

## Skeleton Shimmer (loading state)

NEVER use spinners. Always skeleton shimmer.

```jsx
<div className="skeleton" style={{ width: 120, height: 20 }} />
<div className="skeleton" style={{ width: '100%', height: 44 }} />
```

```css
.skeleton {
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.03) 25%,
    rgba(255,255,255,0.06) 50%,
    rgba(255,255,255,0.03) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.app.app-day-mode .skeleton {
  background: linear-gradient(
    90deg,
    rgba(0,0,0,0.04) 25%,
    rgba(0,0,0,0.07) 50%,
    rgba(0,0,0,0.04) 75%
  );
  background-size: 200% 100%;
}
```

Stagger multiple skeletons:
```css
.skeleton.stagger-1 { animation-delay: 50ms; }
.skeleton.stagger-2 { animation-delay: 100ms; }
.skeleton.stagger-3 { animation-delay: 150ms; }
.skeleton.stagger-4 { animation-delay: 200ms; }
.skeleton.stagger-5 { animation-delay: 250ms; }
```

---

## Button (glass style)

```jsx
<button className="btn-glass">Connect Wallet</button>
<button className="btn-accent">Upgrade to Pro</button>
```

```css
.btn-glass {
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-4);
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}
.btn-glass:hover {
  background: rgba(255,255,255,0.06);
  border-color: var(--border-strong);
  color: var(--text-primary);
}
.btn-accent {
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-4);
  font-family: var(--font-body);
  font-size: 13px;
  color: #09090b;
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}
.btn-accent:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}
.app.app-day-mode .btn-glass {
  background: #ffffff;
  border-color: rgba(0,0,0,0.1);
  color: #334155;
}
.app.app-day-mode .btn-glass:hover {
  background: #f8fafc;
}
```

---

## Token Row (for tables/lists)

```jsx
<div className="token-row">
  <img className="token-logo" src={logoUrl} alt={symbol} />
  <div className="token-info">
    <span className="token-symbol">{symbol}</span>
    <span className="token-name">{name}</span>
  </div>
  <span className="token-price">${price}</span>
  <span className={`token-change ${change >= 0 ? 'positive' : 'negative'}`}>
    {change >= 0 ? '+' : ''}{change}%
  </span>
</div>
```

```css
.token-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-md);
  transition: background var(--duration-fast) ease;
}
.token-row:hover {
  background: var(--bg-hover);
}
.token-logo {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-default);
}
.token-symbol {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.token-name {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--text-muted);
}
.token-price {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-left: auto;
}
.token-change {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  min-width: 60px;
  text-align: right;
}
.token-change.positive { color: var(--bull); }
.token-change.negative { color: var(--bear); }
```

---

## Input Field

```jsx
<div className="input-group">
  <label className="input-label">Search</label>
  <input className="input" type="text" placeholder="Search tokens..." />
</div>
```

```css
.input-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.input-label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.input {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--duration-fast) ease;
}
.input::placeholder {
  color: var(--text-muted);
}
.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}
.app.app-day-mode .input {
  background: #ffffff;
  border-color: rgba(0,0,0,0.1);
  color: #0f172a;
}
```

---

## Tooltip

Use the global `data-tooltip` system. Do not build custom tooltips.

```jsx
<span data-tooltip="24h trading volume across all exchanges">
  Volume
</span>
```

No custom CSS needed - the global tooltip system handles it.

---

## Horizontal Scroll Strip (mobile)

For any horizontally scrollable list on mobile.

```jsx
<div className="strip-scroll">
  {items.map(item => (
    <div className="strip-item" key={item.id}>
      {/* content */}
    </div>
  ))}
</div>
```

```css
.strip-scroll {
  display: flex;
  gap: var(--sp-2);
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  padding: 0 var(--sp-2);
}
.strip-scroll::-webkit-scrollbar { display: none; }
.strip-item {
  scroll-snap-align: start;
  flex-shrink: 0;
}
```

---

## Empty State

When a section has no data.

```jsx
<div className="empty-state">
  <span className="empty-state-icon">{spectreIcons.search}</span>
  <p className="empty-state-text">No results found</p>
</div>
```

```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  padding: var(--sp-8) var(--sp-4);
  color: var(--text-muted);
}
.empty-state-icon {
  width: 32px;
  height: 32px;
  opacity: 0.4;
}
.empty-state-text {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-muted);
}
```

---

## Tab Bar

Horizontal tabs with animated indicator.

```jsx
<div className="tab-bar">
  {tabs.map((tab, i) => (
    <button
      key={tab.id}
      className={`tab-item ${activeTab === i ? 'active' : ''}`}
      onClick={() => setActiveTab(i)}
    >
      {tab.label}
    </button>
  ))}
</div>
```

```css
.tab-bar {
  display: flex;
  gap: var(--sp-1);
  padding: var(--sp-1);
  background: rgba(255,255,255,0.02);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-bar::-webkit-scrollbar { display: none; }
.tab-item {
  padding: var(--sp-2) var(--sp-3);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  background: none;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--duration-fast) ease;
}
.tab-item:hover {
  color: var(--text-secondary);
  background: rgba(255,255,255,0.03);
}
.tab-item.active {
  color: var(--text-primary);
  background: rgba(255,255,255,0.05);
}
.app.app-day-mode .tab-bar {
  background: #f8fafc;
  border-color: rgba(0,0,0,0.06);
}
.app.app-day-mode .tab-item.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
```
