// i18n — the whole bot in the top-20 languages at ~zero cost.
//
// Two layers:
//  1. STATIC catalog (panel buttons, card labels, hints): translated ONCE per
//     language by a single 70b pass, persisted to data/i18n/<lang>.json —
//     after that every lookup is a free dictionary hit, forever.
//  2. DYNAMIC content (composed cards, headlines, reads): translated on the
//     8b model with a content-hash cache — one call per unique card per
//     language no matter how many chats receive it. HTML/number-safe: if the
//     translation mangles the markup, the English original ships instead.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PACK_DIR = path.resolve(__dirname, '../data/i18n')
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const KEY = () => (process.env.GROQ_API_KEY || '').trim()

// top-20 by crypto relevance; code → native label (shown in the picker)
const LANGS = {
  en: 'English',
  zh: '中文',
  es: 'Español',
  hi: 'हिन्दी',
  ar: 'العربية',
  pt: 'Português',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  ko: '한국어',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
  th: 'ไทย',
  it: 'Italiano',
  pl: 'Polski',
  nl: 'Nederlands',
  uk: 'Українська',
  fa: 'فارسی',
}

// English source catalog — every static word the bot renders.
// {vars} survive translation verbatim.
const CATALOG = {
  'buy.newBuy': 'New Buy!',
  'buy.whaleAlert': 'Whale Alert!',
  'buy.netValue': 'Wallet Worth',
  'buy.buyer': 'Buyer',
  'buy.txn': 'Txn',
  'buy.newHolder': 'New Holder',
  'buy.position': 'Position',
  'buy.mc': 'MC',
  'btn.buy': 'Buy',
  'btn.chart': 'Chart',
  'btn.trade': 'Trade',
  'btn.scan': 'Scan',
  'btn.read': 'Read',
  'btn.research': 'Research',
  'panel.title': 'Buy Bot',
  'panel.minBuy': 'Min buy',
  'panel.whaleAlert': 'Whale alert',
  'panel.walletGte': 'wallet ≥',
  'panel.off': 'off',
  'panel.emojiScale': 'Emoji scale',
  'panel.emojiPer': '1 per ${usd} bought',
  'panel.rowEmoji': 'Row emoji',
  'panel.bySize': 'by size',
  'panel.media': 'Media',
  'panel.mediaCustom': 'custom upload',
  'panel.mediaDefault': 'Spectre default',
  'panel.chains': 'Chains',
  'panel.language': 'Language',
  'panel.status': 'Status',
  'panel.statusOn': 'ON — watching every buy',
  'panel.statusOff': 'OFF',
  'panel.note': 'Cards land ~15–35s after the block. Pools auto-tracked from DexScreener; new pools picked up within 10 minutes.',
  'panel.btnPause': 'Pause',
  'panel.btnResume': 'Resume',
  'panel.btnTest': 'Test post',
  'panel.btnRemove': 'Remove',
  'panel.btnChain': 'Chain',
  'panel.removed': 'Buy bot removed from this chat. /buybot to set up again.',
  'prompt.emoji': 'Reply to this message with the emoji for buy rows — or "default" for size tiers (🟢/🔥).',
  'prompt.media': 'Reply to this message with the GIF / video / image for your buy cards — or "default" for the Spectre animation.',
  'prompt.leg': 'Reply to this message with the OTHER chain\'s contract address (EVM 0x… or Solana) — or "default" to clear extra chains.',
  'msg.emojiSet': 'Buy rows now use {emoji} in this chat.',
  'msg.emojiReset': 'Emoji reset to the size-tier default (🟢/🔥).',
  'msg.mediaSaved': 'Saved — buy cards in this chat now use your media.',
  'msg.mediaReset': 'Media reset to the Spectre default animation.',
  'foot.brand': 'Spectre Intelligence',
  'foot.buyBot': 'Buy Bot',
  'foot.test': 'TEST',
  'lang.pick': 'Pick the language for this chat — cards, panels and reads will ship in it.',
  'lang.set': 'Language set — this chat now runs in {lang}.',
  'lang.building': 'Preparing the {lang} pack — a few seconds…',
}

const packs = { en: CATALOG } // lang → dict
const building = new Set()

function loadPack(lang) {
  if (packs[lang]) return packs[lang]
  try {
    const p = JSON.parse(fs.readFileSync(path.join(PACK_DIR, `${lang}.json`), 'utf8'))
    packs[lang] = { ...CATALOG, ...p } // en fallback for keys added later
    return packs[lang]
  } catch {
    return null
  }
}

async function groq(model, system, user, maxTokens) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(60e3),
  }).catch(() => null)
  const j = res?.ok ? await res.json().catch(() => null) : null
  return j?.choices?.[0]?.message?.content || null
}

// one-time pack build per language — 70b for quality, persisted forever
async function ensureLang(lang) {
  if (!LANGS[lang] || lang === 'en') return packs.en
  const loaded = loadPack(lang)
  if (loaded) return loaded
  if (building.has(lang) || !KEY()) return null
  building.add(lang)
  try {
    const out = await groq(
      'llama-3.3-70b-versatile',
      `Translate the VALUES of this JSON dictionary into ${LANGS[lang]} (${lang}). It is UI copy for a crypto trading Telegram bot — use the natural, native register crypto traders use. Keep {placeholders}, $ signs, emoji, slash-commands and quoted "default" EXACTLY as-is. Keep it as concise as the English. Return ONLY the JSON object, same keys.`,
      JSON.stringify(CATALOG),
      4000,
    )
    const dict = JSON.parse(String(out).replace(/^[^{]*/, '').replace(/[^}]*$/, ''))
    if (!dict || typeof dict !== 'object') throw new Error('bad pack')
    fs.mkdirSync(PACK_DIR, { recursive: true })
    fs.writeFileSync(path.join(PACK_DIR, `${lang}.json`), JSON.stringify(dict, null, 1))
    packs[lang] = { ...CATALOG, ...dict }
    console.log(`[i18n] built pack: ${lang} (${Object.keys(dict).length} strings)`)
    return packs[lang]
  } catch (e) {
    console.error('[i18n] pack build failed:', lang, e.message)
    return null
  } finally {
    building.delete(lang)
  }
}

function t(lang, key, vars) {
  const dict = (lang && lang !== 'en' && (packs[lang] || loadPack(lang))) || CATALOG
  let out = dict[key] ?? CATALOG[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v))
  return out
}

// dynamic card translation — hash-cached, HTML-safe, 8b
const dynCache = new Map() // hash:lang → text
async function translateCard(lang, html, cacheKey) {
  if (!lang || lang === 'en' || !LANGS[lang] || !KEY()) return html
  // content hash rides along even with an explicit cacheKey — a re-finalized
  // card under a reused id must not serve the stale translation
  const hash = crypto.createHash('sha1').update(html).digest('hex').slice(0, 16)
  const key = `${cacheKey ? `${cacheKey}:${hash.slice(0, 8)}` : hash}:${lang}`
  const hit = dynCache.get(key)
  if (hit) return hit
  const out = await groq(
    'llama-3.1-8b-instant',
    `Translate this Telegram HTML message into ${LANGS[lang]}. PRESERVE EXACTLY: every HTML tag and attribute, all numbers, $ amounts, percentages, $TICKER cashtags, @handles, URLs, emoji and line breaks. Translate only the human words. Return ONLY the translated message, nothing else.`,
    html,
    1200,
  )
  // strict HTML safety: Telegram fails the WHOLE send on any malformed entity,
  // and the plain-text fallback reuses this string — so the translation must
  // carry the EXACT tag sequence of the source (an unclosed <b>, an invented
  // <em>, a dropped close all slip past a mere '<'-count check)
  const tagSeq = (s) => (s.match(/<[^<>]*>/g) || []).join('')
  const ok =
    out &&
    tagSeq(out) === tagSeq(html) &&
    !out.replace(/<[^<>]*>/g, '').includes('<') &&
    out.length < html.length * 2.5
  const finalText = ok ? out.trim() : html // markup mangled → ship English
  dynCache.set(key, finalText)
  if (dynCache.size > 600) dynCache.delete(dynCache.keys().next().value)
  return finalText
}

module.exports = { LANGS, t, ensureLang, translateCard }
