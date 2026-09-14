/**
 * project-intel — the crawled-intelligence lane for the RZ Project tab.
 *
 * One call returns the two things a project page cannot honestly live without
 * (founder call 2026-08-25: "project tab should crawl the websites and get
 * info and check x"):
 *   siteIntel — what the project's OWN site/docs say (project-crawl.js:
 *               what it does, stage, shipping evidence, backers, traction,
 *               build signal, the site's own X/TG/Discord links). KV-cached 24h.
 *   teamTape  — the project's OWN X timeline (team-tape.js: posting cadence +
 *               sample posts, or { unavailable } when the transport is down —
 *               unknown, never "silent").
 *
 * Shared by the prod serverless dossier-proxy handler and the dev Express
 * mirror (dynamic-imported there), so the two twins cannot drift on this lane.
 * Never throws; each half degrades to null independently under its own budget.
 */
import { crawlProject } from './project-crawl.js'
import { fetchTeamTape } from './team-tape.js'

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms, null))])

// Accepts a bare handle or any x.com/twitter.com URL; returns the handle or null.
export function parseXHandle(v) {
  if (!v) return null
  const s = String(v).trim()
  const m = s.match(/(?:twitter|x)\.com\/(?:@|#!\/)?([A-Za-z0-9_]{2,15})/i)
  if (m) return /^(intent|share|home|search|hashtag|i)$/i.test(m[1]) ? null : m[1]
  return /^@?[A-Za-z0-9_]{2,15}$/.test(s) ? s.replace(/^@/, '') : null
}

function crawlId(cgId, website) {
  if (cgId) return cgId
  try {
    return website ? `site:${new URL(website).hostname.replace(/^www\./, '')}` : null
  } catch {
    return null
  }
}

export async function fetchProjectIntel({ cgId, website, docs, xHandle }) {
  const id = crawlId(cgId, website)
  const handle = parseXHandle(xHandle)
  const [siteIntel, teamTape] = await Promise.all([
    id && (website || docs)
      ? withTimeout(crawlProject({ cgId: id, website: website || null, docs: docs || null }).catch(() => null), 14_000)
      : Promise.resolve(null),
    handle
      ? withTimeout(fetchTeamTape(handle).catch(() => null), 10_000)
      : Promise.resolve(null),
  ])
  return { siteIntel, teamTape }
}
