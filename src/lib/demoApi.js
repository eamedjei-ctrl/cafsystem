/**
 * DEMO MODE backend (VITE_DEMO_MODE=true).
 *
 * An in-browser stand-in for Supabase so the app can be tried without a
 * database. It implements the same functions as supabaseApi.js and mirrors the
 * database rules (roles, one meal per period per day, reasons for corrections,
 * audit log, last-admin safeguard).
 *
 * All data is fictional and lives only in this browser's localStorage. This is
 * NOT a security boundary: anyone can edit browser storage. Never use demo
 * mode for real students.
 */
import { addDays } from './supabaseApi'
import { isValidStudentCode, normalizeStudentCode } from './studentCode'

export const PAGE_SIZE = 50
const STATE_KEY = 'cafDemo.state.v2'
const SESSION_KEY = 'cafDemo.session.v1'
const DENIED = 'You do not have permission to do this.'

export const DEMO_PASSWORD = 'demo-password-1'
export const DEMO_ACCOUNTS = [
  { id: 'demo-user-tablet', email: 'tablet@demo.school', full_name: 'Cafeteria Tablet', role: 'checkin' },
  { id: 'demo-user-supervisor', email: 'supervisor@demo.school', full_name: 'Sam Supervisor', role: 'supervisor' },
  { id: 'demo-user-admin', email: 'admin@demo.school', full_name: 'Alex Admin', role: 'admin' },
]

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
// localStorage when available; otherwise (private mode, tests) memory only.
const memory = new Map()
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return memory.get(key) ?? null
    }
  },
  set(key, value) {
    try {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      if (value === null) memory.delete(key)
      else memory.set(key, value)
    }
  },
}

/** Small deterministic PRNG so every fresh demo has the same sample data. */
function rng(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function todayIn(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function buildInitialState() {
  const random = rng(42)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const first = ['Ama', 'Kofi', 'Esi', 'Kwame', 'Abena', 'Yaw', 'Akosua', 'Kojo', 'Adwoa', 'Kwabena', 'Efua', 'Kwaku', 'Afua', 'Fiifi', 'Yaa', 'Nana', 'Maya', 'Leo', 'Sofia', 'Noah', 'Zara', 'Ethan', 'Lina', 'Omar', 'Ivy', 'Theo', 'Ruby', 'Felix', 'Nia', 'Jonah']
  const last = ['Sample', 'Example', 'Testperson', 'Demo', 'Placeholder', 'Fakename', 'Mockley', 'Trial', 'Specimen', 'Dummy']
  const classes = ['4A', '4B', '5A', '5B', '6A', '6B']
  const now = new Date().toISOString()

  const students = Array.from({ length: 60 }, (_, i) => ({
    id: `demo-student-${i + 1}`,
    student_code: `DEMO${String(i + 1).padStart(4, '0')}`,
    first_name: pick(first),
    last_name: pick(last),
    class_name: classes[i % classes.length],
    active: i < 58, // DEMO0059 and DEMO0060 are inactive
    // Mix of once / twice / thrice a day; DEMO0057-DEMO0060 have no plan.
    plan_code: i + 1 <= 56 ? ['once', 'twice', 'thrice', 'thrice'][(i + 1) % 4] : null,
    created_at: now,
    updated_at: now,
  }))

  const settings = { school_name: 'Demo Primary School (sample data)', timezone: 'Africa/Accra' }
  const periods = [
    { code: 'breakfast', label: 'Breakfast', starts_at: '06:30:00', ends_at: '09:30:00', sort_order: 10, active: true },
    { code: 'lunch', label: 'Lunch', starts_at: '11:00:00', ends_at: '14:00:00', sort_order: 20, active: true },
    { code: 'snack', label: 'After-school snack', starts_at: '14:30:00', ends_at: '17:00:00', sort_order: 30, active: false },
    { code: 'supper', label: 'Supper', starts_at: '17:30:00', ends_at: '19:30:00', sort_order: 40, active: true },
  ]
  const plans = [
    { code: 'once', label: 'Once a day', meals_per_day: 1, sort_order: 10, periods: ['lunch'] },
    { code: 'twice', label: 'Twice a day', meals_per_day: 2, sort_order: 20, periods: ['breakfast', 'lunch'] },
    { code: 'thrice', label: 'Thrice a day', meals_per_day: 3, sort_order: 30, periods: ['breakfast', 'lunch', 'supper'] },
  ]
  const planPeriods = Object.fromEntries(plans.map((pl) => [pl.code, pl.periods]))

  // A few past school days of history so the dashboard has something to show.
  const records = []
  const today = todayIn(settings.timezone)
  for (let back = 6; back >= 1; back--) {
    const day = addDays(today, -back)
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
    if (dow === 0 || dow === 6) continue
    for (const period of periods.filter((p) => p.active)) {
      const [h, m] = period.starts_at.split(':').map(Number)
      for (const s of students.filter((st) => st.active)) {
        if (s.plan_code && !planPeriods[s.plan_code].includes(period.code)) continue
        if (random() > 0.85) continue
        const at = new Date(`${day}T00:00:00Z`)
        at.setUTCMinutes(h * 60 + m + Math.floor(random() * 90))
        records.push({
          id: uid(),
          student_id: s.id,
          meal_period: period.code,
          service_date: day,
          checked_in_at: at.toISOString(),
          method: random() < 0.06 ? 'manual' : 'scan',
          recorded_by: 'demo-user-tablet',
          plan_code: s.plan_code,
          voided: false,
          void_reason: null,
          voided_at: null,
          voided_by: null,
          updated_at: at.toISOString(),
        })
      }
    }
  }

  return {
    settings,
    periods,
    plans,
    students,
    records,
    staff: DEMO_ACCOUNTS.map((a) => ({ ...a, active: true, created_at: now })),
    audit: [],
    auditSeq: 0,
  }
}

let state = null
function db() {
  if (!state) {
    try {
      state = JSON.parse(storage.get(STATE_KEY)) ?? null
    } catch {
      state = null
    }
    if (!state) {
      state = buildInitialState()
      save()
    }
  }
  return state
}
function save() {
  storage.set(STATE_KEY, JSON.stringify(state))
}

/** Wipe demo data and start again from the sample data. */
export function resetDemo() {
  state = buildInitialState()
  save()
}

const delay = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const clone = (v) => JSON.parse(JSON.stringify(v))

// ---------------------------------------------------------------------------
// Auth (mimics the parts of supabase.auth the app uses)
// ---------------------------------------------------------------------------
const listeners = new Set()

function currentSession() {
  try {
    return JSON.parse(storage.get(SESSION_KEY))
  } catch {
    return null
  }
}

function emit(event, session) {
  for (const cb of listeners) cb(event, session)
}

export const auth = {
  async getSession() {
    return { data: { session: currentSession() }, error: null }
  },
  onAuthStateChange(callback) {
    listeners.add(callback)
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }
  },
  async signInWithPassword({ email, password }) {
    await delay(150)
    const account = db().staff.find((s) => s.email.toLowerCase() === String(email).toLowerCase())
    if (!account || password !== DEMO_PASSWORD) return { data: null, error: { message: 'Invalid login credentials' } }
    const session = { access_token: 'demo', user: { id: account.id, email: account.email } }
    storage.set(SESSION_KEY, JSON.stringify(session))
    emit('SIGNED_IN', session)
    return { data: { session }, error: null }
  },
  async signOut() {
    storage.set(SESSION_KEY, null)
    emit('SIGNED_OUT', null)
    return { error: null }
  },
}

// ---------------------------------------------------------------------------
// Role checks (same rules as the database)
// ---------------------------------------------------------------------------
function me() {
  const session = currentSession()
  const profile = session && db().staff.find((s) => s.id === session.user.id)
  return profile?.active && profile.role ? profile : null
}

function requireRole(...roles) {
  const profile = me()
  if (!profile || !roles.includes(profile.role)) throw new Error(DENIED)
  return profile
}

function requireReason(reason) {
  const r = String(reason ?? '').trim()
  if (r.length < 3) throw new Error('A reason of at least 3 characters is required.')
  if (r.length > 500) throw new Error('Reason must be 500 characters or fewer.')
  return r
}

const today = () => todayIn(db().settings.timezone)

function audit(table, recordId, action, oldData, newData, reason) {
  const s = db()
  s.auditSeq += 1
  s.audit.push({
    id: s.auditSeq,
    table_name: table,
    record_id: recordId,
    action,
    old_data: oldData ? clone(oldData) : null,
    new_data: newData ? clone(newData) : null,
    reason: reason ?? null,
    changed_by: me()?.id ?? null,
    changed_at: new Date().toISOString(),
  })
}

// ---------------------------------------------------------------------------
// Settings and meal periods
// ---------------------------------------------------------------------------
export async function getSettings() {
  requireRole('checkin', 'supervisor', 'admin')
  return clone(db().settings)
}

export async function getMealPeriods() {
  requireRole('checkin', 'supervisor', 'admin')
  return clone([...db().periods].sort((a, b) => a.sort_order - b.sort_order))
}

export async function getFeedingPlans() {
  requireRole('checkin', 'supervisor', 'admin')
  return clone([...db().plans].sort((a, b) => a.sort_order - b.sort_order))
}

export async function setFeedingPlan({ code, label, mealsPerDay, periods }) {
  await delay()
  requireRole('admin')
  const s = db()
  const plan = s.plans.find((pl) => pl.code === code)
  if (!plan) throw new Error('Unknown feeding plan.')
  const chosen = [...new Set(periods)]
  if (chosen.some((c) => !s.periods.some((p) => p.code === c))) throw new Error('Unknown meal period.')
  if (chosen.length === 0) throw new Error('Choose at least one meal period.')
  if (!(mealsPerDay >= 1 && mealsPerDay <= chosen.length)) {
    throw new Error(`Meals per day must be between 1 and the number of meal periods chosen (${chosen.length}).`)
  }
  const next = { ...plan, label: String(label).trim(), meals_per_day: mealsPerDay, periods: chosen }
  audit('feeding_plans', code, 'UPDATE', plan, next, 'Feeding plan updated')
  Object.assign(plan, next)
  save()
}

export async function feedingPlanSummary(from, to) {
  await delay()
  requireRole('supervisor', 'admin')
  const s = db()
  const served = (planCode) => {
    const out = {}
    for (const r of s.records) {
      if (r.voided || (r.plan_code ?? null) !== planCode || r.service_date < from || r.service_date > to) continue
      out[r.meal_period] = (out[r.meal_period] ?? 0) + 1
    }
    return out
  }
  const enrolled = (planCode) => s.students.filter((st) => st.active && (st.plan_code ?? null) === planCode).length
  return [
    ...[...s.plans]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((pl) => ({ plan_code: pl.code, plan_label: pl.label, meals_per_day: pl.meals_per_day, enrolled: enrolled(pl.code), served: served(pl.code) })),
    { plan_code: null, plan_label: 'No plan set', meals_per_day: null, enrolled: enrolled(null), served: served(null) },
  ]
}

export async function getSchoolToday() {
  requireRole('checkin', 'supervisor', 'admin')
  return today()
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------
const planOf = (st) => (st.plan_code ? db().plans.find((pl) => pl.code === st.plan_code) ?? null : null)
const summary = (st) => ({
  student_code: st.student_code,
  first_name: st.first_name,
  last_name: st.last_name,
  class_name: st.class_name,
  plan_code: planOf(st)?.code ?? null,
  plan_label: planOf(st)?.label ?? null,
})
const periodLabels = (codes) =>
  db()
    .periods.filter((p) => codes.includes(p.code))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => p.label)

export async function checkIn(studentCode, mealPeriod, method = 'scan') {
  await delay()
  const profile = requireRole('checkin', 'supervisor', 'admin')
  if (!['scan', 'manual'].includes(method)) throw new Error('Use add_meal_record for administrative entries.')
  const code = normalizeStudentCode(studentCode)
  if (!isValidStudentCode(code)) return { status: 'invalid_id', student_code: code.slice(0, 40) }

  const s = db()
  const period = s.periods.find((p) => p.code === mealPeriod)
  if (!period?.active) return { status: 'invalid_period', meal_period: mealPeriod }

  const student = s.students.find((st) => st.student_code === code)
  if (!student) return { status: 'unknown_student', student_code: code }
  if (!student.active) return { status: 'inactive_student', student: summary(student) }

  const day = today()
  const servedCount = () => s.records.filter((r) => r.service_date === day && r.meal_period === period.code && !r.voided).length
  const existing = s.records.find((r) => r.student_id === student.id && r.meal_period === period.code && r.service_date === day && !r.voided)
  if (existing) {
    return {
      status: 'duplicate',
      student: summary(student),
      meal_period: period.code,
      meal_period_label: period.label,
      first_checked_in_at: existing.checked_in_at,
      served_count: servedCount(),
    }
  }

  const plan = planOf(student)
  if (plan) {
    if (!plan.periods.includes(period.code)) {
      return {
        status: 'not_on_plan',
        student: summary(student),
        meal_period: period.code,
        meal_period_label: period.label,
        allowed_periods: periodLabels(plan.periods),
      }
    }
    const todays = s.records.filter((r) => r.student_id === student.id && r.service_date === day && !r.voided)
    if (todays.length >= plan.meals_per_day) {
      return {
        status: 'plan_limit_reached',
        student: summary(student),
        meal_period: period.code,
        meal_period_label: period.label,
        meals_today: todays.length,
        meals_per_day: plan.meals_per_day,
        meals_today_periods: periodLabels(todays.map((r) => r.meal_period)),
      }
    }
  }

  const now = new Date().toISOString()
  const record = {
    id: uid(),
    student_id: student.id,
    meal_period: period.code,
    service_date: day,
    checked_in_at: now,
    method,
    recorded_by: profile.id,
    plan_code: plan?.code ?? null,
    voided: false,
    void_reason: null,
    voided_at: null,
    voided_by: null,
    updated_at: now,
  }
  s.records.push(record)
  save()
  return {
    status: 'ok',
    student: summary(student),
    record_id: record.id,
    meal_period: period.code,
    meal_period_label: period.label,
    checked_in_at: now,
    served_count: servedCount(),
  }
}

export async function searchStudents(query) {
  await delay()
  requireRole('checkin', 'supervisor', 'admin')
  const q = String(query ?? '').trim().toLowerCase()
  if (q.length < 2) return []
  return db()
    .students.filter((s) => s.active)
    .filter((s) =>
      [s.student_code, `${s.first_name} ${s.last_name}`, `${s.last_name} ${s.first_name}`, `${s.last_name}, ${s.first_name}`].some(
        (v) => v.toLowerCase().includes(q),
      ),
    )
    .sort(byName)
    .slice(0, 15)
    .map(summary)
}

// ---------------------------------------------------------------------------
// Meal records
// ---------------------------------------------------------------------------
function byName(a, b) {
  return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
}

function matchesSearch(row, search) {
  const terms = String(search ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  return terms.every((t) => [row.student_code, row.first_name, row.last_name].some((v) => v.toLowerCase().includes(t)))
}

function details() {
  const s = db()
  const students = new Map(s.students.map((st) => [st.id, st]))
  const periods = new Map(s.periods.map((p) => [p.code, p]))
  const staff = new Map(s.staff.map((st) => [st.id, st]))
  return s.records.map((r) => {
    const st = students.get(r.student_id)
    const by = staff.get(r.recorded_by)
    return {
      id: r.id,
      service_date: r.service_date,
      meal_period: r.meal_period,
      meal_period_label: periods.get(r.meal_period)?.label ?? r.meal_period,
      checked_in_at: r.checked_in_at,
      method: r.method,
      voided: r.voided,
      void_reason: r.void_reason,
      updated_at: r.updated_at,
      student_id: st.id,
      student_code: st.student_code,
      first_name: st.first_name,
      last_name: st.last_name,
      class_name: st.class_name,
      recorded_by: r.recorded_by,
      recorded_by_name: by ? by.full_name || by.email : null,
      plan_code: r.plan_code ?? null,
      plan_label: s.plans.find((pl) => pl.code === r.plan_code)?.label ?? null,
    }
  })
}

function filterRecords(filters) {
  return details().filter(
    (r) =>
      (!filters.from || r.service_date >= filters.from) &&
      (!filters.to || r.service_date <= filters.to) &&
      (!filters.mealPeriod || r.meal_period === filters.mealPeriod) &&
      (!filters.className || r.class_name === filters.className) &&
      (!filters.planCode || (filters.planCode === 'none' ? r.plan_code === null : r.plan_code === filters.planCode)) &&
      (filters.status !== 'active' || !r.voided) &&
      (filters.status !== 'voided' || r.voided) &&
      (!filters.search || matchesSearch(r, filters.search)),
  )
}

export async function listRecords(filters, page = 0) {
  await delay()
  requireRole('supervisor', 'admin')
  const rows = filterRecords(filters).sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at))
  return { data: rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), count: rows.length }
}

export async function countRecordsByPeriod(filters, periods) {
  requireRole('supervisor', 'admin')
  const rows = filterRecords({ ...filters, mealPeriod: '' })
  return Object.fromEntries(periods.map((p) => [p.code, rows.filter((r) => r.meal_period === p.code).length]))
}

export async function fetchAllRecords(filters, onProgress) {
  await delay()
  requireRole('supervisor', 'admin')
  const rows = filterRecords(filters).sort(
    (a, b) => a.service_date.localeCompare(b.service_date) || a.checked_in_at.localeCompare(b.checked_in_at),
  )
  onProgress?.(rows.length)
  return rows
}

function slotTaken(s, studentId, mealPeriod, serviceDate, exceptId) {
  return s.records.some(
    (r) => r.id !== exceptId && !r.voided && r.student_id === studentId && r.meal_period === mealPeriod && r.service_date === serviceDate,
  )
}
const SLOT_TAKEN = 'This student already has a record for that meal period and date.'

export async function correctRecord({ id, reason, mealPeriod = null, serviceDate = null, voided = null }) {
  await delay()
  const profile = requireRole('supervisor', 'admin')
  const why = requireReason(reason)
  const s = db()
  const record = s.records.find((r) => r.id === id)
  if (!record) throw new Error('Record not found.')
  if (serviceDate && serviceDate > today()) throw new Error('Service date cannot be in the future.')
  if (mealPeriod && !s.periods.some((p) => p.code === mealPeriod)) throw new Error('Unknown meal period.')

  const next = { ...record }
  if (mealPeriod) next.meal_period = mealPeriod
  if (serviceDate) next.service_date = serviceDate
  if (voided === true && !record.voided) Object.assign(next, { voided: true, voided_at: new Date().toISOString(), voided_by: profile.id })
  if (voided === true) next.void_reason = why
  if (voided === false) Object.assign(next, { voided: false, void_reason: null, voided_at: null, voided_by: null })
  if (!next.voided && slotTaken(s, next.student_id, next.meal_period, next.service_date, next.id)) throw new Error(SLOT_TAKEN)

  next.updated_at = new Date().toISOString()
  audit('meal_records', id, 'UPDATE', record, next, why)
  Object.assign(record, next)
  save()
}

export async function addRecord({ studentCode, mealPeriod, serviceDate, reason }) {
  await delay()
  const profile = requireRole('supervisor', 'admin')
  const why = requireReason(reason)
  const s = db()
  if (!serviceDate || serviceDate > today()) throw new Error('Service date cannot be in the future.')
  const student = s.students.find((st) => st.student_code === normalizeStudentCode(studentCode))
  if (!student) throw new Error('No student with that ID.')
  if (!s.periods.some((p) => p.code === mealPeriod)) throw new Error('Unknown meal period.')
  if (slotTaken(s, student.id, mealPeriod, serviceDate)) throw new Error(SLOT_TAKEN)

  const now = new Date().toISOString()
  const record = {
    id: uid(),
    student_id: student.id,
    meal_period: mealPeriod,
    service_date: serviceDate,
    checked_in_at: now,
    method: 'admin',
    recorded_by: profile.id,
    plan_code: student.plan_code ?? null,
    voided: false,
    void_reason: null,
    voided_at: null,
    voided_by: null,
    updated_at: now,
  }
  s.records.push(record)
  audit('meal_records', record.id, 'INSERT', null, record, why)
  save()
  return record.id
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------
const planMatches = (st, planCode) =>
  !planCode || (planCode === 'none' ? !st.plan_code : st.plan_code === planCode)

export async function listStudents({ search, className, includeInactive, planCode }, page = 0) {
  await delay()
  requireRole('supervisor', 'admin')
  const rows = db()
    .students.filter((s) => (includeInactive || s.active) && (!className || s.class_name === className))
    .filter((s) => planMatches(s, planCode))
    .filter((s) => !search || matchesSearch(s, search))
    .sort(byName)
  return { data: clone(rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)), count: rows.length }
}

export async function countStudentsByPlan(plans, { includeInactive } = {}) {
  requireRole('supervisor', 'admin')
  const students = db().students.filter((s) => includeInactive || s.active)
  return Object.fromEntries(
    [...plans.map((pl) => pl.code), 'none'].map((code) => [code, students.filter((s) => planMatches(s, code)).length]),
  )
}

export async function listClasses() {
  requireRole('supervisor', 'admin')
  return [...new Set(db().students.map((s) => s.class_name).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )
}

function validateStudent(st) {
  const clean = {
    student_code: normalizeStudentCode(st.student_code),
    first_name: String(st.first_name ?? '').trim(),
    last_name: String(st.last_name ?? '').trim(),
    class_name: String(st.class_name ?? '').trim(),
    active: st.active ?? true,
  }
  if ('plan_code' in st) {
    clean.plan_code = st.plan_code ? String(st.plan_code).trim().toLowerCase() : null
    if (clean.plan_code && !db().plans.some((pl) => pl.code === clean.plan_code)) {
      throw new Error(`Unknown feeding plan “${clean.plan_code}”.`)
    }
  }
  if (!isValidStudentCode(clean.student_code)) throw new Error(`Invalid student ID “${clean.student_code}”.`)
  if (!clean.first_name || !clean.last_name) throw new Error('First and last name are required.')
  return clean
}

export async function saveStudent(student) {
  await delay()
  requireRole('admin')
  const s = db()
  const clean = validateStudent(student)
  const clash = s.students.find((st) => st.student_code === clean.student_code && st.id !== student.id)
  if (clash) throw new Error('duplicate key value violates unique constraint "students_student_code_key"')
  const now = new Date().toISOString()
  if (student.id) {
    const existing = s.students.find((st) => st.id === student.id)
    const next = { ...existing, ...clean, updated_at: now }
    audit('students', existing.id, 'UPDATE', existing, next)
    Object.assign(existing, next)
    save()
    return clone(existing)
  }
  const created = { id: uid(), plan_code: null, ...clean, created_at: now, updated_at: now }
  s.students.push(created)
  audit('students', created.id, 'INSERT', null, created)
  save()
  return clone(created)
}

export async function importStudents(rows, onProgress) {
  await delay(200)
  requireRole('admin')
  if (rows.length > 5000) throw new Error('Import at most 5000 students per batch.')
  const s = db()
  const cleaned = rows.map(validateStudent) // all-or-nothing: validate everything first
  const totals = { total: rows.length, inserted: 0, updated: 0, unchanged: 0 }
  const fields = ['first_name', 'last_name', 'class_name', 'active', ...(rows.some((r) => 'plan_code' in r) ? ['plan_code'] : [])]
  const now = new Date().toISOString()
  for (const row of cleaned) {
    const existing = s.students.find((st) => st.student_code === row.student_code)
    if (!existing) {
      const created = { id: uid(), plan_code: null, ...row, created_at: now, updated_at: now }
      s.students.push(created)
      audit('students', created.id, 'INSERT', null, created, 'Roster import')
      totals.inserted++
    } else if (fields.some((k) => (existing[k] ?? null) !== (row[k] ?? null))) {
      const next = { ...existing, ...row, updated_at: now }
      audit('students', existing.id, 'UPDATE', existing, next, 'Roster import')
      Object.assign(existing, next)
      totals.updated++
    } else {
      totals.unchanged++
    }
  }
  save()
  onProgress?.(rows.length)
  return totals
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export async function getOwnProfile(userId) {
  const session = currentSession()
  if (!session || session.user.id !== userId) return null
  return clone(db().staff.find((s) => s.id === userId) ?? null)
}

export async function listStaff() {
  requireRole('supervisor', 'admin')
  return clone([...db().staff].sort((a, b) => a.email.localeCompare(b.email)))
}

export async function updateStaff(id, changes) {
  await delay()
  requireRole('admin')
  const s = db()
  const member = s.staff.find((st) => st.id === id)
  if (!member) throw new Error('Staff member not found.')
  const next = { ...member, ...changes }
  const losingAdmin = member.role === 'admin' && member.active && (next.role !== 'admin' || !next.active)
  if (losingAdmin && !s.staff.some((st) => st.id !== id && st.role === 'admin' && st.active)) {
    throw new Error('At least one active admin is required.')
  }
  audit('staff_profiles', id, 'UPDATE', member, next)
  Object.assign(member, next)
  save()
  return clone(member)
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export async function listAudit({ table, from, to }, page = 0, timeZone = 'UTC') {
  await delay()
  requireRole('supervisor', 'admin')
  const rows = db()
    .audit.filter((a) => !table || a.table_name === table)
    .filter((a) => {
      const day = todayIn(timeZone, new Date(a.changed_at))
      return (!from || day >= from) && (!to || day <= to)
    })
    .sort((a, b) => b.id - a.id)
  return { data: clone(rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)), count: rows.length }
}
