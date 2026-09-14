/**
 * useTreemapLayout — d3-hierarchy powered treemap layout engine.
 * Returns a d3 hierarchy root with positioned leaves.
 * Consumers call root.leaves() for cells, root.children for sector groups.
 */
import { useMemo } from 'react'
import { treemap, hierarchy, treemapSquarify } from 'd3-hierarchy'

export function useTreemapLayout(tokens, width, height, { groupByField = null } = {}) {
  return useMemo(() => {
    if (!tokens?.length || !width || !height) return null

    // Dampen market cap so BTC doesn't dominate the entire map
    const dampen = v => Math.pow(Math.max(v, 1), 0.6)

    let rootData

    if (groupByField) {
      // Two-level hierarchy: group tokens by sector/category
      const groups = {}
      tokens.forEach(t => {
        const group = t[groupByField] || 'Other'
        if (!groups[group]) groups[group] = []
        groups[group].push(t)
      })
      rootData = {
        name: 'root',
        children: Object.entries(groups).map(([name, children]) => ({
          name,
          children: children.map(t => ({
            name: t.symbol,
            value: dampen(t.marketCap || 1),
            token: t,
          })),
        })),
      }
    } else {
      // Flat: single-level treemap (crypto)
      rootData = {
        name: 'root',
        children: tokens.map(t => ({
          name: t.symbol,
          value: dampen(t.marketCap || 1),
          token: t,
        })),
      }
    }

    const root = hierarchy(rootData)
      .sum(d => d.value)
      .sort((a, b) => b.value - a.value)

    treemap()
      .size([width, height])
      .tile(treemapSquarify.ratio(1))
      .padding(groupByField ? 2 : 1)
      .paddingTop(groupByField ? 24 : 1)
      .round(true)(root)

    return root
  }, [tokens, width, height, groupByField])
}
