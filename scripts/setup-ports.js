#!/usr/bin/env node
/**
 * Auto-detect available port slot and write .claude/launch.json
 *
 * Checks which port slots (A/B/C/D/E) are free, picks the first
 * available one, and writes launch.json so dev servers don't conflict
 * across parallel worktrees.
 *
 * Usage: node scripts/setup-ports.js
 */

const net = require('net')
const fs = require('fs')
const path = require('path')

const SLOTS = [
  { name: 'A', research: 5180, trading: 5181, server: 3001 },
  { name: 'B', research: 5182, trading: 5183, server: 3002 },
  { name: 'C', research: 5184, trading: 5185, server: 3003 },
  { name: 'D', research: 5186, trading: 5187, server: 3004 },
  { name: 'E', research: 5188, trading: 5189, server: 3005 },
]

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true)) // port is free
    })
    server.on('error', () => resolve(false)) // port is in use
  })
}

async function findFreeSlot() {
  for (const slot of SLOTS) {
    const [r, t, s] = await Promise.all([
      checkPort(slot.research),
      checkPort(slot.trading),
      checkPort(slot.server),
    ])
    if (r && t && s) return slot
  }
  return null
}

async function main() {
  const launchPath = path.resolve(__dirname, '..', '.claude', 'launch.json')

  // Check if launch.json already has non-default ports (user manually configured)
  try {
    const existing = JSON.parse(fs.readFileSync(launchPath, 'utf8'))
    const serverConfig = existing.configurations.find(c => c.name === 'server')
    const currentPort = serverConfig?.port || 3001

    // Check if current port is still free — if so, keep it
    const isFree = await checkPort(currentPort)
    if (isFree) {
      console.log(`[setup-ports] Current slot (server:${currentPort}) is available — keeping it`)
      return
    }
    console.log(`[setup-ports] Port ${currentPort} is in use — finding a free slot...`)
  } catch {
    // No launch.json yet, will create one
  }

  const slot = await findFreeSlot()
  if (!slot) {
    console.error('[setup-ports] ERROR: All port slots (A-E) are in use!')
    console.error('[setup-ports] Stop some servers or add more slots in scripts/setup-ports.js')
    process.exit(1)
  }

  const launch = {
    version: '0.0.1',
    configurations: [
      {
        name: 'research',
        runtimeExecutable: 'node',
        runtimeArgs: [
          'node_modules/vite/bin/vite.js',
          '--config', 'apps/research/vite.config.js',
          '--host', '--port', String(slot.research),
        ],
        port: slot.research,
      },
      {
        name: 'trading',
        runtimeExecutable: 'node',
        runtimeArgs: [
          'node_modules/vite/bin/vite.js',
          '--config', 'apps/trading/vite.config.js',
          '--host', '--port', String(slot.trading),
        ],
        port: slot.trading,
      },
      {
        name: 'server',
        runtimeExecutable: 'node',
        runtimeArgs: [
          '-e',
          `process.env.PORT='${slot.server}';require('./packages/server/index.js')`,
        ],
        port: slot.server,
      },
    ],
  }

  // Ensure .claude directory exists
  const claudeDir = path.dirname(launchPath)
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true })
  }

  fs.writeFileSync(launchPath, JSON.stringify(launch, null, 2) + '\n')
  console.log(`[setup-ports] Assigned slot ${slot.name}: research=${slot.research} trading=${slot.trading} server=${slot.server}`)
}

main().catch(err => {
  console.error('[setup-ports] Fatal:', err)
  process.exit(1)
})
