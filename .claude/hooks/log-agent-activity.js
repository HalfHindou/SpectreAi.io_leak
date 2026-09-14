#!/usr/bin/env node
/**
 * PostToolUse hook for Agent tool.
 * Logs agent activity to .claude/agent-memory/activity-log.json
 * when an agent completes work.
 *
 * Reads tool_input from stdin (JSON with tool_name, tool_input, tool_output).
 * Only fires for the Agent tool.
 */
const fs = require('fs')
const path = require('path')

const LOG_PATH = path.join(__dirname, '..', 'agent-memory', 'activity-log.json')
const MAX_ENTRIES = 200

function readLog() {
  try {
    if (fs.existsSync(LOG_PATH)) {
      return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'))
    }
  } catch {}
  return { description: 'Agent team activity log', entries: [] }
}

function writeLog(data) {
  const dir = path.dirname(LOG_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(LOG_PATH, JSON.stringify(data, null, 2))
}

// Map subagent_type or description to agent roster key
function resolveAgent(input) {
  const type = (input.subagent_type || '').toLowerCase()
  const desc = (input.description || '').toLowerCase()
  const prompt = (input.prompt || '').toLowerCase()

  // Direct subagent_type matches
  const typeMap = {
    'backy': 'backend-api',
    'blocky': 'blockchain-dev',
    'exty': 'chrome-ext',
    'audy': 'code-reviewer',
    'frontyr': 'research-frontend',
    'frontyt': 'trading-frontend',
    'arty': 'ui-library',
    'vercy': 'vercel-deploy',
  }
  if (typeMap[type]) return typeMap[type]

  // Pattern-based inference from description/prompt
  const patterns = [
    { agent: 'backend-api', keywords: ['server', 'express', 'api route', 'backend', 'endpoint'] },
    { agent: 'research-frontend', keywords: ['research app', 'research page', 'research component', 'welcome page'] },
    { agent: 'trading-frontend', keywords: ['trading app', 'trading component', 'trading page', 'chart'] },
    { agent: 'blockchain-dev', keywords: ['wallet', 'swap', 'solana', 'blockchain', 'privy', 'token transfer'] },
    { agent: 'chrome-ext', keywords: ['extension', 'chrome', 'popup', 'sidebar', 'content script'] },
    { agent: 'ui-library', keywords: ['spectre-ui', 'shared component', 'storybook', 'design system'] },
    { agent: 'vercel-deploy', keywords: ['deploy', 'vercel', 'serverless', 'production'] },
    { agent: 'code-reviewer', keywords: ['review', 'audit', 'security', 'quality'] },
  ]

  const text = `${desc} ${prompt}`
  for (const { agent, keywords } of patterns) {
    if (keywords.some(k => text.includes(k))) return agent
  }

  return null
}

async function main() {
  // Read hook input from stdin
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
  }

  let data
  try {
    data = JSON.parse(input)
  } catch {
    process.exit(0)
  }

  // Only process Agent tool completions
  if (data.tool_name !== 'Agent') process.exit(0)

  const toolInput = data.tool_input || {}
  const toolOutput = data.tool_output || ''

  const agent = resolveAgent(toolInput)
  if (!agent) process.exit(0)

  // Extract task description
  const task = toolInput.description || toolInput.prompt?.slice(0, 120) || 'Agent task'

  // Determine author from environment
  const author = process.env.USER || process.env.USERNAME || 'unknown'

  const log = readLog()
  log.entries.push({
    agent,
    task,
    status: 'completed',
    author,
    files: [],
    timestamp: new Date().toISOString(),
    source: 'hook',
  })

  // Trim to max
  if (log.entries.length > MAX_ENTRIES) {
    log.entries = log.entries.slice(-MAX_ENTRIES)
  }

  writeLog(log)

  // Output empty JSON so hook doesn't interfere
  process.stdout.write(JSON.stringify({}))
}

main().catch(() => process.exit(0))
