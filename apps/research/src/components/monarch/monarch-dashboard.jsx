/**
 * MonarchDashboard — renders a dashboard_spec block into a CSS Grid of widgets.
 *
 * Consumed by monarch-message-bubble. The dashboard_spec JSON comes from the
 * streaming LLM response and is parsed by extractDashboardSpec() in MonarchContext.
 *
 * Widget types: metric_card, gauge, bar_chart, line_chart, pie_chart, table, list, heatmap
 * Widget sizes: "1x1" (one cell), "2x1" (2 cols wide), "1x2" (2 rows tall)
 * Layouts:      "2x2", "2x3", "3x2", "3x3" (cols x rows)
 *
 * Design tokens: follows .claude/rules/design-system.md
 *   — warm-white on pure black
 *   — glass cards with subtle borders
 *   — JetBrains Mono for all numbers via .mono
 *   — #10B981 positive, #EF4444 negative
 *   — no neon, no purple in chrome
 */
import { useMemo, Fragment } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
} from 'recharts'
import './monarch-dashboard.css'

const BULL = '#10B981'
const BEAR = '#EF4444'
const NEUTRAL = 'rgba(245, 245, 247, 0.35)'
const DEFAULT_PALETTE = ['#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#06B6D4', '#A78BFA', '#F97316', '#f5f5f7']

/* ── Layout helper — grid columns based on layout string ── */
function gridColsFromLayout(layout) {
  if (typeof layout !== 'string') return 2
  const match = layout.match(/^(\d+)x(\d+)$/)
  if (!match) return 2
  return Math.max(1, Math.min(4, parseInt(match[1], 10)))
}

/* ── Size helper — CSS grid span per widget size ── */
function sizeToStyle(size) {
  if (typeof size !== 'string') return { gridColumn: 'span 1', gridRow: 'span 1' }
  const match = size.match(/^(\d+)x(\d+)$/)
  if (!match) return { gridColumn: 'span 1', gridRow: 'span 1' }
  const cols = Math.max(1, Math.min(4, parseInt(match[1], 10)))
  const rows = Math.max(1, Math.min(3, parseInt(match[2], 10)))
  return { gridColumn: `span ${cols}`, gridRow: `span ${rows}` }
}

/* ══════════════════════════════════════════════════════════════════════════
 * WIDGET: metric_card — label + big value + optional change indicator
 * { type:'metric_card', title, value, subtitle?, change?, change_direction? }
 * ══════════════════════════════════════════════════════════════════════════ */
function MetricCard({ w }) {
  const direction = w.change_direction || (w.change?.startsWith('-') ? 'down' : w.change?.startsWith('+') ? 'up' : null)
  const changeColor = direction === 'up' ? BULL : direction === 'down' ? BEAR : 'rgba(245,245,247,0.6)'
  return (
    <div className="mdash-widget mdash-metric">
      {w.title && <div className="mdash-widget-title">{w.title}</div>}
      <div className="mdash-metric-value mono">{w.value ?? '—'}</div>
      {w.change && (
        <div className="mdash-metric-change mono" style={{ color: changeColor }}>
          {w.change}
        </div>
      )}
      {w.subtitle && <div className="mdash-widget-subtitle">{w.subtitle}</div>}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * WIDGET: gauge — semicircle, 0 to max, with color zones and center label
 * { type:'gauge', title, value, max, label?, color_zones? }
 * ══════════════════════════════════════════════════════════════════════════ */
function Gauge({ w }) {
  const max = w.max || 100
  const value = typeof w.value === 'number' ? Math.max(0, Math.min(max, w.value)) : 0
  const pct = value / max
  const zones = Array.isArray(w.color_zones) && w.color_zones.length
    ? w.color_zones
    : [
      { min: 0, max: 25, color: '#EF4444' },
      { min: 25, max: 50, color: '#F59E0B' },
      { min: 50, max: 75, color: '#10B981' },
      { min: 75, max: 100, color: '#10B981' },
    ]
  // Find active zone color
  const activeZone = zones.find(z => value >= z.min && value <= z.max) || zones[zones.length - 1]
  const activeColor = activeZone.color

  // Semicircle geometry
  const r = 48
  const cx = 60
  const cy = 60
  const circumference = Math.PI * r
  const dashLength = pct * circumference
  const dashArray = `${dashLength} ${circumference}`

  return (
    <div className="mdash-widget mdash-gauge">
      {w.title && <div className="mdash-widget-title">{w.title}</div>}
      <div className="mdash-gauge-svg-wrap">
        <svg viewBox="0 0 120 70" width="100%" height="auto" role="img" aria-label={w.title || 'gauge'}>
          {/* Track */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
          />
          {/* Fill */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            stroke={activeColor}
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={dashArray}
            style={{ transition: 'stroke-dasharray 400ms cubic-bezier(0.16,1,0.3,1), stroke 200ms ease' }}
          />
        </svg>
        <div className="mdash-gauge-center">
          <div className="mdash-gauge-value mono" style={{ color: activeColor }}>{value}</div>
          {w.label && <div className="mdash-gauge-label">{w.label}</div>}
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * WIDGET: bar_chart — horizontal-ish bar chart for gainers/losers/rankings
 * { type:'bar_chart', title, data:[{label,value,color?}] }
 * ══════════════════════════════════════════════════════════════════════════ */
function BarChartWidget({ w }) {
  const data = Array.isArray(w.data)
    ? w.data.map(d => ({ label: d.label || d.name || '', value: Number(d.value) || 0, color: d.color }))
    : []
  if (!data.length) return <EmptyWidget title={w.title} reason="No data" />
  return (
    <div className="mdash-widget mdash-chart">
      {w.title && <div className="mdash-widget-title">{w.title}</div>}
      <div className="mdash-chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: 'rgba(245,245,247,0.5)', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            />
            <YAxis
              tick={{ fill: 'rgba(245,245,247,0.4)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              contentStyle={{
                background: 'rgba(18,18,22,0.96)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                fontSize: 11,
                color: '#f5f5f7',
              }}
              labelStyle={{ color: 'rgba(245,245,247,0.6)' }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color || (entry.value >= 0 ? BULL : BEAR)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * WIDGET: line_chart — time series (price, TVL, OI over time)
 * { type:'line_chart', title, labels, data:number[], color? }
 * ══════════════════════════════════════════════════════════════════════════ */
function LineChartWidget({ w }) {
  const labels = Array.isArray(w.labels) ? w.labels : []
  const values = Array.isArray(w.data) ? w.data : []
  const data = values.map((v, i) => ({ x: labels[i] ?? `${i + 1}`, y: Number(v) || 0 }))
  if (!data.length) return <EmptyWidget title={w.title} reason="No data" />
  const color = w.color || BULL
  return (
    <div className="mdash-widget mdash-chart">
      {w.title && <div className="mdash-widget-title">{w.title}</div>}
      <div className="mdash-chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <XAxis
              dataKey="x"
              tick={{ fill: 'rgba(245,245,247,0.5)', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            />
            <YAxis
              tick={{ fill: 'rgba(245,245,247,0.4)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={32}
              domain={['auto', 'auto']}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(255,255,255,0.14)', strokeWidth: 1 }}
              contentStyle={{
                background: 'rgba(18,18,22,0.96)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                fontSize: 11,
                color: '#f5f5f7',
              }}
            />
            <Line
              type="monotone"
              dataKey="y"
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: color, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * WIDGET: pie_chart — distribution (sector TVL, dominance breakdown)
 * { type:'pie_chart', title, data:[{label,value,color?}] }
 * ══════════════════════════════════════════════════════════════════════════ */
function PieChartWidget({ w }) {
  const data = Array.isArray(w.data)
    ? w.data.map((d, i) => ({
      name: d.label || d.name || `Slice ${i + 1}`,
      value: Number(d.value) || 0,
      color: d.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    }))
    : []
  if (!data.length) return <EmptyWidget title={w.title} reason="No data" />
  return (
    <div className="mdash-widget mdash-chart">
      {w.title && <div className="mdash-widget-title">{w.title}</div>}
      <div className="mdash-chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={2}
              stroke="rgba(0,0,0,0.35)"
            >
              {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'rgba(18,18,22,0.96)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                fontSize: 11,
                color: '#f5f5f7',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mdash-pie-legend">
        {data.map((entry, i) => (
          <span key={i} className="mdash-pie-legend-item">
            <span className="mdash-pie-legend-dot" style={{ background: entry.color }} />
            <span className="mdash-pie-legend-label">{entry.name}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * WIDGET: table — rows and columns
 * { type:'table', title, columns:string[], rows:string[][] }
 * ══════════════════════════════════════════════════════════════════════════ */
function TableWidget({ w }) {
  const columns = Array.isArray(w.columns) ? w.columns : []
  const rows = Array.isArray(w.rows) ? w.rows : []
  if (!columns.length || !rows.length) return <EmptyWidget title={w.title} reason="No rows" />

  const valueClass = (cell) => {
    if (typeof cell !== 'string') return 'mono'
    if (/^[+]/.test(cell)) return 'mono mdash-pos'
    if (/^-\d/.test(cell)) return 'mono mdash-neg'
    return 'mono'
  }

  return (
    <div className="mdash-widget mdash-table-widget">
      {w.title && <div className="mdash-widget-title">{w.title}</div>}
      <div className="mdash-table-scroll">
        <table className="mdash-table">
          <thead>
            <tr>
              {columns.map((c, i) => <th key={`h-${i}`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={`r-${ri}`}>
                {row.map((cell, ci) => (
                  <td key={`c-${ri}-${ci}`} className={ci === 0 ? '' : valueClass(cell)}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * WIDGET: list — feed of items with optional tag chip and time
 * { type:'list', title, items:[{text, tag?, time?}] }
 * ══════════════════════════════════════════════════════════════════════════ */
function ListWidget({ w }) {
  const items = Array.isArray(w.items) ? w.items : []
  if (!items.length) return <EmptyWidget title={w.title} reason="No items" />

  const tagClass = (tag) => {
    if (!tag) return ''
    const t = String(tag).toLowerCase()
    if (t === 'bullish' || t === 'positive' || t === 'up') return 'mdash-tag mdash-tag-bull'
    if (t === 'bearish' || t === 'negative' || t === 'down') return 'mdash-tag mdash-tag-bear'
    if (t === 'alert' || t === 'warning') return 'mdash-tag mdash-tag-warn'
    return 'mdash-tag'
  }

  return (
    <div className="mdash-widget mdash-list-widget">
      {w.title && <div className="mdash-widget-title">{w.title}</div>}
      <ul className="mdash-list">
        {items.map((item, i) => (
          <li key={i} className="mdash-list-item">
            <span className="mdash-list-text">{item.text}</span>
            <span className="mdash-list-meta">
              {item.tag && <span className={tagClass(item.tag)}>{item.tag}</span>}
              {item.time && <span className="mdash-list-time">{item.time}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * WIDGET: heatmap — grid of colored cells
 * { type:'heatmap', title, rows:string[], cols:string[], cells:number[][] }
 * cell values are normalized to -1..1 for bull/bear color mapping
 * ══════════════════════════════════════════════════════════════════════════ */
function HeatmapWidget({ w }) {
  const rows = Array.isArray(w.rows) ? w.rows : []
  const cols = Array.isArray(w.cols) ? w.cols : []
  const cells = Array.isArray(w.cells) ? w.cells : []
  if (!rows.length || !cols.length || !cells.length) return <EmptyWidget title={w.title} reason="No heatmap data" />

  // Compute min/max for normalization
  const flat = cells.flat().filter(v => typeof v === 'number')
  const maxAbs = Math.max(...flat.map(v => Math.abs(v)), 0.01)

  const cellColor = (v) => {
    if (typeof v !== 'number') return 'rgba(255,255,255,0.04)'
    const norm = v / maxAbs // -1..1
    const alpha = Math.min(0.9, Math.abs(norm) * 0.9 + 0.08)
    if (norm >= 0) return `rgba(16, 185, 129, ${alpha})`
    return `rgba(239, 68, 68, ${alpha})`
  }

  return (
    <div className="mdash-widget mdash-heatmap-widget">
      {w.title && <div className="mdash-widget-title">{w.title}</div>}
      <div className="mdash-heatmap-wrap">
        <div className="mdash-heatmap-corner" />
        {cols.map((c, ci) => <div key={`col-${ci}`} className="mdash-heatmap-col-label">{c}</div>)}
        {rows.map((rLabel, ri) => (
          <Fragment key={`row-${ri}`}>
            <div className="mdash-heatmap-row-label">{rLabel}</div>
            {cols.map((_, ci) => {
              const v = cells[ri]?.[ci]
              return (
                <div
                  key={`cell-${ri}-${ci}`}
                  className="mdash-heatmap-cell mono"
                  style={{ background: cellColor(v) }}
                  title={`${rLabel} / ${cols[ci]}: ${v}`}
                >
                  {typeof v === 'number' ? v.toFixed(1) : ''}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * EmptyWidget — fallback for widgets without data
 * ══════════════════════════════════════════════════════════════════════════ */
function EmptyWidget({ title, reason }) {
  return (
    <div className="mdash-widget mdash-empty">
      {title && <div className="mdash-widget-title">{title}</div>}
      <div className="mdash-empty-body">{reason || 'No data'}</div>
    </div>
  )
}

/* ── Widget type dispatcher ── */
function Widget({ w }) {
  if (!w || !w.type) return null
  const style = sizeToStyle(w.size)
  const render = (() => {
    switch (w.type) {
      case 'metric_card': return <MetricCard w={w} />
      case 'gauge':       return <Gauge w={w} />
      case 'bar_chart':   return <BarChartWidget w={w} />
      case 'line_chart':  return <LineChartWidget w={w} />
      case 'pie_chart':   return <PieChartWidget w={w} />
      case 'table':       return <TableWidget w={w} />
      case 'list':        return <ListWidget w={w} />
      case 'heatmap':     return <HeatmapWidget w={w} />
      default:            return <EmptyWidget title={w.title} reason={`Unknown widget type: ${w.type}`} />
    }
  })()
  return <div className="mdash-widget-wrap" style={style}>{render}</div>
}

/* ══════════════════════════════════════════════════════════════════════════
 * MAIN: MonarchDashboard
 * Props: { spec }  — the parsed dashboard_spec object from MonarchContext
 * ══════════════════════════════════════════════════════════════════════════ */
export default function MonarchDashboard({ spec }) {
  const widgets = Array.isArray(spec?.widgets) ? spec.widgets : []
  const cols = useMemo(() => gridColsFromLayout(spec?.layout), [spec?.layout])

  if (!spec || !widgets.length) return null

  return (
    <div className="mdash-root">
      {spec.title && (
        <div className="mdash-header">
          <span className="mdash-title">{spec.title}</span>
          <span className="mdash-source">Monarch AI · Spectre Data</span>
        </div>
      )}
      <div
        className="mdash-grid"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {widgets.map((w, i) => <Widget key={w.id || `w-${i}`} w={w} />)}
      </div>
    </div>
  )
}
