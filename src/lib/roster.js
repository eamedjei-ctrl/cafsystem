import { parseCsv } from './csv'
import { isValidStudentCode, normalizeStudentCode } from './studentCode'

/**
 * Roster CSV import. Expected header row (case-insensitive, any order):
 *   student_id, first_name, last_name, plan (optional), active (optional)
 * "plan" accepts a plan code or name (e.g. "twice", "Twice a day") or the
 * number of meals per day ("1", "2", "3"). Leave the column out to keep each
 * student's current plan; leave a cell blank to clear that student's plan.
 * Common alternative header names are accepted (see HEADER_ALIASES). Other
 * columns (such as an old "class" column) are ignored.
 */
const HEADER_ALIASES = {
  student_code: ['student_id', 'student id', 'student_code', 'id', 'studentid', 'student number', 'student_number'],
  first_name: ['first_name', 'firstname', 'first name', 'given_name', 'given name'],
  last_name: ['last_name', 'lastname', 'last name', 'surname', 'family_name', 'family name'],
  active: ['active', 'status', 'enrolled'],
  plan_code: ['plan', 'plan_code', 'feeding_plan', 'feeding plan', 'meal_plan', 'meal plan', 'meals_per_day', 'meals per day', 'section'],
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
/** Map a CSV plan value to a plan code. Returns undefined if it matches nothing. */
export function resolvePlan(value, plans) {
  const v = value.trim().toLowerCase()
  if (v === '' || v === 'none') return null
  const byCodeOrLabel = plans.find((p) => p.code === v || p.label.toLowerCase() === v)
  if (byCodeOrLabel) return byCodeOrLabel.code
  const words = { once: 1, twice: 2, thrice: 3, '1': 1, '2': 2, '3': 3 }
  const n = words[v] ?? words[v.replace(/\s*(a day|per day|times?|x)$/, '')]
  const byCount = plans.filter((p) => p.meals_per_day === n)
  return byCount.length === 1 ? byCount[0].code : undefined
}

export function parseRoster(text, plans = []) {
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
    const activeRaw = get(cells, 'active').toLowerCase()
    const planRaw = get(cells, 'plan_code')
    const planCode = index.plan_code === undefined ? undefined : resolvePlan(planRaw, plans)

    const problems = []
    if (!isValidStudentCode(code)) problems.push(`invalid student ID “${code}” (use 1–32 letters, digits, - or _)`)
    if (!first) problems.push('first name is missing')
    if (!last) problems.push('last name is missing')
    if (first.length > 100 || last.length > 100) problems.push('name is longer than 100 characters')

    let active = true
    if (FALSE_VALUES.includes(activeRaw)) active = false
    else if (!TRUE_VALUES.includes(activeRaw)) problems.push(`active must be yes/no, got “${activeRaw}”`)

    if (index.plan_code !== undefined && planCode === undefined) {
      problems.push(`unknown plan “${planRaw}” (use ${plans.map((p) => p.code).join(', ') || 'a plan code'}, or leave blank)`)
    }

    if (seen.has(code)) problems.push(`duplicate student ID (also on line ${seen.get(code)})`)
    else seen.set(code, line)

    if (problems.length) errors.push({ line, message: problems.join('; ') })
    else {
      const row = { student_code: code, first_name: first, last_name: last, active }
      if (index.plan_code !== undefined) row.plan_code = planCode
      rows.push(row)
    }
  })

  if (rows.length === 0 && errors.length === 0) errors.push({ line: 2, message: 'No students found in the file.' })
  return { rows, errors }
}

export const ROSTER_TEMPLATE =
  'student_id,first_name,last_name,plan,active\r\nS0001,Jane,Example,twice,yes\r\nS0002,John,Sample,thrice,yes\r\n'
