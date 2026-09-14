'use strict';

/**
 * Microphone recording module for Spectre Lens
 * Delegates to the overlay renderer process via IPC (uses Web Audio API / MediaRecorder).
 * No external binaries needed — works out of the box on macOS, Windows, Linux.
 */

let overlayWebContents = null;
let pendingAudioResolve = null;
let isRecording = false;

function setOverlayWebContents(wc) {
  overlayWebContents = wc;
}

function startRecording() {
  if (!overlayWebContents || overlayWebContents.isDestroyed()) return;
  isRecording = true;
  overlayWebContents.send('lens:start-mic');
}

async function stopRecording() {
  if (!isRecording) return null;
  isRecording = false;

  if (!overlayWebContents || overlayWebContents.isDestroyed()) return null;
  if (pendingAudioResolve) return null; // already waiting — reject concurrent call

  return new Promise((resolve) => {
    pendingAudioResolve = resolve;
    overlayWebContents.send('lens:stop-mic');

    // Timeout: if renderer doesn't respond within 3s, resolve null
    setTimeout(() => {
      if (pendingAudioResolve === resolve) {
        pendingAudioResolve = null;
        resolve(null);
      }
    }, 3000);
  });
}

/**
 * Called by lens-main when the renderer sends back audio data via IPC
 */
function receiveAudioData(data) {
  if (!pendingAudioResolve) return;
  const resolve = pendingAudioResolve;
  pendingAudioResolve = null;

  if (!data || !data.buffer || data.buffer.length < 1000) {
    resolve(null);
    return;
  }

  resolve(Buffer.from(data.buffer));
}

module.exports = { startRecording, stopRecording, receiveAudioData, setOverlayWebContents };
