/**
 * BriefAudioPlayer - Voice mode for AI Intelligence Brief
 *
 * Circular play/pause button with mini waveform visualizer + voice picker.
 * TTS fallback chain: ElevenLabs → Edge TTS → Web Speech API
 *
 * States: idle | loading | playing | paused | error
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ttsNormalize } from '@/lib/ttsNormalize'

const API_URL = '/api/brief/audio'
const VOICES_URL = '/api/brief/voices'

// Language → Web Speech voice preferences
const WEB_SPEECH_VOICE_PREFS = {
  en: ['Daniel', 'Samantha (Enhanced)', 'Samantha', 'Google UK English Male', 'Google US English', 'Karen', 'Alex'],
  fr: ['Thomas', 'Amelie', 'Google français'],
  es: ['Jorge', 'Monica', 'Google español'],
  zh: ['Ting-Ting', 'Google 普通话'],
  hi: ['Lekha', 'Google हिन्दी'],
  ar: ['Maged', 'Google العربية'],
  ru: ['Milena', 'Yuri', 'Google русский'],
  pt: ['Luciana', 'Google português do Brasil'],
}

// Language → BCP-47 lang code for utterance.lang
const WEB_SPEECH_LANG_CODES = {
  en: 'en-US', fr: 'fr-FR', es: 'es-ES', zh: 'zh-CN',
  hi: 'hi-IN', ar: 'ar-SA', ru: 'ru-RU', pt: 'pt-BR',
}

// --- Web Speech API fallback ---
function webSpeechFallback(text, lang = 'en') {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) return reject(new Error('No speechSynthesis'))

    // Cancel any ongoing speech
    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = WEB_SPEECH_LANG_CODES[lang] || 'en-US'

    const setVoice = () => {
      const voices = window.speechSynthesis.getVoices()

      // First try language-specific preferred voices
      const preferred = WEB_SPEECH_VOICE_PREFS[lang] || WEB_SPEECH_VOICE_PREFS.en
      for (const name of preferred) {
        const found = voices.find(v => v.name.includes(name))
        if (found) {
          utterance.voice = found
          break
        }
      }

      // If no preferred voice found, try any voice matching the language
      if (!utterance.voice) {
        const langCode = WEB_SPEECH_LANG_CODES[lang] || 'en'
        const langVoice = voices.find(v => v.lang.startsWith(langCode.split('-')[0]))
        if (langVoice) utterance.voice = langVoice
      }

      utterance.rate = 0.92    // Slightly slower = more authoritative
      utterance.pitch = 0.95   // Slightly deeper
      utterance.volume = 1.0
    }

    const voices = window.speechSynthesis.getVoices()
    if (voices.length) {
      setVoice()
    } else {
      window.speechSynthesis.onvoiceschanged = setVoice
    }

    utterance.onend = () => resolve()
    utterance.onerror = (e) => reject(e)
    window.speechSynthesis.speak(utterance)
  })
}

// Listen-to-brief is currently locked everywhere - the TTS pipeline is being
// reworked. Surface a "Coming soon" lock instead of letting users hit a half-
// working audio path. Re-enable by switching this constant back to runtime
// detection (showcase-embed / demo flag / iframe check).
const isAudioLocked = true

const BriefAudioPlayer = ({ briefText, sentimentRgb, isFullBrief = false, showLabel = false }) => {
  const { i18n, t } = useTranslation()
  const currentLang = i18n.language || 'en'
  const [state, setState] = useState('idle') // idle | loading | playing | paused | error
  const [briefChanged, setBriefChanged] = useState(false)
  const [voiceKey, setVoiceKey] = useState(null) // null = server default
  const [voices, setVoices] = useState([])
  const [showVoicePicker, setShowVoicePicker] = useState(false)
  const audioRef = useRef(null)
  const blobUrlRef = useRef(null)
  const lastPlayedTextRef = useRef('')
  const errorTimeoutRef = useRef(null)
  const usingWebSpeechRef = useRef(false)
  const voicePickerRef = useRef(null)

  // Fetch available voices on mount
  useEffect(() => {
    if (import.meta.env.DEV) return
    fetch(VOICES_URL)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.voices) {
          setVoices(data.voices)
          if (!voiceKey && data.default) setVoiceKey(data.default)
        }
      })
      .catch(() => {})
  }, [])

  // Close voice picker on outside click
  useEffect(() => {
    if (!showVoicePicker) return
    const handleClick = (e) => {
      if (voicePickerRef.current && !voicePickerRef.current.contains(e.target)) {
        setShowVoicePicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showVoicePicker])

  // Track when brief text changes while playing
  useEffect(() => {
    if (
      (state === 'playing' || state === 'paused') &&
      briefText !== lastPlayedTextRef.current
    ) {
      setBriefChanged(true)
    }
  }, [briefText, state])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
      }
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
      }
      if (usingWebSpeechRef.current) {
        window.speechSynthesis?.cancel()
      }
    }
  }, [])

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.removeEventListener('ended', handleEnded)
      audioRef.current.removeEventListener('error', handleError)
      audioRef.current = null
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    if (usingWebSpeechRef.current) {
      window.speechSynthesis?.cancel()
      usingWebSpeechRef.current = false
    }
  }, [])

  const handleEnded = useCallback(() => {
    setState('idle')
    setBriefChanged(false)
    usingWebSpeechRef.current = false
  }, [])

  const handleError = useCallback(() => {
    setState('error')
    errorTimeoutRef.current = setTimeout(() => {
      setState('idle')
    }, 3000)
  }, [])

  const handlePlay = useCallback(async () => {
    if (!briefText || briefText.trim().length < 20) return

    // If paused with audio element, resume
    if (state === 'paused' && audioRef.current) {
      try {
        await audioRef.current.play()
        setState('playing')
        return
      } catch {
        // Fall through to re-fetch
      }
    }

    // If paused with Web Speech, resume
    if (state === 'paused' && usingWebSpeechRef.current) {
      window.speechSynthesis?.resume()
      setState('playing')
      return
    }

    // Clean up previous
    cleanup()
    setState('loading')
    setBriefChanged(false)
    lastPlayedTextRef.current = briefText

    // Normalize text for TTS - convert tickers to spoken names, symbols to words
    // Only apply English normalization for English; other languages have pre-translated text
    const textToSend = currentLang === 'en' ? ttsNormalize(briefText) : briefText

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSend, voice: voiceKey, fullBrief: isFullBrief || false, language: currentLang }),
      })

      // Server returned audio (ElevenLabs or Edge TTS)
      if (response.ok) {
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        blobUrlRef.current = url

        const audio = new Audio(url)
        audio.addEventListener('ended', handleEnded)
        audio.addEventListener('error', handleError)
        audioRef.current = audio

        await audio.play()
        setState('playing')
        return
      }

      // Server said to use webspeech fallback, or all server TTS failed
      const errData = await response.json().catch(() => ({}))

      if (errData.fallback === 'webspeech' || response.status === 503 || response.status === 502) {
        // Last resort: Web Speech API
        usingWebSpeechRef.current = true
        setState('playing')

        await webSpeechFallback(textToSend, currentLang)
        handleEnded()
        return
      }

      throw new Error(`HTTP ${response.status}`)
    } catch (err) {
      console.error('BriefAudioPlayer: Failed to play', err)

      // Even fetch failed - try Web Speech as absolute last resort
      if (!usingWebSpeechRef.current && window.speechSynthesis) {
        try {
          usingWebSpeechRef.current = true
          setState('playing')
          await webSpeechFallback(textToSend, currentLang)
          handleEnded()
          return
        } catch (speechErr) {
          console.error('BriefAudioPlayer: Web Speech also failed', speechErr)
        }
      }

      handleError()
    }
  }, [briefText, state, voiceKey, isFullBrief, currentLang, cleanup, handleEnded, handleError])

  const handlePause = useCallback(() => {
    if (usingWebSpeechRef.current) {
      window.speechSynthesis?.pause()
      setState('paused')
    } else if (audioRef.current) {
      audioRef.current.pause()
      setState('paused')
    }
  }, [])

  const handleClick = useCallback(() => {
    if (state === 'loading') return
    if (state === 'playing') {
      handlePause()
    } else {
      handlePlay()
    }
  }, [state, handlePlay, handlePause])

  const handleVoiceSelect = useCallback((key) => {
    setVoiceKey(key)
    setShowVoicePicker(false)
    // If currently playing, stop and restart with new voice
    if (state === 'playing' || state === 'paused') {
      cleanup()
      setState('idle')
      setBriefChanged(false)
    }
  }, [state, cleanup])

  // Hide if brief text is too short or empty
  if (!briefText || briefText.trim().length < 20) {
    return null
  }

  const glowColor = sentimentRgb || '142, 142, 147'
  const isActive = state === 'playing' || state === 'paused'
  const currentVoice = voices.find(v => v.key === voiceKey)

  return (
    <div className="brief-audio-container">
      <button
        type="button"
        className={`brief-audio-btn brief-audio-${state}${isAudioLocked ? ' is-locked' : ''}${showLabel ? ' brief-audio-btn--labelled' : ''}`}
        onClick={(e) => { if (isAudioLocked) { e.preventDefault(); return } handleClick(e) }}
        data-tooltip={
          isAudioLocked ? 'Voice brief - coming soon' :
          state === 'error' ? 'Audio unavailable - try again' :
          state === 'loading' ? 'Loading audio…' :
          state === 'playing' ? 'Pause brief' :
          state === 'paused' ? 'Resume brief' :
          'Listen to Brief'
        }
        data-tooltip-pos="left"
        style={{
          '--audio-glow-rgb': glowColor,
        }}
        aria-label={isAudioLocked ? 'Voice brief - coming soon' : state === 'playing' ? 'Pause brief audio' : 'Play brief audio'}
        aria-disabled={isAudioLocked || undefined}
      >
        {isAudioLocked ? (
          <svg className="brief-audio-icon brief-audio-lock" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path
              d="M7 10V7a5 5 0 0 1 10 0v3m-11 0h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <>
            {state === 'loading' && (
              <div className="brief-audio-spinner">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <circle
                    cx="12" cy="12" r="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="42"
                    strokeDashoffset="12"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            )}
            {(state === 'idle' || state === 'error' || state === 'paused') && (
              <svg className="brief-audio-icon" viewBox="0 0 24 24" width="14" height="14">
                <polygon points="7,5 19,12 7,19" fill="currentColor" />
              </svg>
            )}
            {state === 'playing' && (
              <div className="brief-audio-waveform">
                <span className="brief-audio-bar bar-1" />
                <span className="brief-audio-bar bar-2" />
                <span className="brief-audio-bar bar-3" />
                <span className="brief-audio-bar bar-4" />
                <span className="brief-audio-bar bar-5" />
              </div>
            )}
            {briefChanged && isActive && (
              <span className="brief-audio-new-dot" title="New brief available" />
            )}
          </>
        )}
        {showLabel && (
          <span className="brief-audio-label">
            {isAudioLocked ? t('cinemaBrief.voiceSoon', 'Voice soon')
              : state === 'playing' ? t('common.pause', 'Pause')
              : state === 'paused' ? t('common.resume', 'Resume')
              : state === 'loading' ? t('common.loading', 'Loading…')
              : t('cinemaBrief.listen', 'Listen')}
          </span>
        )}
      </button>

      {/* Voice name + picker */}
      {!isAudioLocked && voices.length > 1 && (
        <div className="brief-voice-picker-wrap" ref={voicePickerRef}>
          <button
            className="brief-voice-label"
            onClick={() => setShowVoicePicker(!showVoicePicker)}
            title="Change voice"
          >
            <span className="brief-voice-name">{currentVoice?.name || 'Voice'}</span>
            <svg className="brief-voice-chevron" viewBox="0 0 12 12" width="8" height="8">
              <path d="M3 5 L6 8 L9 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          {showVoicePicker && (
            <div className="brief-voice-dropdown">
              {voices.map(v => (
                <button
                  key={v.key}
                  className={`brief-voice-option ${v.key === voiceKey ? 'active' : ''}`}
                  onClick={() => handleVoiceSelect(v.key)}
                >
                  <span className="brief-voice-option-name">{v.name}</span>
                  <span className="brief-voice-option-desc">{v.description}</span>
                  {v.key === voiceKey && <span className="brief-voice-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default React.memo(BriefAudioPlayer)
