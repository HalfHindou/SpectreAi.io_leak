'use strict';

/**
 * alert-quality — is this text actually an ALERT?
 * ─────────────────────────────────────────────────────────────────────────
 * 2026-08-17. Written after the AI Brief alerts slide rendered:
 *
 *     "Bitcoin fixes this (it isn't made of cheese)."
 *
 * on the Command Center, under the header SPECTRE AI INTELLIGENCE BRIEF -
 * ALERTS. It is a joke. It states no event, carries no number, and tells a
 * trader nothing — and it reached the screen because the only check on the
 * LLM's output was `text.length > 20`.
 *
 * The client-side market gate did not stop it either: that gate asks whether
 * the text NAMES a market thing, and "Bitcoin" is a market thing. Naming an
 * asset is necessary for an alert and nowhere near sufficient.
 *
 * WHY THIS IS CODE AND NOT MORE PROMPT. The system prompt already says "use
 * actual numbers from the data, never vague" and "sound like a Bloomberg
 * terminal flash". The model ignored both. A prompt constraint is a REQUEST;
 * the same lesson was paid for on /why in August, where a banned field kept
 * appearing hours after the ban and only a code-side validator stopped it. So
 * the rule is enforced here, and a failing synthesis is DISCARDED in favour of
 * the deterministic template that was already in the route.
 *
 * The bar, deliberately low but absolute: an alert must say WHAT happened and
 * anchor it to something measurable. Anything that cannot clear that is not a
 * worse alert, it is not an alert.
 */

/** A concrete anchor: a price, a percentage, a size, a date, a level. */
const HAS_NUMBER_RE = /\d/;

/** The thing the alert is about. */
const ASSET_RE = /\b(?:bitcoin|btc|ethereum|eth|solana|sol|xrp|bnb|doge(?:coin)?|cardano|ada|avalanche|avax|chainlink|link|polkadot|dot|litecoin|ltc|tron|trx|sui|hyperliquid|hype|crypto(?:currenc\w*)?|altcoins?|stablecoins?|memecoins?|defi|binance|coinbase|kraken|okx|bybit|tether|usdt|usdc|nasdaq|s&p|sp500|spx|spy|qqq|dow|russell|treasur\w*|equit\w*|stocks?|etfs?|bonds?|gold|silver|crude|brent|oil|forex|dxy|dollar|yen|euro|vix)\b/i;

/** Something that HAPPENED or is happening. */
const EVENT_RE = /\b(?:rall(?:y|ies|ied)|surg\w*|plung\w*|crash\w*|dump\w*|pump\w*|sell-?offs?|liquidat\w*|all-?time[- ]high|ath|record[- ]high|breakout\w*|correction\w*|tumbl\w*|soar\w*|spik\w*|slump\w*|sink\w*|jump\w*|drop\w*|fell|fall\w*|ris\w*|rose|climb\w*|slid\w*|gain\w*|los(?:e|es|t|ing)|bull\w*|bear\w*|volatil\w*|sec|cftc|lawsuit\w*|sue[sd]?|regulat\w*|approv\w*|reject\w*|listing\w*|delist\w*|halving|hack\w*|exploit\w*|breach\w*|drain\w*|outflow\w*|inflow\w*|buyback\w*|acquisition\w*|acquir\w*|merger\w*|ipo|earnings|fed|fomc|rate[- ](?:cut|hike)s?|interest rates?|cpi|ppi|inflation|gdp|payrolls?|unemployment|tariffs?|yields?|futures|options|funding|valuation\w*|market ?cap|whal\w*|short squeeze|liquidity|holds?|breaks?|tests?|reclaim\w*|defend\w*|support|resistance|risk-?(?:on|off)|rotat\w*)\b/i;

/**
 * Shapes an alert is never allowed to take. Each of these was reachable from
 * the current prompt, and the first one is what actually shipped.
 */
const DISQUALIFIERS = [
  { id: 'meme_slogan', re: /\b(?:fixes this|to the moon|wen |ngmi|wagmi|gm\b|number go up|have fun staying poor|few understand|this is (?:fine|the way))\b/i },
  { id: 'joke_aside', re: /\((?:it|that|which)\s+(?:isn't|is not|ain't|wasn't)\b[^)]*\)/i },
  { id: 'rhetorical_question', re: /\?\s*$/ },
  { id: 'first_person', re: /\b(?:I|we|our team|let's|folks|guys)\b/ },
  { id: 'emoji', re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u },
  { id: 'hedge_nonsense', re: /\b(?:who knows|anyone's guess|time will tell|only time|lol|haha)\b/i },
  // A tweet wearing a headline's clothes. The x_vip lane files rows titled
  // `@WSJ (@WSJ): "..."` and `@USTreasury (@USTreasury): "RT @SBA_Kelly: ..."`;
  // they are posts, and when the story is real it reaches us again from the
  // wire with an actual headline on it.
  { id: 'social_post', re: /^\s*@\w+|\(@\w+\)\s*:|\bRT\s+@\w+/i },
];

/**
 * @returns {{ok: true} | {ok: false, reason: string, detail: string}}
 */
function checkAlert(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length < 25) {
    return { ok: false, reason: 'too_short', detail: `${t.length} chars; an alert that short is a headline fragment, not a flash.` };
  }
  for (const d of DISQUALIFIERS) {
    if (d.re.test(t)) {
      return { ok: false, reason: d.id, detail: `Matched the ${d.id} pattern. An alert slot is not a place for a joke, an aside or an opinion.` };
    }
  }
  if (!ASSET_RE.test(t)) {
    return { ok: false, reason: 'no_asset', detail: 'Names no market asset, venue or index, so a reader cannot tell what it is about.' };
  }
  if (!EVENT_RE.test(t)) {
    return { ok: false, reason: 'no_event', detail: 'Describes nothing that happened — an alert must state an event, not a sentiment.' };
  }
  if (!HAS_NUMBER_RE.test(t)) {
    // The system prompt already demands actual numbers. This is that demand,
    // enforced rather than requested.
    return { ok: false, reason: 'no_number', detail: 'Carries no figure. The prompt asks for real numbers precisely so the alert is checkable; without one it is a vibe.' };
  }
  return { ok: true };
}

/** Convenience for call sites that only branch. */
const isUsableAlert = (text) => checkAlert(text).ok;

/**
 * The same question asked of a REAL EDITORIAL HEADLINE rather than of text a
 * model wrote. Kept in sync with checkHeadline in
 * apps/research/src/lib/alertQuality.js — the reasoning lives there.
 *
 * Short version: the asset/event/figure demands above exist to stop a model
 * padding. Pointed at a subeditor's headline they reject the news — 13 of 14
 * real wire headlines on 2026-08-17, "U.S. Treasury Department proposes GENIUS
 * Act stablecoin rule" among them. A headline is already the story compressed
 * to one line. Only the DISQUALIFIERS carry over, because a joke or an emoji
 * is not a headline whoever wrote it.
 */
function checkHeadline(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length < 20) {
    return { ok: false, reason: 'too_short', detail: `${t.length} chars — a fragment, not a headline.` };
  }
  for (const d of DISQUALIFIERS) {
    if (d.re.test(t)) {
      return { ok: false, reason: d.id, detail: `Matched the ${d.id} pattern — that is a post, not a headline.` };
    }
  }
  return { ok: true };
}

const isUsableHeadline = (text) => checkHeadline(text).ok;

// ─── The fast lane: monitored VIP accounts, big events only ────────────────
// The breaking_events monitor lane carries VIP X accounts and reaches us
// within seconds — far ahead of the outlets, which is why the Telegram bot
// runs its Breaking channel off it. What it does NOT do is judge: the box
// scores EVERY post from a monitored account 80-90 and stamps it
// severity:breaking, so a marketing tweet arrives labelled exactly like a
// central-bank decision. That is the whole provenance of the joke this file
// was written for — it came in at score 85 from a monitored exchange account.
//
// The Telegram bot already solved this, and the rule below is its rule:
// spectre-tg-bot/src/subscriptions.js `breakingWorthy()` + `stripWireLabel()`,
// plus the event vocabulary in src/macro-alert.js `EVENT_GROUPS`. Strip the
// branding, then require the remaining sentence to describe something that
// HAPPENED. If it does not name an event, it is not breaking, whoever posted
// it and whatever the score says.
//
// KEEP IN SYNC with that file. It is a separate deploy on the box so we cannot
// import it; when its vocabulary grows, grow this.

/** Handle wrapper the monitor lane wraps every post in: `@WSJ (@WSJ): "…"`. */
const SOCIAL_WRAPPER_RE = /^\s*@?[A-Za-z0-9_]+\s*\(@[A-Za-z0-9_]+\)\s*:\s*/
/** A wire's house prefix describes its style, not the event. */
const WIRE_LABEL_RE = /^\s*(?:🚨|⚡️?|❗️?|📢|🔴)*\s*(?:just\s*in|breaking(?:\s*news)?|urgent|alert|update|developing|news)\s*[:\-–—]+\s*/i

/**
 * Present the EVENT, never the byline. Removes the posting handle, the wire's
 * house prefix and the quote marks the wrapper leaves behind, so what reaches
 * the screen is the news itself rather than somebody else's masthead.
 */
function stripSourceBranding(text) {
  let t = String(text || '').trim()
  t = t.replace(SOCIAL_WRAPPER_RE, '').trim()
  // Unwrap BEFORE peeling labels: the wrapper leaves the post inside quotes and
  // the house prefix lives inside them (`@X (@X): "JUST IN: ..."`), so peeling
  // first finds a quote character where it expects the label and gives up.
  const m = t.match(/^["“”'']([\s\S]+)["“”'']$/)
  if (m) t = m[1].trim()
  // Channels stack their labels ("🚨 BREAKING: JUST IN: …") — peel a few.
  for (let i = 0; i < 3 && WIRE_LABEL_RE.test(t); i++) t = t.replace(WIRE_LABEL_RE, '').trim()
  return t.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Things that HAPPENED — no adjectives, no severity words. Ported from the
 * Telegram bot's EVENT_GROUPS (systemic / policy / prints / trade / energy /
 * conflict) and CRYPTO_HARD_RX.
 */
const HARD_EVENT_RE = new RegExp([
  // systemic
  '\\bdefault(?:s|ed)\\b', 'downgrade[sd]?', 'halts? trading', 'trading halted', 'circuit breaker',
  'bank (?:fails?|failed|collapse[sd]?)', 'bailout', 'nationaliz',
  '(?:market|index|kospi|nikkei|hang seng|dax|ftse|stocks?) (?:crash(?:es|ed)?|halted|plunge[sd]?)',
  'crash(?:es|ed)? (?:over|by )?\\d', 'halted after', 'flash crash',
  // policy
  '(?:cuts?|hikes?|raises?|lowers?|holds?) (?:the )?(?:rates?|interest rates?|benchmark)',
  'rate (?:cut|hike|decision)', 'emergency (?:meeting|cut|rate|session)', 'basis points?', '\\bbps\\b',
  // prints
  'cpi (?:comes? in|rose|rises?|fell|falls?|jumps?|surges?|cools?|hits?|at)',
  'inflation (?:jumps?|surges?|cools?|hits?|accelerat|slows?|comes? in|rose|fell)',
  '(?:payrolls?|jobs report|nonfarm) (?:rise|rose|fall|fell|miss(?:es|ed)?|beat|came|shows?|adds?)',
  '\\bgdp (?:contract|shrank|grew|rose|fell|misses|beats)',
  // trade
  'imposes? (?:new )?(?:tariffs?|sanctions?|duties)', 'tariffs? (?:on|imposed|raised|doubled|hiked|take effect)',
  'slaps? tariffs?', 'export ban', 'embargo', 'sanctions? (?:imposed|announced|take effect)',
  // energy
  'opec\\+? (?:cuts?|agrees|raises?|boosts?)', 'production cut', 'supply (?:cut|shock|disruption)',
  'closes? (?:the )?strait', '\\bhormuz\\b',
  '(?:refiner|pipeline|oil (?:depot|terminal|field)|tanker)[^.]{0,30}(?:fire|explosion|blast|attack|struck|hit|halt)',
  // conflict
  'air\\s?strikes?', '\\bstruck\\b', 'bomb(?:ed|ing|s)\\b', 'missiles?\\b', 'invad(?:e|es|ed|ing)\\b',
  'invasion', 'declares? war', 'ceasefire', 'blockad', 'shot down', 'state of emergency', 'martial law',
  // crypto-native
  'hack(?:ed|s)?', 'exploit(?:ed|s)?', 'drain(?:ed|s)?', 'freez(?:e|es|ed)', 'suspend(?:s|ed)?',
  'approv(?:es|ed|al)', 'reject(?:s|ed)', 'sues?', 'sued', 'charg(?:es|ed)', 'indict', 'bankrupt',
  'insolven', 'delist(?:s|ed|ing)?', 'depeg(?:s|ged)?', 'breach(?:es|ed)?', 'stolen',
  'seiz(?:e|es|ed)', 'files? for', 'goes? live', 'mainnet', 'hard fork', 'outage',
].join('|'), 'i')

/**
 * Is a monitor-lane row big enough to interrupt someone? Returns the branding-
 * free text when yes.
 *
 * @returns {{ok: true, text: string} | {ok: false, reason: string}}
 */
function checkBreaking(rawText) {
  const text = stripSourceBranding(rawText)
  const base = checkHeadline(text)
  if (!base.ok) return { ok: false, reason: base.reason }
  // The lane stores posts at the length the platform gave it, so a long one
  // arrives cut off mid-sentence. Half a sentence is not an alert, and the
  // ellipsis is the tell.
  if (/(?:…|\.\.\.)\s*["“”'']?\s*$/.test(text)) {
    return { ok: false, reason: 'truncated' }
  }
  if (!HARD_EVENT_RE.test(text)) {
    return { ok: false, reason: 'not_an_event' }
  }
  return { ok: true, text }
}

module.exports = { checkAlert, isUsableAlert, checkHeadline, isUsableHeadline, checkBreaking, stripSourceBranding, HARD_EVENT_RE, DISQUALIFIERS, ASSET_RE, EVENT_RE };
