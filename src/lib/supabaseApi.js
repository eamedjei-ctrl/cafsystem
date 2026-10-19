/**
 * All database access goes through this module. Every call runs as the
 * signed-in staff member, so the database's RLS policies and function checks
 * decide what is allowed.
 */
import { supabase } from './supabase'

export const PAGE_SIZE = 50
const EXPORT_LIMIT = 50_000

/** Throw a readable Error for a Supabase error, otherwise return data. */
function unwrap({ data, error, count }) {
  if (error) {
    const message =
      error.code === '42501' || /permission denied|row-level security/i.test(error.message)
        ? 'You do not have permission to do this.'
        : error.message
    throw new Error(message)
  }
  return count === undefined || count === null ? data : { data, count }
}

/** Keep only characters that are safe inside a PostgREST filter expression. */
export function sanitizeSearch(text) {
  return String(text ?? '')
    .replace(/[^\p{L}\p{N}\s'._-]/gu, ' ')
    .trim()
    .slice(0, 50)
}

function applyNameSearch(query, search) {
  // Every word must match the student ID, first name or last name.
  for (const term of sanitizeSearch(search).split(/\s+/).filter(Boolean)) {
    query = query.or(`student_code.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
  }
  return query
}

// ---------------------------------------------------------------------------
// Settings and meal periods
// ---------------------------------------------------------------------------
export async function getSettings() {
  return unwrap(await supabase.from('app_settings').select('school_name, timezone').single())
}

export async function getMealPeriods() {
  return unwrap(
    await supabase
      .from('meal_periods')
      .select('code, label, starts_at, ends_at, sort_order, active')
      .order('sort_order'),
  )
}

export async function getSchoolToday() {
  return unwrap(await supabase.rpc('school_today'))
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------
export async function checkIn(studentCode, mealPeriod, method = 'scan') {
  return unwrap(
    await supabase.rpc('check_in', { p_student_code: studentCode, p_meal_period: mealPeriod, p_method: method }),
  )
}

export async function searchStudents(query) {
  return unwrap(await supabase.rpc('search_students', { p_query: query, p_limit: 15 }))
}

// ---------------------------------------------------------------------------
// Meal records (supervisor / admin)
// ---------------------------------------------------------------------------
function recordsQuery(filters, select, opts) {
  let q = supabase.from('meal_record_details').select(select, opts)
  if (filters.from) q = q.gte('service_date', filters.from)
  if (filters.to) q = q.lte('service_date', filters.to)
  if (filters.mealPeriod) q = q.eq('meal_period', filters.mealPeriod)
  if (filters.className) q = q.eq('class_name', filters.className)
  if (filters.status === 'active') q = q.eq('voided', false)
  if (filters.status === 'voided') q = q.eq('voided', true)
  if (filters.search) q = applyNameSearch(q, filters.search)
  return q
}

export async function listRecords(filters, page = 0) {
  const from = page * PAGE_SIZE
  return unwrap(
    await recordsQuery(filters, '*', { count: 'exact' })
      .order('checked_in_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
  )
}

/** Count of matching records per meal period (for the summary bar). */
export async function countRecordsByPeriod(filters, periods) {
  const counts = await Promise.all(
    periods.map(async (p) => {
      const { count } = unwrap(
        await recordsQuery({ ...filters, mealPeriod: p.code }, 'id', { count: 'exact', head: true }),
      )
      return [p.code, count ?? 0]
    }),
  )
  return Object.fromEntries(counts)
}

/** Fetch every matching record (paged) for CSV export. */
export async function fetchAllRecords(filters, onProgress) {
  const all = []
  const batch = 1000
  for (let from = 0; from < EXPORT_LIMIT; from += batch) {
    const rows = unwrap(
      await recordsQuery(filters, '*')
        .order('service_date')
        .order('checked_in_at')
        .order('id')
        .range(from, from + batch - 1),
    )
    all.push(...rows)
    onProgress?.(all.length)
    if (rows.length < batch) return all
  }
  throw new Error(`More than ${EXPORT_LIMIT.toLocaleString()} records match. Narrow the date range and try again.`)
}

export async function correctRecord({ id, reason, mealPeriod = null, serviceDate = null, voided = null }) {
  return unwrap(
    await supabase.rpc('correct_meal_record', {
      p_record_id: id,
      p_reason: reason,
      p_meal_period: mealPeriod,
      p_service_date: serviceDate,
      p_voided: voided,
    }),
  )
}

export async function addRecord({ studentCode, mealPeriod, serviceDate, reason }) {
  return unwrap(
    await supabase.rpc('add_meal_record', {
      p_student_code: studentCode,
      p_meal_period: mealPeriod,
      p_service_date: serviceDate,
      p_reason: reason,
    }),
  )
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------
export async function listStudents({ search, className, includeInactive }, page = 0) {
  const from = page * PAGE_SIZE
  let q = supabase.from('students').select('*', { count: 'exact' })
  if (!includeInactive) q = q.eq('active', true)
  if (className) q = q.eq('class_name', className)
  if (search) q = applyNameSearch(q, search)
  return unwrap(
    await q
      .order('last_name')
      .order('first_name')
      .range(from, from + PAGE_SIZE - 1),
  )
}

export async function listClasses() {
  const rows = unwrap(await supabase.from('students').select('class_name').neq('class_name', '').limit(10000))
  return [...new Set(rows.map((r) => r.class_name))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

export async function saveStudent(student) {
  const fields = {
    student_code: student.student_code,
    first_name: student.first_name,
    last_name: student.last_name,
    class_name: student.class_name,
    active: student.active,
  }
  if (student.id) return unwrap(await supabase.from('students').update(fields).eq('id', student.id).select().single())
  return unwrap(await supabase.from('students').insert(fields).select().single())
}

/** Import validated roster rows in batches. Returns summed counts. */
export async function importStudents(rows, onProgress) {
  const totals = { total: 0, inserted: 0, updated: 0, unchanged: 0 }
  const batch = 1000
  for (let i = 0; i < rows.length; i += batch) {
    const result = unwrap(await supabase.rpc('import_students', { p_rows: rows.slice(i, i + batch) }))
    for (const k of Object.keys(totals)) totals[k] += result[k]
    onProgress?.(Math.min(i + batch, rows.length))
  }
  return totals
}

// ---------------------------------------------------------------------------
// Staff (admin)
// ---------------------------------------------------------------------------
export async function getOwnProfile(userId) {
  return unwrap(await supabase.from('staff_profiles').select('*').eq('id', userId).maybeSingle())
}

export async function listStaff() {
  return unwrap(await supabase.from('staff_profiles').select('*').order('email'))
}

export async function updateStaff(id, changes) {
  return unwrap(await supabase.from('staff_profiles').update(changes).eq('id', id).select().single())
}

// ---------------------------------------------------------------------------
// Audit log (supervisor / admin)
// ---------------------------------------------------------------------------
export async function listAudit({ table, from, to }, page = 0, timeZone = 'UTC') {
  const start = page * PAGE_SIZE
  let q = supabase.from('audit_log').select('*', { count: 'exact' })
  if (table) q = q.eq('table_name', table)
  if (from) q = q.gte('changed_at', zonedDayStart(from, timeZone))
  if (to) q = q.lt('changed_at', zonedDayStart(addDays(to, 1), timeZone))
  return unwrap(await q.order('changed_at', { ascending: false }).range(start, start + PAGE_SIZE - 1))
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** ISO timestamp of local midnight of `isoDate` in `timeZone`. */
export function zonedDayStart(isoDate, timeZone) {
  const utcMidnight = new Date(`${isoDate}T00:00:00Z`)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(utcMidnight)
      .map((p) => [p.type, p.value]),
  )
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const offset = asIfUtc - utcMidnight.getTime()
  return new Date(utcMidnight.getTime() - offset).toISOString()
}
