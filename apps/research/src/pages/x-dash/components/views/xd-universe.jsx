/**
 * XDUniverse — the "Constellation" tab inside /x-dash: the KOL ↔ project
 * cosmos (three.js) embedded in the dashboard. Projects are planets pulled
 * inward by mention velocity, KOLs are moons of the project they push
 * hardest, receipts from the Proof ledger make proven voices pulse, and
 * live breakout-radar signals land as chips.
 *
 * Thin wrapper: data comes from useCrawlGraph (same crawl the X Bubbles
 * page runs), the visualization is XBubblesCosmos in embedded mode.
 * Clicking a planet opens the standard x-dash token drawer via onOpenToken.
 *
 * NOTE: imports across page folders (x-intelligence → here) because the
 * universe is now a 2-page surface — promoting it to src/components/ is the
 * cleanup for the next structural pass.
 */
import { useState } from 'react'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import useCrawlGraph, { DEFAULT_SEED, DEFAULT_DEPTH } from '@/pages/x-intelligence/hooks/useCrawlGraph'
import XBubblesCosmos from '@/pages/x-intelligence/components/XBubblesCosmos'
import './xd-universe.css'

export default function XDUniverse({ onOpenToken, refinedDesign = false }) {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const isMobile = useIsMobile()
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [depth, setDepth] = useState(DEFAULT_DEPTH)

  const graph = useCrawlGraph({
    seed,
    projectCount: 20,
    depth,
    enabled: true,
  })

  return (
    <div className="xdu-host">
      <XBubblesCosmos
        graph={graph}
        mode="crawl"
        embedded
        refinedControls={refinedDesign}
        dayMode={dayMode}
        isMobile={isMobile}
        crawlSeed={seed}
        onCrawlSeedChange={setSeed}
        crawlDepth={depth}
        onCrawlDepthChange={setDepth}
        onProjectOpen={(cgId) => onOpenToken?.(cgId, { source: 'universe' })}
      />
    </div>
  )
}
