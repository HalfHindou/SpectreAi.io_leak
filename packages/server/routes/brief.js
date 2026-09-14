/**
 * Brief generation + voice/TTS routes.
 * Extracted from index.js for maintainability.
 */
const express = require('express')
const router = express.Router()
const fetch = require('node-fetch')
const { getHelpers } = require('./_helpers')

function h() { return getHelpers() }

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

// --- TTS provider functions ---

// ── ElevenLabs Voice Roster ─────────────────────────────────────────────────
// Premade voices that work on free-tier API keys (no library subscription needed)
const ELEVENLABS_VOICES = {
  sam:    { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam',    desc: 'Deep, raspy American — raw & authentic' },
  josh:   { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh',   desc: 'Deep, smooth American — confident narrator' },
  adam:   { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',   desc: 'Deep American — warm & authoritative' },
  clyde:  { id: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde',  desc: 'Deep, gravelly American — rugged character' },
  daniel: { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', desc: 'Deep British — polished intelligence analyst' },
};
// Default voice — Sam: closest to "Austin — Deep, Raspy and Authentic"
const ELEVENLABS_DEFAULT_VOICE = 'sam';

async function elevenLabsTTS(text, voiceKey, lang = 'en') {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVENLABS_API_KEY) return null;

  // Resolve voice: explicit key → env override → default
  let voice;
  if (voiceKey && ELEVENLABS_VOICES[voiceKey]) {
    voice = ELEVENLABS_VOICES[voiceKey];
  } else if (process.env.ELEVENLABS_VOICE_ID) {
    voice = { id: process.env.ELEVENLABS_VOICE_ID, name: 'custom', desc: 'env override' };
  } else {
    voice = ELEVENLABS_VOICES[ELEVENLABS_DEFAULT_VOICE];
  }

  // Use multilingual model for non-English languages, turbo for English
  const modelId = lang !== 'en' ? 'eleven_multilingual_v2' : 'eleven_turbo_v2_5';

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}/stream`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,           // Expressive, natural cadence
          similarity_boost: 0.8,    // Strong voice match
          style: 0.45,              // Authentic, conversational feel
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown');
      console.error(`ElevenLabs error ${response.status} (${voice.name}):`, errText);
      return null;
    }

    const chunks = [];
    for await (const chunk of response.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    console.log(`ElevenLabs TTS: ${buffer.length} bytes — voice: ${voice.name} (${voice.desc})`);
    return { buffer, contentType: 'audio/mpeg', source: 'elevenlabs', voice: voice.name };
  } catch (err) {
    console.error('ElevenLabs TTS error:', err.message);
    return null;
  }
}

// Edge TTS voice map by language code — deep, authoritative male voices
const EDGE_TTS_VOICES = {
  en: 'en-US-GuyNeural',
  fr: 'fr-FR-HenriNeural',
  es: 'es-ES-AlvaroNeural',
  zh: 'zh-CN-YunxiNeural',
  hi: 'hi-IN-MadhurNeural',
  ar: 'ar-SA-HamedNeural',
  ru: 'ru-RU-DmitryNeural',
  pt: 'pt-BR-AntonioNeural',
};

async function edgeTTS(text, voice = 'en-US-GuyNeural') {
  // Microsoft Edge TTS — free neural voices, no API key required
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);

  return new Promise((resolve, reject) => {
    const chunks = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (buffer.length < 100) {
        reject(new Error('Edge TTS returned empty audio'));
        return;
      }
      resolve({ buffer, contentType: 'audio/mpeg', source: 'edge-tts' });
    });
    audioStream.on('error', (e) => reject(e));

    // Safety timeout — 15 seconds
    setTimeout(() => reject(new Error('Edge TTS timeout')), 15000);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE AI BRIEF — Full market narrative (6th slide)
// ══════════════════════════════════════════════════════════════════════════════

const CACHE_TTL_BRIEF_GENERATE_MS = 5 * 60 * 1000; // 5 min
const briefGenerateCache = new Map();
_standaloneCaches.push({ map: briefGenerateCache, ttlField: 'expires', ttlMs: CACHE_TTL_BRIEF_GENERATE_MS });

// ── Spoken number helpers ──────────────────────────────────────────────────
const ONES = ['','one','two','three','four','five','six','seven','eight','nine',
  'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];

function spokenInteger(n) {
  if (n === 0) return 'zero';
  if (n < 0) return 'negative ' + spokenInteger(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n/10)] + (n%10 ? ' ' + ONES[n%10] : '');
  if (n < 1000) return ONES[Math.floor(n/100)] + ' hundred' + (n%100 ? ' and ' + spokenInteger(n%100) : '');
  if (n < 10000 && n % 1000 >= 100) return spokenInteger(Math.floor(n/1000)) + ' thousand ' + spokenInteger(n%1000);
  if (n < 10000) return spokenInteger(Math.floor(n/1000)) + ' thousand' + (n%1000 ? ' ' + spokenInteger(n%1000) : '');
  if (n < 1e6) return spokenInteger(Math.floor(n/1000)) + ' thousand' + (n%1000 ? ' ' + spokenInteger(n%1000) : '');
  if (n < 1e9) return spokenInteger(Math.floor(n/1e6)) + ' million' + (n%1e6 ? ' ' + spokenInteger(n%1e6) : '');
  return spokenInteger(Math.floor(n/1e9)) + ' billion';
}

function spokenPrice(n, asset) {
  if (n == null || isNaN(n)) return 'unknown levels';
  n = Number(n);
  if (n >= 1000) return spokenInteger(Math.round(n));
  if (n >= 1) {
    const whole = Math.floor(n);
    const cents = Math.round((n - whole) * 100);
    if (cents === 0) return spokenInteger(whole);
    const c1 = Math.floor(cents / 10), c2 = cents % 10;
    if (c2 === 0) return `${spokenInteger(whole)} point ${ONES[c1]}`;
    return `${spokenInteger(whole)} point ${ONES[c1]} ${ONES[c2]}`;
  }
  if (n >= 0.01) return n.toFixed(2) + ' dollars';
  return 'fractional levels';
}

function spokenChange(n) {
  if (n == null || isNaN(n)) return 'flat';
  n = Number(n);
  const dir = n >= 0 ? 'up' : 'down';
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const dec = Math.round((abs - whole) * 10);
  if (abs < 0.1) return 'roughly flat';
  if (dec === 0) return `${dir} ${spokenInteger(whole)} percent`;
  if (whole === 0) return `${dir} zero point ${ONES[dec] || dec} percent`;
  return `${dir} ${spokenInteger(whole)} point ${ONES[dec] || dec} percent`;
}

function pickPhrase(pool) {
  // Deterministic-ish selection seeded by current hour + minute/10
  const idx = (new Date().getHours() * 3 + Math.floor(new Date().getMinutes() / 10)) % pool.length;
  return pool[idx];
}

// ── Comprehensive brief: template-based (no LLM needed) ───────────────────
function generateLocalBrief(marketMode, md) {
  const isStocks = marketMode === 'stocks';
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek];
  const session = hour >= 5 && hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'late session';

  let a1, a2, a3, a1Name, a2Name, a3Name;
  let sentLabel, sentVal, sentReading;

  if (isStocks) {
    a1 = md.spy || {}; a2 = md.qqq || {}; a3 = md.aapl || {};
    a1Name = 'the S and P 500'; a2Name = 'the Nasdaq 100'; a3Name = 'Apple';
    sentVal = md.vix?.price; sentLabel = 'the VIX';
    if (sentVal >= 30) sentReading = 'extreme volatility';
    else if (sentVal >= 25) sentReading = 'elevated fear';
    else if (sentVal >= 20) sentReading = 'above average caution';
    else if (sentVal >= 15) sentReading = 'moderate conditions';
    else if (sentVal != null) sentReading = 'low volatility and complacency';
    else sentReading = null;
  } else {
    a1 = md.btc || {}; a2 = md.eth || {}; a3 = md.sol || {};
    a1Name = 'Bitcoin'; a2Name = 'Ethereum'; a3Name = 'Solana';
    sentVal = md.fearGreed?.value; sentLabel = 'the Fear and Greed Index';
    if (sentVal <= 20) sentReading = 'extreme fear';
    else if (sentVal <= 35) sentReading = 'fear in the market';
    else if (sentVal >= 80) sentReading = 'extreme greed';
    else if (sentVal >= 65) sentReading = 'growing greed';
    else if (sentVal != null) sentReading = 'neutral territory';
    else sentReading = null;
  }

  const ch1 = Number(a1.change) || 0;
  const ch2 = Number(a2.change) || 0;
  const ch3 = Number(a3.change) || 0;
  const avg = (ch1 + ch2 + ch3) / 3;
  const maxMove = Math.max(Math.abs(ch1), Math.abs(ch2), Math.abs(ch3));
  const allGreen = ch1 > 0 && ch2 > 0 && ch3 > 0;
  const allRed = ch1 < 0 && ch2 < 0 && ch3 < 0;

  // Determine market mood
  let mood;
  if (avg > 3) mood = 'strong_rally';
  else if (avg > 1) mood = 'bullish';
  else if (avg > 0.3) mood = 'mild_green';
  else if (avg < -3) mood = 'sharp_sell';
  else if (avg < -1) mood = 'bearish';
  else if (avg < -0.3) mood = 'mild_red';
  else mood = 'neutral';

  const paragraphs = [];

  // ── Paragraph 1: Opening / Tone-setter ──
  {
    const openings = {
      strong_rally: [
        `This ${dayName} ${session} carries a wave of momentum across the markets.`,
        `A powerful current of buying pressure defines this ${dayName}.`,
        `The ${session} opens with unmistakable strength, and the markets are responding.`,
      ],
      bullish: [
        `A constructive tone sets the pace this ${dayName} ${session}.`,
        `Confidence threads through the tape this ${dayName}, with buyers quietly asserting control.`,
        `The ${session} unfolds with a steady bid beneath the surface.`,
      ],
      mild_green: [
        `Markets drift modestly higher this ${dayName} ${session}, seeking direction.`,
        `A calm ${dayName} ${session} with a gentle green tilt across the board.`,
        `The ${session} begins with quiet optimism, though conviction remains measured.`,
      ],
      sharp_sell: [
        `Selling pressure intensifies this ${dayName} ${session}, testing resolve across the board.`,
        `A difficult ${dayName}. The markets are under siege and discipline is the only shelter.`,
        `This ${session} demands attention. Sellers are in control and the tape is unforgiving.`,
      ],
      bearish: [
        `Caution colors this ${dayName} ${session} as sellers apply steady pressure.`,
        `The ${session} carries a cautious undertone, with markets leaning into the red.`,
        `A measured retreat defines this ${dayName}. The market is speaking, and patience is the answer.`,
      ],
      mild_red: [
        `A slight pullback marks this ${dayName} ${session}, nothing dramatic but worth noting.`,
        `The ${session} opens with a subtle lean to the downside.`,
        `Minor weakness this ${dayName}. The kind of day that separates the disciplined from the reactive.`,
      ],
      neutral: [
        `Markets hold steady this ${dayName} ${session}, caught between buyers and sellers.`,
        `Equilibrium defines this ${dayName}. The market is coiling, waiting for its next catalyst.`,
        `A balanced ${session}. No clear edge, no forced moves. The market rewards those who wait.`,
      ],
    };
    if (isWeekend) {
      paragraphs.push(isStocks
        ? `${dayName}. Traditional markets are closed, giving you space to review your positions and prepare for the week ahead.`
        : pickPhrase([
            `${dayName} ${session} in the crypto markets. Weekend liquidity is thinner, and moves can be deceptive. Read them with care.`,
            `The ${dayName} tape rolls on. Crypto never sleeps, but weekend volume tells a different story than weekday conviction.`,
          ])
      );
    } else {
      paragraphs.push(pickPhrase(openings[mood] || openings.neutral));
    }
  }

  // ── Paragraph 2: Price Action Read ──
  {
    const p1 = a1.price ? spokenPrice(a1.price) : null;
    const p2 = a2.price ? spokenPrice(a2.price) : null;
    const p3 = a3.price ? spokenPrice(a3.price) : null;

    let priceText = '';
    if (p1) {
      priceText += `${a1Name} trades at ${p1}, ${spokenChange(ch1)} on the day. `;
    }

    if (p2 && p3) {
      if (allGreen) {
        priceText += `${a2Name} follows at ${p2}, ${spokenChange(ch2)}, while ${a3Name} adds to the strength at ${p3}, ${spokenChange(ch3)}. `;
      } else if (allRed) {
        priceText += `${a2Name} sits at ${p2}, ${spokenChange(ch2)}, and ${a3Name} shares the weakness at ${p3}, ${spokenChange(ch3)}. `;
      } else {
        // Mixed
        const ch2Dir = ch2 >= 0 ? 'holding' : 'dipping';
        const ch3Dir = ch3 >= 0 ? 'pushing higher' : 'pulling back';
        priceText += `${a2Name} is ${ch2Dir} at ${p2}, ${spokenChange(ch2)}, and ${a3Name} ${ch3Dir} at ${p3}, ${spokenChange(ch3)}. `;
      }
    }

    // Add divergence note if applicable
    if (Math.abs(ch1 - ch3) > 3 || Math.abs(ch1 - ch2) > 3) {
      priceText += 'The divergence between names is notable, suggesting rotation rather than a broad directional move. ';
    }

    paragraphs.push(priceText.trim());
  }

  // ── Paragraph 3: Sentiment Landscape + Alpha ──
  {
    let sentText = '';
    if (sentReading && sentVal != null) {
      if (isStocks) {
        sentText += `${sentLabel} reads at ${sentVal.toFixed(1)}, signaling ${sentReading}. `;
      } else {
        sentText += `${sentLabel} sits at ${sentVal}, reflecting ${sentReading}. `;
      }
    }

    // Alpha insight based on conditions
    if (mood === 'strong_rally' && sentVal != null) {
      if (isStocks ? sentVal <= 13 : sentVal >= 75) {
        sentText += 'But momentum and euphoria are neighbors. When everyone is comfortable, the market loves to remind you that risk is never retired. Trail your stops and let the trend work, but protect what you have built.';
      } else {
        sentText += 'The strength here is broad and constructive. This is the kind of tape where you let your winners breathe and add on confirmed breakouts. Trend is your ally today.';
      }
    } else if (mood === 'sharp_sell' || mood === 'bearish') {
      if (isStocks ? (sentVal != null && sentVal >= 28) : (sentVal != null && sentVal <= 25)) {
        sentText += 'Fear is thick, but history reminds us that the darkest readings often precede the sharpest recoveries. This is not the time to panic. It is the time to prepare your buy list.';
      } else {
        sentText += 'The selling is persistent but orderly. This is distribution, not capitulation. Watch for volume to exhaust before stepping in with size. Patience pays in this environment.';
      }
    } else if (mood === 'neutral' || mood === 'mild_green' || mood === 'mild_red') {
      if (maxMove < 0.8) {
        sentText += 'Volatility compression continues. The market is coiling, and coils release. The direction is uncertain, but the energy is building. Stay light, stay nimble, and let the breakout declare itself.';
      } else {
        sentText += 'No extreme readings, no forced positions. This is a stock picker\'s market, where selective positioning outperforms broad directional bets. Focus on relative strength and quality setups.';
      }
    }

    paragraphs.push(sentText.trim());
  }

  // ── Paragraph 4: Closing / How to Approach the Day ──
  {
    const closings = {
      strong_rally: [
        `The takeaway this ${session}: ride the momentum, but never forget that the market gives and takes in cycles. Protect capital, stay disciplined, and let this strength work for you. This is Spectre AI, and the market favors the prepared.`,
        `Today's message is clear: the trend is alive. Honor it, but respect it. Size with conviction, manage with discipline. This is Spectre AI. Stay sharp.`,
      ],
      bullish: [
        `Approach this ${session} with measured confidence. The tape supports the upside, but always respect the levels. Position with intention, not emotion. This is Spectre AI, and patience is power.`,
        `The setup is constructive. Let the market come to you. Scale in where conviction meets confirmation, and always know your exit before you enter. This is your Spectre AI intelligence brief.`,
      ],
      bearish: [
        `In moments like these, cash is a position and patience is an edge. Don't catch falling knives, wait for the market to show you a base. This is Spectre AI. Discipline over impulse.`,
        `The path of least resistance points lower for now. Reduce exposure, tighten stops, and let the dust settle. Opportunity will come, but timing matters. This is Spectre AI.`,
      ],
      sharp_sell: [
        `When the market bleeds, the disciplined survive and the prepared thrive. This is not the day for heroes. It's the day for watchlists and patience. Spectre AI reminds you: your best trade might be no trade at all.`,
        `Capitulation tests conviction. If your thesis is intact, weather the storm. If not, step aside. There is no shame in waiting. This is Spectre AI, and survival comes before glory.`,
      ],
      neutral: [
        `No edge, no force. Let the market reveal its hand before committing capital. The best opportunities come to those who wait. This is Spectre AI, and stillness is a strategy.`,
        `Use this time wisely. Review your positions, sharpen your plan, and be ready when the market moves. Quiet days are for preparation. This is Spectre AI.`,
      ],
    };

    const pool = closings[mood] || closings[mood.includes('red') ? 'bearish' : mood.includes('green') ? 'bullish' : 'neutral'] || closings.neutral;
    paragraphs.push(pickPhrase(pool));
  }

  return paragraphs.join(' ');
}

// ── LLM-based brief generation (secondary path) ────────────────────────────
const BRIEF_GENERATE_SYSTEM_PROMPT = `You are Spectre AI, a concise yet authoritative market intelligence narrator.
Write a 60-80 word spoken narrative synthesizing the provided market conditions.

CRITICAL RULES:
- NEVER use ticker symbols. Use full names: Bitcoin (not BTC), Ethereum (not ETH), Solana (not SOL), Apple (not AAPL), the S and P 500 (not SPY), the Nasdaq 100 (not QQQ), Nvidia (not NVDA), Tesla (not TSLA), the VIX (not VIX).
- NEVER use bullet points, headers, markdown, or formatting.
- Be punchy and direct — a premium 15-second market flash, not a monologue.
- All numbers should sound natural when spoken aloud. Say "ninety-five thousand" not "$95,000".
- One key insight or actionable takeaway. No filler.
- End with a brief sign-off: "This is Spectre AI."
- The text will be read aloud by a TTS engine — write for the ear, not the eye.
- STRICT: Never exceed 80 words. Brevity is power.`;

const LANG_NAMES = { en: 'English', fr: 'French', es: 'Spanish', zh: 'Chinese (Simplified)', hi: 'Hindi', ar: 'Arabic', ru: 'Russian', pt: 'Portuguese (Brazilian)' };

async function generateBriefLLM(marketMode, md, lang = 'en') {
  const effectiveAnthropicKey = ANTHROPIC_API_KEY || (OPENAI_API_KEY && OPENAI_API_KEY.startsWith('sk-ant-') ? OPENAI_API_KEY : null);
  const effectiveOpenAIKey = OPENAI_API_KEY && !OPENAI_API_KEY.startsWith('sk-ant-') ? OPENAI_API_KEY : null;

  const userContent = JSON.stringify({
    mode: marketMode,
    timeContext: `${new Date().toLocaleDateString('en-US', { weekday: 'long' })} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
    ...md,
  });

  // Add language instruction to system prompt for non-English
  const langName = LANG_NAMES[lang] || 'English';
  const systemPrompt = lang === 'en'
    ? BRIEF_GENERATE_SYSTEM_PROMPT
    : BRIEF_GENERATE_SYSTEM_PROMPT + `\n\nCRITICAL: Write the ENTIRE brief in ${langName}. Every word must be in ${langName}. Do NOT use English. Asset names like Bitcoin, Ethereum, S&P 500 can remain in their original form.`;

  // Try Anthropic
  if (effectiveAnthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': effectiveAnthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: 'user', content: `Generate a concise market brief (60-80 words max) in ${langName} based on this data:\n${userContent}` }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.content?.[0]?.text;
        if (text && text.length > 100) {
          console.log('Brief generation: LLM (Anthropic) produced', text.length, 'chars');
          return text;
        }
      }
    } catch (e) {
      console.error('Brief LLM (Anthropic) error:', e.message);
    }
  }

  // Try OpenAI
  if (effectiveOpenAIKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveOpenAIKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 512,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Generate a concise market brief (60-80 words max) in ${langName} based on this data:\n${userContent}` },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.length > 100) {
          console.log('Brief generation: LLM (OpenAI) produced', text.length, 'chars');
          return text;
        }
      }
    } catch (e) {
      console.error('Brief LLM (OpenAI) error:', e.message);
    }
  }

  return null; // fall through to local template
}

// ── Route: POST /api/brief/generate ─────────────────────────────────────────
router.post('/brief/generate', async (req, res) => {
  const { marketMode, marketData, language } = req.body;
  const lang = language || 'en';
  if (!marketMode || !marketData) {
    return res.status(400).json({ error: 'Missing marketMode or marketData' });
  }

  // Build stable cache key (round prices coarsely so minor ticks don't bust cache)
  const round = (n, step) => n != null ? Math.round(Number(n) / step) * step : 0;
  const keyParts = [
    marketMode,
    lang,
    new Date().getHours(), // changes hourly for session context
    round(marketData.btc?.price, 500),
    round(marketData.eth?.price, 50),
    round(marketData.sol?.price, 5),
    round(marketData.spy?.price, 5),
    round(marketData.qqq?.price, 5),
    round(marketData.fearGreed?.value, 5),
    round(marketData.vix?.price, 2),
    round((Number(marketData.btc?.change)||0) + (Number(marketData.spy?.change)||0), 0.5),
  ].join('|');
  const cacheKey = 'brief_' + keyParts;

  // Check cache
  const cached = h().getCached(briefGenerateCache, cacheKey, CACHE_TTL_BRIEF_GENERATE_MS);
  if (cached) {
    return res.json({ brief: cached.brief, source: cached.source, cached: true, generatedAt: cached.generatedAt });
  }

  try {
    // Try LLM first, fall back to local template
    let briefText = await generateBriefLLM(marketMode, marketData, lang).catch(() => null);
    let source = 'llm';

    if (!briefText) {
      // Local template is English-only; skip for non-English to avoid mixed-language UI
      if (lang !== 'en') {
        return res.json({ brief: null, source: 'skipped', reason: 'no-llm-for-language' });
      }
      briefText = generateLocalBrief(marketMode, marketData);
      source = 'template';
    }

    // Safety: run through ttsNormalize (English only — would corrupt translated text)
    if (lang === 'en') {
      briefText = ttsNormalize(briefText);
    }

    const result = { brief: briefText, source, generatedAt: Date.now() };
    h().setCached(briefGenerateCache, cacheKey, result, CACHE_TTL_BRIEF_GENERATE_MS);

    console.log(`Brief generate: ${source} | ${marketMode} | ${briefText.length} chars`);
    res.json({ ...result, cached: false });
  } catch (err) {
    console.error('Brief generate error:', err.message);
    res.status(500).json({ error: 'Failed to generate brief' });
  }
});

// ── Route: POST /api/brief/breaking-synthesis ──────────────────────────────
// Synthesises the latest breaking news into a smart 1-2 sentence market-impact
// statement using live price context sent from the client.
const BREAKING_SYNTH_SYSTEM = `You are Spectre AI, an elite market intelligence narrator.
Given a breaking news headline plus live market data, synthesise a single punchy 1-2 sentence alert (max 40 words).

RULES:
- Lead with the EVENT, then the MARKET IMPACT. Example: "Israel-Iran tensions escalating. BTC -4.2%, risk assets selling off. Capital rotating to stables."
- Use ticker symbols (BTC, ETH, SPY) and actual numbers from the data, never vague.
- If sentiment is bearish: end with a risk warning. If bullish: end with opportunity note. If neutral: end with "developing, watch closely."
- Sound like a Bloomberg terminal flash, not a news article.
- NO markdown, NO bullet points, NO greetings, NO sign-offs. NO dashes or em-dashes.
- NEVER a joke, pun, meme, slogan, rhetorical question, parenthetical aside or opinion. This is an ALERT slot on a trading desk: if you have nothing factual to report about this story, say what the market is doing and stop.
- EVERY alert must contain at least one real figure from the market data.
- STRICT: 40 words max.`;

// Enforced, not merely requested: the two rules above are also checked in code
// (lib/alert-quality.js) and a synthesis that breaks them is discarded. See
// that file for why — "Bitcoin fixes this (it isn't made of cheese)" shipped
// past a prompt that already forbade vagueness.
const { checkAlert } = require('../lib/alert-quality');

const CACHE_TTL_BREAKING_SYNTH_MS = 3 * 60 * 1000; // 3 min
const breakingSynthCache = new Map();
_standaloneCaches.push({ map: breakingSynthCache, ttlField: 'expires', ttlMs: CACHE_TTL_BREAKING_SYNTH_MS });

router.post('/brief/breaking-synthesis', async (req, res) => {
  const { marketData, language } = req.body;
  const { getBreaking } = require('./content/store');
  const { fetchMultipleFeeds } = require('./lib/rssParser');
  const { classifyBreakingTier, BREAKING_FEEDS } = require('./agents/breakingNewsAgent');

  // ── 1. Local content store (agent-generated breaking articles) ──
  let breakingArticles = getBreaking();

  // ── 2. Fallback: live RSS scan with TIER1/TIER2 keyword detection ──
  let rssFallbackArticle = null;
  if (!breakingArticles || breakingArticles.length === 0) {
    try {
      const allItems = await fetchMultipleFeeds(BREAKING_FEEDS);
      // Only items from last 4 hours
      const cutoff = Date.now() - 4 * 60 * 60 * 1000;
      const recent = allItems.filter(item => {
        const ts = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
        return ts > cutoff;
      });
      // Find the first item that matches TIER1 or TIER2 keywords
      for (const item of recent) {
        const tier = classifyBreakingTier(item.title, item.summary);
        if (tier) {
          // Derive sentiment from title keywords
          const text = `${item.title} ${item.summary || ''}`.toLowerCase();
          const bearKeywords = ['crash', 'plunge', 'selloff', 'sell-off', 'drop', 'hack', 'exploit', 'war', 'missile', 'strike', 'invasion', 'fear', 'drained', 'stolen', 'bankrupt'];
          const bullKeywords = ['surge', 'rally', 'soar', 'approved', 'approval', 'record high', 'ath', 'ceasefire', 'peace'];
          const bearHits = bearKeywords.filter(kw => text.includes(kw)).length;
          const bullHits = bullKeywords.filter(kw => text.includes(kw)).length;
          const derivedSentiment = bearHits > bullHits ? 'bearish' : bullHits > bearHits ? 'bullish' : 'neutral';
          // Extract tickers from title
          const tickerMatches = item.title.match(/\b(BTC|ETH|SOL|XRP|DOGE|ADA|AVAX|DOT|LINK|MATIC|SPY|QQQ|AAPL)\b/gi) || [];
          rssFallbackArticle = {
            headline: item.title,
            title: item.title,
            sentiment: derivedSentiment,
            tickers: [...new Set(tickerMatches.map(t => t.toUpperCase()))],
            publishedAt: item.publishedAt,
            slug: `rss-${item.id || Date.now()}`,
            source: item.source || 'RSS',
            isBreaking: tier === 'TIER1',
            breakingTier: tier,
          };
          console.log(`[breaking-synth] RSS fallback (${tier}): "${item.title?.slice(0, 60)}" from ${item.source} (${derivedSentiment})`);
          break;
        }
      }
    } catch (e) {
      console.warn('[breaking-synth] RSS scan error:', e.message);
    }
  }

  // ── 3. CryptoPanic API fallback (if API key is set) ──
  let cryptoPanicArticle = null;
  if (!breakingArticles?.length && !rssFallbackArticle && CRYPTOPANIC_API_KEY) {
    try {
      const cpUrl = `${CRYPTOPANIC_NEWS}?auth_token=${CRYPTOPANIC_API_KEY}&filter=important&kind=news&regions=en`;
      const cpRes = await fetch(cpUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (cpRes.ok) {
        const cpData = await cpRes.json();
        const cpResults = Array.isArray(cpData.results) ? cpData.results : [];
        const cutoff = Date.now() - 4 * 60 * 60 * 1000;
        const recent = cpResults.filter(p => p.published_at && new Date(p.published_at).getTime() > cutoff);
        if (recent.length > 0) {
          const top = recent[0];
          const votes = top.votes || {};
          const bullVotes = (votes.positive || 0) + (votes.liked || 0);
          const bearVotes = (votes.negative || 0) + (votes.disliked || 0);
          const cpSentiment = bullVotes > bearVotes * 1.5 ? 'bullish' : bearVotes > bullVotes * 1.5 ? 'bearish' : 'neutral';
          const cpTickers = (top.currencies || []).map(c => (c.code || '').toUpperCase()).filter(Boolean);
          cryptoPanicArticle = {
            headline: top.title || '', title: top.title || '', sentiment: cpSentiment,
            tickers: cpTickers, publishedAt: top.published_at, slug: `cp-${top.id}`,
            source: top.source?.title || 'CryptoPanic', isBreaking: true,
          };
          console.log(`[breaking-synth] CryptoPanic fallback: "${top.title?.slice(0, 60)}" (${cpSentiment})`);
        }
      }
    } catch (e) { console.warn('[breaking-synth] CryptoPanic error:', e.message); }
  }

  // Pick the best source: store > RSS > CryptoPanic
  const article = (breakingArticles?.length > 0)
    ? breakingArticles[0]
    : rssFallbackArticle || cryptoPanicArticle;

  if (!article) {
    return res.json({ synthesis: null, hasBreaking: false });
  }

  const headline = article.headline || article.title || '';
  const sentiment = article.sentiment || 'neutral';
  const tickers = article.tickers || [];
  const lang = language || 'en';

  // Cache key: article slug + rounded market snapshot
  const round = (n, step) => n != null ? Math.round(Number(n) / step) * step : 0;
  const cacheKey = `bsynth_${article.slug || headline.slice(0, 30)}_${round(marketData?.btc?.price, 500)}_${round(marketData?.spy?.price, 5)}_${lang}`;

  const cached = h().getCached(breakingSynthCache, cacheKey, CACHE_TTL_BREAKING_SYNTH_MS);
  if (cached) {
    return res.json({ synthesis: cached.synthesis, article: cached.article, hasBreaking: true, cached: true });
  }

  // Build context for LLM
  const priceContext = {};
  if (marketData) {
    for (const [k, v] of Object.entries(marketData)) {
      if (v?.price != null) priceContext[k] = { price: v.price, change: v.change || 0 };
    }
  }

  const userPayload = JSON.stringify({
    headline,
    sentiment,
    tickers,
    publishedAt: article.publishedAt,
    priceSnapshot: priceContext,
  });

  // Language instruction
  const langName = LANG_NAMES[lang] || 'English';
  const systemPrompt = lang === 'en'
    ? BREAKING_SYNTH_SYSTEM
    : BREAKING_SYNTH_SYSTEM + `\n\nCRITICAL: Write entirely in ${langName}.`;

  let synthesis = null;

  // Try Anthropic
  const effectiveAnthropicKey = ANTHROPIC_API_KEY || (OPENAI_API_KEY && OPENAI_API_KEY.startsWith('sk-ant-') ? OPENAI_API_KEY : null);
  const effectiveOpenAIKey = OPENAI_API_KEY && !OPENAI_API_KEY.startsWith('sk-ant-') ? OPENAI_API_KEY : null;

  if (effectiveAnthropicKey) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': effectiveAnthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 128,
          system: systemPrompt,
          messages: [{ role: 'user', content: `Synthesise this breaking news into a 1-2 sentence market alert (max 40 words) in ${langName}:\n${userPayload}` }],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        const t = d.content?.[0]?.text;
        // `length > 20` was the ONLY check here, which is how a joke reached
        // the Alerts slide. A rejected synthesis falls through to OpenAI and
        // then to the deterministic template below — both of which state a
        // real event with real numbers.
        const cand = t ? t.trim() : '';
        const verdict = checkAlert(cand);
        if (verdict.ok) synthesis = cand;
        else if (cand) console.warn(`[breaking-synth] Anthropic output rejected (${verdict.reason}): ${verdict.detail} | "${cand.slice(0, 80)}"`);
      }
    } catch (e) { console.error('Breaking synthesis (Anthropic) error:', e.message); }
  }

  // Fallback: OpenAI
  if (!synthesis && effectiveOpenAIKey) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveOpenAIKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 128,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Synthesise this breaking news into a 1-2 sentence market alert (max 40 words) in ${langName}:\n${userPayload}` },
          ],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        const t = d.choices?.[0]?.message?.content;
        const cand = t ? t.trim() : '';
        const verdict = checkAlert(cand);
        if (verdict.ok) synthesis = cand;
        else if (cand) console.warn(`[breaking-synth] OpenAI output rejected (${verdict.reason}): ${verdict.detail} | "${cand.slice(0, 80)}"`);
      }
    } catch (e) { console.error('Breaking synthesis (OpenAI) error:', e.message); }
  }

  // Deterministic template. Reached when no LLM key is set OR when every model
  // produced something that failed checkAlert() — this is the floor, and it is
  // a real alert: headline, live moves, stance.
  let usedTemplate = false;
  if (!synthesis) {
    usedTemplate = true;
    // Use article tickers, or fall back to market data keys (BTC, ETH, SPY, etc.)
    let tickerList = tickers.length > 0 ? tickers : (marketData ? Object.keys(marketData).filter(k => k !== 'fearGreed' && k !== 'vix') : []);
    const changeParts = tickerList.slice(0, 3).map(tk => {
      const sym = tk.toUpperCase();
      const d = marketData?.[tk] || marketData?.[sym] || marketData?.[sym.toLowerCase()];
      if (d?.change != null) return `${sym} ${parseFloat(d.change) >= 0 ? '+' : ''}${parseFloat(d.change).toFixed(1)}%`;
      if (d?.price != null) return `${sym} $${Number(d.price).toLocaleString('en', { maximumFractionDigits: 0 })}`;
      return null;
    }).filter(Boolean);
    synthesis = `BREAKING: ${headline}. ${changeParts.length ? changeParts.join(', ') + '. ' : ''}${sentiment === 'bearish' ? 'Risk-off, protect capital.' : sentiment === 'bullish' ? 'Risk-on, opportunity forming.' : 'Majors hold, developing. Watch closely.'}`;
  }

  const result = {
    synthesis,
    article: {
      slug: article.slug, headline, sentiment, tickers,
      publishedAt: article.publishedAt,
      coverImage: article.sourceArticle?.imageUrl || null,
      ogImage: article.ogImage ? `/og/${article.type || 'news'}/${article.slug}.png` : null,
      source: article.sourceArticle?.source || article.source || null,
      type: article.type || 'news',
    },
    hasBreaking: true,
  };
  h().setCached(breakingSynthCache, cacheKey, result, CACHE_TTL_BREAKING_SYNTH_MS);
  console.log(`Breaking synthesis: ${synthesis.length} chars | ${usedTemplate ? 'TEMPLATE' : 'llm'} | ${headline.slice(0, 50)}`);
  res.json({ ...result, cached: false });
});

// GET available voices for client-side voice picker
router.get('/brief/voices', (req, res) => {
  const voices = Object.entries(ELEVENLABS_VOICES).map(([key, v]) => ({
    key,
    name: v.name,
    description: v.desc,
    isDefault: key === ELEVENLABS_DEFAULT_VOICE,
  }));
  res.json({ voices, default: ELEVENLABS_DEFAULT_VOICE });
});

// ── Voice command confirmations — lightweight TTS for short phrases ──────────
router.post('/voice/speak', async (req, res) => {
  const { text, voice: voiceKey } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length < 2) {
    return res.status(400).json({ error: 'Text too short or missing' });
  }

  const cleanText = text.trim().slice(0, 200); // Cap at 200 chars for safety
  const voiceSuffix = voiceKey || ELEVENLABS_DEFAULT_VOICE;
  const hash = crypto.createHash('md5').update(cleanText + ':' + voiceSuffix + ':voice-cmd').digest('hex');

  // Check existing brief cache (reuse same cache)
  const cached = briefAudioCache.get(hash);
  if (cached && Date.now() < cached.expires) {
    res.set('Content-Type', cached.contentType);
    res.set('X-Audio-Cached', 'true');
    return res.send(cached.buffer);
  }

  try {
    // ElevenLabs → Edge TTS fallback
    let result = await elevenLabsTTS(cleanText, voiceKey).catch(() => null);
    if (!result) {
      const edgeVoice = EDGE_TTS_VOICES?.en || 'en-US-GuyNeural';
      result = await edgeTTS(cleanText, edgeVoice).catch(() => null);
    }

    if (!result) {
      return res.status(503).json({ error: 'TTS unavailable', fallback: 'webspeech' });
    }

    // Cache for 10 minutes (voice confirmations are highly repetitive)
    briefAudioCache.set(hash, {
      buffer: result.buffer,
      contentType: result.contentType,
      source: result.source,
      voice: result.voice,
      expires: Date.now() + 600_000,
    });

    res.set('Content-Type', result.contentType);
    res.set('X-Audio-Source', result.source || 'unknown');
    res.send(result.buffer);
  } catch (err) {
    console.error('Voice speak error:', err.message);
    res.status(500).json({ error: 'TTS generation failed' });
  }
});

router.post('/brief/audio', async (req, res) => {
  const { text, voice: voiceKey, fullBrief, language } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length < 20) {
    return res.status(400).json({ error: 'Brief text too short or missing' });
  }

  const lang = language || 'en';

  // Clean and truncate — full briefs get a higher char limit
  const maxChars = fullBrief ? BRIEF_FULL_AUDIO_MAX_CHARS : BRIEF_AUDIO_MAX_CHARS;
  let cleanText = stripMarkdownHtml(text);
  cleanText = truncateAtSentence(cleanText, maxChars);

  // Cache key includes voice + language so different voices/languages get separate caches
  const voiceSuffix = voiceKey || ELEVENLABS_DEFAULT_VOICE;
  const hash = crypto.createHash('md5').update(cleanText + ':' + voiceSuffix + ':' + lang).digest('hex');
  const cached = briefAudioCache.get(hash);
  if (cached && Date.now() < cached.expires) {
    res.set('Content-Type', cached.contentType);
    res.set('X-Audio-Cached', 'true');
    res.set('X-Audio-Source', cached.source || 'cached');
    res.set('X-Audio-Voice', cached.voice || voiceSuffix);
    return res.send(cached.buffer);
  }

  // Rate limiting by IP (only for uncached/new TTS generation)
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
  const lastRequest = briefAudioRateLimit.get(clientIp);
  if (lastRequest && Date.now() - lastRequest < BRIEF_AUDIO_RATE_LIMIT_MS) {
    return res.status(429).json({ error: 'Rate limited. Try again in a few seconds.' });
  }
  evictIfFull(briefAudioRateLimit, 1000);
  briefAudioRateLimit.set(clientIp, Date.now());

  try {
    // Fallback chain: ElevenLabs → Edge TTS (language-matched voice)
    let result = await elevenLabsTTS(cleanText, voiceKey, lang).catch((e) => {
      console.error('ElevenLabs failed:', e.message);
      return null;
    });

    if (!result) {
      const edgeVoice = EDGE_TTS_VOICES[lang] || EDGE_TTS_VOICES.en;
      console.log(`Brief audio: falling back to Edge TTS (${edgeVoice})`);
      result = await edgeTTS(cleanText, edgeVoice).catch((e) => {
        console.error('Edge TTS failed:', e.message);
        return null;
      });
    }

    if (!result) {
      // Both failed — tell client to use Web Speech API
      return res.status(503).json({ error: 'All TTS providers unavailable', fallback: 'webspeech' });
    }

    // Cache it
    briefAudioCache.set(hash, {
      buffer: result.buffer,
      contentType: result.contentType,
      source: result.source,
      voice: result.voice || voiceSuffix,
      expires: Date.now() + BRIEF_AUDIO_CACHE_TTL,
    });

    // Clean old cache entries (keep max 50)
    if (briefAudioCache.size > 50) {
      const keys = [...briefAudioCache.keys()];
      for (let i = 0; i < keys.length - 50; i++) {
        briefAudioCache.delete(keys[i]);
      }
    }

    res.set('Content-Type', result.contentType);
    res.set('X-Audio-Source', result.source);
    res.set('X-Audio-Voice', result.voice || voiceSuffix);
    res.send(result.buffer);
  } catch (err) {
    console.error('Brief audio generation error:', err.message);
    res.status(500).json({ error: 'Audio generation failed' });
  }
});


module.exports = router
