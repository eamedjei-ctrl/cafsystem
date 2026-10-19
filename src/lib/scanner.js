/**
 * USB barcode / QR scanners behave like keyboards ("keyboard wedge"): they
 * type the encoded characters very quickly and then press Enter (or Tab).
 * ScanBuffer turns that stream of key events into complete scans, so any
 * standard scanner works without drivers.
 *
 * It is pure (no DOM access) so it can be unit tested; useScanner wires it to
 * window keydown events.
 */
export class ScanBuffer {
  /**
   * @param {object} [opts]
   * @param {string[]} [opts.terminators] Keys that end a scan. Most scanners send Enter.
   * @param {number} [opts.resetAfterMs] If the gap between two keys exceeds this, earlier keys are discarded.
   * @param {number} [opts.maxLength] Ignore anything longer (e.g. something resting on the keyboard).
   * @param {number} [opts.scannerMaxAvgGapMs] Average key gap below which input counts as a scanner.
   */
  constructor(opts = {}) {
    this.terminators = opts.terminators ?? ['Enter', 'Tab']
    this.resetAfterMs = opts.resetAfterMs ?? 2000
    this.maxLength = opts.maxLength ?? 64
    this.scannerMaxAvgGapMs = opts.scannerMaxAvgGapMs ?? 35
    this.chars = []
    this.times = []
  }

  /**
   * Feed one key (KeyboardEvent.key) with its timestamp in ms.
   * Returns { code, fromScanner } when a terminator completes a non-empty buffer.
   */
  push(key, now) {
    const last = this.times[this.times.length - 1]
    if (last !== undefined && now - last > this.resetAfterMs) this.clear()

    if (this.terminators.includes(key)) {
      const code = this.chars.join('')
      const fromScanner = this.isFast()
      this.clear()
      return code.trim() ? { code, fromScanner } : null
    }

    if (key === 'Backspace') {
      this.chars.pop()
      this.times.pop()
      return null
    }
    if (key === 'Escape') {
      this.clear()
      return null
    }

    // Single printable characters only; ignore Shift, Control, arrows, F-keys…
    if (key.length !== 1) return null

    if (this.chars.length >= this.maxLength) {
      this.clear()
      return null
    }
    this.chars.push(key)
    this.times.push(now)
    return null
  }

  get pending() {
    return this.chars.join('')
  }

  clear() {
    this.chars = []
    this.times = []
  }

  isFast() {
    if (this.times.length < 3) return false
    const span = this.times[this.times.length - 1] - this.times[0]
    return span / (this.times.length - 1) <= this.scannerMaxAvgGapMs
  }
}

/**
 * Scanners can fire twice for one swipe, and students sometimes hold a card
 * under the scanner. Suppress an identical code seen again within windowMs.
 */
export class RepeatGuard {
  constructor(windowMs = 3000) {
    this.windowMs = windowMs
    this.reset()
  }

  shouldIgnore(code, now) {
    const repeat = code === this.lastCode && now - this.lastAt < this.windowMs
    this.lastCode = code
    this.lastAt = now
    return repeat
  }

  reset() {
    this.lastCode = ''
    this.lastAt = -Infinity
  }
}
