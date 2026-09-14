#!/usr/bin/env node
/**
 * PostToolUse hook for Write|Edit.
 * Dev/prod parity guard: when a dev-only Express file under packages/server/
 * is edited, remind that prod runs on Vercel serverless (apps/research/api/*)
 * via vercel.json rewrites - a route added to Express with no serverless
 * mirror silently 404s / degrades on app.spectreai.io.
 *
 * This is the team's #1 recurring bug (see .claude/rules/api-patterns.md
 * section C and the notes about Sunny's PRs). The hook only nudges - it does
 * not block. Output goes back to the model as additionalContext.
 *
 * Reads hook JSON from stdin. Fires only for edits to server route/handler
 * code, not for content JSON, tests, or docs.
 */
const fs = require('fs')

let raw = ''
try {
  raw = fs.readFileSync(0, 'utf8')
} catch {
  process.exit(0)
}

let data
try {
  data = JSON.parse(raw || '{}')
} catch {
  process.exit(0)
}

const file =
  data?.tool_input?.file_path ||
  data?.tool_response?.filePath ||
  ''

// Only care about dev Express server CODE (routes, index, lib), not content/tests.
const isServerCode =
  /packages\/server\/(index\.js|routes\/[^/]+\.js|lib\/[^/]+\.js)$/.test(file)

if (!isServerCode) process.exit(0)

const rel = file.replace(/^.*\/spectre-app\//, '')

const reminder =
  `DEV/PROD PARITY CHECK: you edited a dev-only Express file (${rel}). ` +
  `Prod (app.spectreai.io) does NOT run this Express server - it runs Vercel ` +
  `serverless functions in apps/research/api/*, routed via apps/research/vercel.json ` +
  `rewrites. If you added or changed a route/handler, confirm the matching serverless ` +
  `handler + vercel.json rewrite exist and behave the same (cache headers, ?fields/limit ` +
  `projection, response shape). A route that works in dev but has no serverless mirror ` +
  `silently breaks in production. See .claude/rules/api-patterns.md section C.`

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: reminder,
    },
    suppressOutput: true,
  })
)
process.exit(0)
