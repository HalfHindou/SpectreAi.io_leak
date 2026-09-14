/**
 * Vercel Serverless -- Voice TTS endpoint.
 * Proxies short text-to-speech requests to ElevenLabs when ELEVENLABS_API_KEY
 * is available.  Falls back to a JSON error directing the client to use the
 * browser's Web Speech API.
 *
 * Routing: vercel.json rewrites /api/voice/speak to /api/voice-speak
 */

// ElevenLabs voice IDs (premade voices, work on free-tier keys)
const VOICE_IDS = {
  sam:    'yoZ06aMxZJJ28mfd3POQ',
  josh:   'TxGEqnHWrfWFTfGW9XjX',
  adam:   'pNInz6obpgDQGcFmaJgB',
  clyde:  '2EiwWnXFnvU5JabPnv8n',
  daniel: 'onwK4e9ZLuTAKqWW03F9',
};
const DEFAULT_VOICE = 'sam';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required' });
  }

  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVENLABS_API_KEY) {
    return res.status(200).json({ error: 'TTS unavailable', fallback: 'webspeech' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { text, voice: voiceKey } = body;

    if (!text || typeof text !== 'string' || text.trim().length < 2) {
      return res.status(400).json({ error: 'Text too short or missing' });
    }

    const cleanText = text.trim().slice(0, 200); // Cap at 200 chars
    const resolvedKey = (voiceKey && VOICE_IDS[voiceKey]) ? voiceKey : DEFAULT_VOICE;
    const voiceId = VOICE_IDS[resolvedKey];

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!ttsRes.ok) {
      console.error(`[voice-speak] ElevenLabs HTTP ${ttsRes.status}`);
      return res.status(200).json({ error: 'TTS unavailable', fallback: 'webspeech' });
    }

    // Stream the audio bytes back to the client
    const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Audio-Source', 'elevenlabs');
    return res.send(audioBuffer);
  } catch (err) {
    console.error('[voice-speak] error:', err.message);
    return res.status(500).json({ error: 'TTS generation failed', fallback: 'webspeech' });
  }
}
