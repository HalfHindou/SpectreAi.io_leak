/**
 * audioRoute - Bluetooth audio detection for the voice session.
 *
 * THE TRAP: the moment ANY microphone capture is open, a Bluetooth
 * speaker/headset drops from its hi-fi music profile (A2DP) into the
 * hands-free call profile (HFP) - "speaker mode" - and everything the
 * agent says plays in telephone quality (live report: "when agent starts
 * to speak it activates the speaker mode"). Capture during playback came
 * from two places: the barge-watch recognition (listens for interruptions
 * WHILE the agent talks) and the orb visualizer's session-long mic stream.
 *
 * When a Bluetooth audio device is present, both are suppressed - the
 * agent's voice stays on the clean A2DP path. Interruption still works by
 * tapping the orb; the orb animates on its mic-free idle loop.
 *
 * Device labels require a prior getUserMedia grant (the session has one);
 * refresh after acquiring the mic and on every devicechange.
 */

// Windows BT: "Headset (X Hands-Free AG Audio)" / "Headphones (X Stereo)";
// macOS/iOS: "AirPods ..."; Chrome sometimes appends "(Bluetooth)".
// Conservative on purpose - a false positive silently downgrades barge-in.
const BT_RE = /bluetooth|hands.?free|airpods?|\bhfp\b|\ba2dp\b|wireless (?:head|ear|speaker)|earbuds|\bbuds\b|\bbuds\d/i

export function isBluetoothLabel(label) {
  return BT_RE.test(String(label || ''))
}

let _bt = false

/** Re-scan devices; returns the current verdict. Fail-soft (keeps last). */
export async function refreshBluetoothAudio() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    _bt = devices.some(
      (d) => (d.kind === 'audiooutput' || d.kind === 'audioinput') && isBluetoothLabel(d.label)
    )
  } catch { /* keep the last verdict */ }
  return _bt
}

/** Synchronous read of the last scan (false until a scan ran). */
export const bluetoothAudioActive = () => _bt

if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => { refreshBluetoothAudio() })
}
