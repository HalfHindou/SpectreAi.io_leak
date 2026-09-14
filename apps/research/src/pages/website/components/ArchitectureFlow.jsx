import { useMemo } from 'react'
import {
  ReactFlow,
  Position,
  Handle,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import './ArchitectureFlow.css'

/* ── Custom Node Components ── */

function SourceNode({ data }) {
  return (
    <div className="af-node af-node--source">
      <div className="af-node-icon" style={{ background: `${data.color}18`, color: data.color }}>
        {data.icon}
      </div>
      <div className="af-node-text">
        <div className="af-node-title">{data.label}</div>
        <div className="af-node-sub">{data.sub}</div>
      </div>
      <Handle type="source" position={Position.Right} className="af-handle" />
    </div>
  )
}

function EngineNode() {
  return (
    <div className="af-engine">
      <div className="af-engine-glow" />
      <div className="af-engine-card">
        <img src="/spectre-logo-dark.png" alt="Spectre AI" className="af-engine-logo" />
        <div className="af-engine-title">Spectre AI</div>
        <div className="af-engine-sub">Processing Engine</div>
      </div>
      <Handle type="target" position={Position.Left} className="af-handle" id="in" />
      <Handle type="source" position={Position.Right} className="af-handle" id="out" />
    </div>
  )
}

function OutputNode({ data }) {
  return (
    <div className="af-node af-node--output">
      <Handle type="target" position={Position.Left} className="af-handle" />
      <div className="af-node-icon" style={{ background: `${data.color}18`, color: data.color }}>
        {data.icon}
      </div>
      <div className="af-node-text">
        <div className="af-node-title">{data.label}</div>
        <div className="af-node-sub">{data.sub}</div>
      </div>
    </div>
  )
}

const nodeTypes = { source: SourceNode, engine: EngineNode, output: OutputNode }

/* ── Icon helper ── */
const ico = (d, size = 22) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
  </svg>
)

const PATHS = {
  globe: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
  news: 'M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z',
  technical: 'M12 20V10M18 20V4M6 20v-4',
  dashboard: 'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25',
  library: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  bell: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0',
  whale: ['M20.893 13.393l-1.135-1.135a2.252 2.252 0 01-.421-.585l-1.08-2.16a.414.414 0 00-.663-.107.827.827 0 01-.812.21l-1.273-.363a.89.89 0 00-.738.135l-1.45 1.088a1.27 1.27 0 01-1.267.07L9 8.5', 'M11 3a8 8 0 100 16 8 8 0 000-16z'],
  heatmap: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  social: 'M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155',
}

/* ── Node + Edge definitions ── */

const GAP_Y = 120
const LEFT_X = 0
const CENTER_X = 520
const RIGHT_X = 1040

const initialNodes = [
  // Data sources (left)
  { id: 'src-market', type: 'source', position: { x: LEFT_X, y: 0 }, data: { label: 'Market Data', sub: 'CoinGecko + Binance', icon: ico(PATHS.globe), color: '#6B9AE8' } },
  { id: 'src-news', type: 'source', position: { x: LEFT_X, y: GAP_Y }, data: { label: 'News & Social', sub: 'X + CryptoPanic', icon: ico(PATHS.news), color: '#3B82F6' } },
  { id: 'src-chain', type: 'source', position: { x: LEFT_X, y: GAP_Y * 2 }, data: { label: 'On-Chain', sub: 'Codex GraphQL', icon: ico(PATHS.technical), color: '#F59E0B' } },
  { id: 'src-whale', type: 'source', position: { x: LEFT_X, y: GAP_Y * 3 }, data: { label: 'Whale Tracking', sub: 'Wallet Monitoring', icon: ico(PATHS.whale), color: '#06B6D4' } },

  // Engine (center)
  { id: 'engine', type: 'engine', position: { x: CENTER_X, y: GAP_Y * 1.05 }, data: {} },

  // Outputs (right)
  { id: 'out-cmd', type: 'output', position: { x: RIGHT_X, y: 0 }, data: { label: 'Command Center', sub: 'Live Dashboard', icon: ico(PATHS.dashboard), color: '#6B9AE8' } },
  { id: 'out-research', type: 'output', position: { x: RIGHT_X, y: GAP_Y }, data: { label: 'Research Zone', sub: 'Deep Analysis', icon: ico(PATHS.library), color: '#10B981' } },
  { id: 'out-heatmap', type: 'output', position: { x: RIGHT_X, y: GAP_Y * 2 }, data: { label: 'Heatmaps', sub: 'Market Structure', icon: ico(PATHS.heatmap), color: '#F59E0B' } },
  { id: 'out-social', type: 'output', position: { x: RIGHT_X, y: GAP_Y * 3 }, data: { label: 'Social Pulse', sub: 'Narrative Tracking', icon: ico(PATHS.social), color: '#A78BFA' } },
  { id: 'out-alerts', type: 'output', position: { x: RIGHT_X, y: GAP_Y * 4 }, data: { label: 'Alerts', sub: 'Push + Email', icon: ico(PATHS.bell), color: '#EC4899' } },
]

const EDGE_STYLE = { stroke: 'rgba(255,255,255,0.14)', strokeWidth: 1.5 }

const initialEdges = [
  { id: 'e-market', source: 'src-market', target: 'engine', targetHandle: 'in', type: 'default', animated: true, style: EDGE_STYLE },
  { id: 'e-news', source: 'src-news', target: 'engine', targetHandle: 'in', type: 'default', animated: true, style: EDGE_STYLE },
  { id: 'e-chain', source: 'src-chain', target: 'engine', targetHandle: 'in', type: 'default', animated: true, style: EDGE_STYLE },
  { id: 'e-whale', source: 'src-whale', target: 'engine', targetHandle: 'in', type: 'default', animated: true, style: EDGE_STYLE },
  { id: 'e-cmd', source: 'engine', sourceHandle: 'out', target: 'out-cmd', type: 'default', animated: true, style: EDGE_STYLE },
  { id: 'e-research', source: 'engine', sourceHandle: 'out', target: 'out-research', type: 'default', animated: true, style: EDGE_STYLE },
  { id: 'e-heatmap', source: 'engine', sourceHandle: 'out', target: 'out-heatmap', type: 'default', animated: true, style: EDGE_STYLE },
  { id: 'e-social', source: 'engine', sourceHandle: 'out', target: 'out-social', type: 'default', animated: true, style: EDGE_STYLE },
  { id: 'e-alerts', source: 'engine', sourceHandle: 'out', target: 'out-alerts', type: 'default', animated: true, style: EDGE_STYLE },
]

/* ── Component ── */

export default function ArchitectureFlow() {
  const proOptions = useMemo(() => ({ hideAttribution: true }), [])

  return (
    <div className="af-container">
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        nodeTypes={nodeTypes}
        proOptions={proOptions}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnDrag={false}
        panOnScroll={false}
        preventScrolling={false}
        minZoom={0.4}
        maxZoom={1.5}
      />
    </div>
  )
}
