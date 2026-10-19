/**
 * Student ID rules. Must match the check constraint on public.students.
 *
 * SCHOOL-SPECIFIC: the default allows 1–32 letters, digits, "-" and "_".
 * If your cards encode something else, adapt extractStudentCode below and the
 * database constraint together.
 */
export const STUDENT_CODE_PATTERN = /^[A-Z0-9_-]{1,32}$/

/** Turn raw scanner/keyboard input into a normalised student code. */
export function normalizeStudentCode(raw) {
  return extractStudentCode(raw).trim().toUpperCase()
}

/**
 * Some ID-card QR codes contain a URL like https://school.example/id/S1234 or
 * a "STUDENT:S1234" prefix. Take the last path segment / value after ":" so
 * those cards still work. Plain codes pass through unchanged.
 */
export function extractStudentCode(raw) {
  const value = String(raw ?? '').trim()
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const fromQuery = url.searchParams.get('id') ?? url.searchParams.get('student')
      if (fromQuery) return fromQuery
      const segments = url.pathname.split('/').filter(Boolean)
      return segments[segments.length - 1] ?? ''
    } catch {
      return value
    }
  }
  const prefixed = /^(?:student|id|sid)\s*[:=]\s*(.+)$/i.exec(value)
  return prefixed ? prefixed[1] : value
}

export function isValidStudentCode(code) {
  return STUDENT_CODE_PATTERN.test(code)
}
