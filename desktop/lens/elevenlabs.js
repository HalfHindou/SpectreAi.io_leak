'use strict';

/**
 * ElevenLabs voice synthesis module for Spectre Lens
 * Converts verdict text to spoken audio
 */

const axios = require('axios');

// Spectre AI analyst voice — Adam: professional, confident
const VOICE_ID = 'pNInz6obpgDQGcFmaJgB';
const API_URL  = 'https://api.elevenlabs.io/v1';

async function synthesizeSpeech(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    try { console.warn('[Lens ElevenLabs] No ELEVENLABS_API_KEY — skipping voice'); } catch (_) {}
    return null;
  }

  if (!text || text.length < 3) return null;

  try {
    const response = await axios.post(
      `${API_URL}/text-to-speech/${VOICE_ID}`,
      {
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability:        0.75,
          similarity_boost:  0.85,
          style:            0.3,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          'Accept':       'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key':   apiKey,
        },
        responseType: 'arraybuffer',
        timeout:      10000,
      }
    );

    // Convert to base64 data URI for the renderer to play
    const base64 = Buffer.from(response.data).toString('base64');
    return `data:audio/mpeg;base64,${base64}`;

  } catch (err) {
    try { console.error('[Lens ElevenLabs] Synthesis failed:', err.message); } catch (_) {}
    return null;
  }
}

module.exports = { synthesizeSpeech };
