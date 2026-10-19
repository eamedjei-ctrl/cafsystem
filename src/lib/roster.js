import { parseCsv } from './csv'
import { isValidStudentCode, normalizeStudentCode } from './studentCode'

/**
 * Roster CSV import. Expected header row (case-insensitive, any order):
 *   student_id, first_name, last_name, class, active (optional)
 * Common alternative header names are accepted (see HEADER_ALIASES).
 */
const HEADER_ALIASES = {
  student_code: ['student_id', 'student id', 'student_code', 'id', 'studentid', 'student number', 'student_number'],
  first_name: ['first_name', 'firstname', 'first name', 'given_name', 'given name'],
  last_name: ['last_name', 'lastname', 'last name', 'surname', 'family_name', 'family name'],
  class_name: ['class', 'class_name', 'classname', 'form', 'grade', 'homeroom'],
  active: ['active', 'status', 'enrolled'],
}

const TRUE_VALUES = ['', 'true', 'yes', 'y', '1', 'active', 'enrolled']
const FALSE_VALUES = ['false', 'no', 'n', '0', 'inactive', 'left', 'withdrawn']

function mapHeaders(header) {
  const normalized = header.map((h) => h.trim().toLowerCase())
  const index = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = normalized.findIndex((h) => aliases.includes(h))
    if (i >= 0) index[field] = i
  }
  return index
}

/**
 * Parse and validate roster CSV text.
 * Returns { rows, errors } where rows are ready for import_students() and
 * errors are { line, message } (line numbers match the file, header = line 1).
 * Nothing should be imported while errors is non-empty.
 */
export function parseRoster(text) {
  const table = parseCsv(text)
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: 'The file is empty.' }] }

  const index = mapHeaders(table[0])
  const missing = ['student_code', 'first_name', 'last_name'].filter((f) => index[f] === undefined)
  if (missing.length) {
    const names = { student_code: 'student_id', first_name: 'first_name', last_name: 'last_name' }
    return {
      rows: [],
      errors: [{ line: 1, message: `Missing column(s): ${missing.map((m) => names[m]).join(', ')}` }],
    }
  }

  const rows = []
  const errors = []
  const seen = new Map()
  const get = (cells, field) => (index[field] === undefined ? '' : (cells[index[field]] ?? '').trim())

  table.slice(1).forEach((cells, i) => {
    const line = i + 2
    const code = normalizeStudentCode(get(cells, 'student_code'))
    const first = get(cells, 'first_name')
    const last = get(cells, 'last_name')
    const className = get(cells, 'class_name')
    const activeRaw = get(cells, 'active').toLowerCase()

    const problems = []
    if (!isValidStudentCode(code)) problems.push(`invalid student ID “${code}” (use 1–32 letters, digits, - or _)`)
    if (!first) problems.push('first name is missing')
    if (!last) problems.push('last name is missing')
    if (first.length > 100 || last.length > 100) problems.push('name is longer than 100 characters')
    if (className.length > 50) problems.push('class is longer than 50 characters')

    let active = true
    if (FALSE_VALUES.includes(activeRaw)) active = false
    else if (!TRUE_VALUES.includes(activeRaw)) problems.push(`active must be yes/no, got “${activeRaw}”`)

    if (seen.has(code)) problems.push(`duplicate student ID (also on line ${seen.get(code)})`)
    else seen.set(code, line)

    if (problems.length) errors.push({ line, message: problems.join('; ') })
    else rows.push({ student_code: code, first_name: first, last_name: last, class_name: className, active })
  })

  if (rows.length === 0 && errors.length === 0) errors.push({ line: 2, message: 'No students found in the file.' })
  return { rows, errors }
}

export const ROSTER_TEMPLATE = 'student_id,first_name,last_name,class,active\r\nS0001,Jane,Example,5A,yes\r\n'
