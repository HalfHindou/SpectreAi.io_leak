'use strict';

/**
 * Speech-to-text via ElevenLabs Scribe v1
 * Replaces OpenAI Whisper — zero OpenAI dependencies
 */

const axios    = require('axios');
const FormData = require('form-data');

async function transcribeAudio(audioBuffer) {
  if (!audioBuffer || audioBuffer.length === 0) return '';

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn('[Lens STT] No ELEVENLABS_API_KEY — skipping transcription');
    return '';
  }

  const form = new FormData();
  form.append('audio', audioBuffer, { filename: 'recording.wav', contentType: 'audio/wav' });
  form.append('model_id', 'scribe_v1');

  const response = await axios.post(
    'https://api.elevenlabs.io/v1/speech-to-text',
    form,
    {
      headers: { ...form.getHeaders(), 'xi-api-key': apiKey },
      timeout: 15000,
    }
  );

  return response.data.text?.trim() || '';
}

module.exports = { transcribeAudio };
