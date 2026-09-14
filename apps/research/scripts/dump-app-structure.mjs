#!/usr/bin/env node
/**
 * Dump Spectre Vibe app structure from App.jsx and NavigationSidebar.
 * Usage: node scripts/dump-app-structure.mjs [--out docs/app-structure.json]
 * Output: JSON to stdout or to file.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const appPath = path.join(root, 'src/App.jsx')
const navPath = path.join(root, 'src/components/NavigationSidebar.jsx')

const app = fs.readFileSync(appPath, 'utf8')
const nav = fs.readFileSync(navPath, 'utf8')

// Extract nav items: { id: '...', label: '...' }
const navItems = []
const navRe = /\{\s*id:\s*['"]([^'"]+)['"]\s*,\s*label:\s*['"]([^'"]+)['"]/g
let m
while ((m = navRe.exec(nav)) !== null) {
  navItems.push({ id: m[1], label: m[2] })
}

// Known routes from App.jsx (currentPage / currentView)
const routes = [
  { pageId: 'research-zone', component: 'ResearchZoneLite', type: 'full-page' },
  { pageId: 'structure-guide', component: 'StructureGuidePage', type: 'full-page' },
  { pageId: 'social-zone', component: 'SocialZonePage', type: 'full-page' },
  { pageId: 'x-bubbles', component: 'XBubblesPage', type: 'full-page' },
  { pageId: 'search-engine', component: '(inline)', type: 'full-page' },
  { pageId: 'watchlists', component: 'WatchlistsPage', type: 'full-page' },
  { view: 'welcome', component: 'WelcomePage', type: 'view' },
  { view: 'token', component: 'LeftPanel | TokenBanner+TradingChart+DataTabs | RightPanel', type: 'view' },
]

const implemented = new Set([
  'research-platform', 'research-zone', 'search-engine', 'ai-screener', 'watchlists',
  'social-zone', 'x-bubbles', 'structure-guide',
])

const out = {
  generatedAt: new Date().toISOString(),
  app: 'Spectre Vibe',
  navItems: navItems.map(({ id, label }) => ({
    id,
    label,
    implemented: implemented.has(id),
  })),
  routes,
  views: ['welcome', 'token'],
  note: 'Full reference: docs/APP_STRUCTURE.md. Use PROMPT_APP_STRUCTURE_AUTOMATION.md for AI workflow.',
}

const json = JSON.stringify(out, null, 2)
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null

if (outFile) {
  fs.writeFileSync(path.resolve(root, outFile), json + '\n', 'utf8')
  console.error(`Wrote ${outFile}`)
} else {
  console.log(json)
}
