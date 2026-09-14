// One-off: DM Sunny SAMPLE cards for the 2026-07-16 round — new banner art,
// majors-watch card, compact one-liner view. Read-only (no store writes).
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const fs = require('fs')
const path = require('path')
const { Bot, InputFile, InlineKeyboard } = require('grammy')

const ADMIN = 1748682230
const bot = new Bot(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN)
const art = (n) => new InputFile(fs.readFileSync(path.resolve(__dirname, `../assets/signal-banners/${n}.png`)), `${n}.png`)

async function main() {
  // 1 — new banner art on a breaking card
  await bot.api.sendPhoto(ADMIN, art('breaking'), {
    caption: [
      '🧪 <b>SAMPLE — new banner art (category cards)</b>',
      '',
      '⚡️ <b>BREAKING</b>',
      '<b>Unemployment Rate: 3.8 (as expected)</b>',
      '',
      '<i>⌁ Spectre Intelligence · Newswire</i>',
    ].join('\n'),
    parse_mode: 'HTML',
  })
  // 2 — majors watch, the WatcherGuru lane (rides Market Pulse art)
  await bot.api.sendPhoto(ADMIN, art('pulse'), {
    caption: [
      '🧪 <b>SAMPLE — Majors Watch (BTC/ETH key levels &amp; big moves, LIVE now)</b>',
      '',
      '🚨 <b>BITCOIN CROSSES $120,000</b>',
      '▸ <b>Bitcoin</b> <code>$120,041</code> · 1h ▲+1.2% · 24h ▲+2.9%',
      '',
      '<blockquote>🧠 Bitcoin took out the $120,000 round number (+1.2% on the hour). Round levels are liquidity magnets — acceptance above turns them into support; a fast rejection is the trap.</blockquote>',
      '',
      '<i>⌁ Spectre Intelligence · Majors Watch</i>',
    ].join('\n'),
    parse_mode: 'HTML',
  })
  // 3 — compact one-liner view (per-chat toggle in /subscribe)
  await bot.api.sendMessage(ADMIN, [
    '🧪 <b>SAMPLE — ✍️ One-liner view</b> (toggle in /subscribe → "View"; buttons stay, banner and body go)',
    '',
    '⚡️ <b>BREAKING</b> · <b>Unemployment Rate: 3.8 (as expected)</b> <i>⌁</i>',
    '',
    '🛰 <b>DEGEN RUNNER</b> · <b>$BASED</b> — Based Guy · ⟠ Ethereum · <code>$20.9M</code> ▼ -1.4% <i>⌁</i>',
    '',
    '🚨 <b>BITCOIN CROSSES $120,000</b> <i>⌁</i>',
  ].join('\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
  // remaining art, one album so he sees every category in-chat
  await bot.api.sendMediaGroup(ADMIN, [
    { type: 'photo', media: art('runners'), caption: '🧪 SAMPLE — Degen Runner / AI Desk Call / Social Surge art', parse_mode: 'HTML' },
    { type: 'photo', media: art('brain') },
    { type: 'photo', media: art('social') },
  ])
  console.log('samples sent')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
