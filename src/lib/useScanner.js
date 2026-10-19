import { useEffect, useRef } from 'react'
import { ScanBuffer } from './scanner'

function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * Listen for scanner input anywhere on the page (no text box needs focus, so
 * the tablet's on-screen keyboard never pops up). Keys typed into form fields
 * are left alone. Calls onScan({ code, fromScanner }).
 */
export function useScanner(onScan, { enabled = true } = {}) {
  const bufferRef = useRef(new ScanBuffer())
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!enabled) return undefined
    const buffer = bufferRef.current
    buffer.clear()

    const handler = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if ((event.key === 'Enter' || event.key === 'Tab') && buffer.pending) event.preventDefault()
      const scan = buffer.push(event.key, event.timeStamp || performance.now())
      if (scan) onScanRef.current(scan)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled])
}
