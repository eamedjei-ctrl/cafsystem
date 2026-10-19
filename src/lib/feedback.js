/**
 * Audible feedback so staff don't have to look at the screen for every scan:
 *   success  : one short high beep
 *   warning  : two medium beeps (duplicate)
 *   error    : one long low tone
 */
let ctx = null

function audio() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return null
    ctx = new AudioCtx()
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function tone(ac, frequency, start, duration) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, ac.currentTime + start)
  gain.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + duration)
  osc.connect(gain).connect(ac.destination)
  osc.start(ac.currentTime + start)
  osc.stop(ac.currentTime + start + duration + 0.02)
}

export function playFeedback(tone_) {
  try {
    const ac = audio()
    if (!ac) return
    if (tone_ === 'success') tone(ac, 1320, 0, 0.12)
    else if (tone_ === 'warning') {
      tone(ac, 660, 0, 0.12)
      tone(ac, 660, 0.18, 0.12)
    } else tone(ac, 220, 0, 0.45)
  } catch {
    // Audio is a convenience; never let it break check-in.
  }
}

/** Browsers only allow audio after a user gesture; call this on first tap. */
export function unlockAudio() {
  try {
    audio()
  } catch {
    // ignore
  }
}
