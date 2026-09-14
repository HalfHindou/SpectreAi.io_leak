// One-shot: apply the Spectre brand profile to whatever bot TELEGRAM_BOT_TOKEN points at.
// Run after creating/swapping a bot: node scripts/apply-profile.js
const { BOT_TOKEN } = require('../src/config')

const NAME = 'Spectre AI Intelligence'
const SHORT = 'The market brain of app.spectreai.io — charts, scans, signals, X-Dash.'
const DESCRIPTION = [
  'Spectre AI Intelligence — crypto market intelligence in your chat.',
  '',
  '📈 /c btc — pro charts, tap to switch timeframes',
  '🔎 /x sol — full scan: price · 𝕏 social · TA',
  '🧠 /desk — Spectre Brain desk read',
  '𝕏 /xd — attention leaderboard · /kol — who’s talking',
  '🔔 /alert btc >70k — price alerts',
  '',
  'Powered by app.spectreai.io',
].join('\n')

async function call(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const json = await res.json()
  console.log(method, json.ok ? 'OK' : `FAILED: ${json.description}`)
  return json
}

async function main() {
  const me = await call('getMe', {})
  console.log('target bot: @' + me.result.username)
  await call('setMyName', { name: NAME })
  await call('setMyShortDescription', { short_description: SHORT })
  await call('setMyDescription', { description: DESCRIPTION })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
