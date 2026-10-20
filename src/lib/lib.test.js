import { describe, expect, it } from 'vitest'
import { ScanBuffer, RepeatGuard } from './scanner'
import { normalizeStudentCode, isValidStudentCode } from './studentCode'
import { suggestMealPeriod } from './mealPeriods'
import { escapeCell, parseCsv, toCsv } from './csv'
import { can, homePath } from './permissions'
import { describeCheckIn } from './checkinMessages'
import { parseRoster } from './roster'
import { CHIT_COLORS, chitFor } from './chits'

/** Simulate typing a string, `gap` ms per key, followed by a terminator. */
function type(buffer, text, { start = 0, gap = 10, end = 'Enter' } = {}) {
  let t = start
  let result = null
  for (const ch of text) result = buffer.push(ch, (t += gap)) ?? result
  return buffer.push(end, (t += gap)) ?? result
}

describe('ScanBuffer (keyboard-wedge scanner input)', () => {
  it('emits a scan when Enter follows fast input', () => {
    expect(type(new ScanBuffer(), 'S1001')).toEqual({ code: 'S1001', fromScanner: true })
  })

  it('accepts Tab as a terminator', () => {
    expect(type(new ScanBuffer(), 'S1001', { end: 'Tab' })?.code).toBe('S1001')
  })

  it('marks slow human typing as not from a scanner, but still accepts it', () => {
    expect(type(new ScanBuffer(), 'S1001', { gap: 200 })).toEqual({ code: 'S1001', fromScanner: false })
  })

  it('ignores modifier and navigation keys', () => {
    const b = new ScanBuffer()
    for (const k of ['Shift', 'S', 'Shift', '1', 'ArrowLeft', '0', 'F5', '1']) b.push(k, 1)
    expect(b.pending).toBe('S101')
  })

  it('discards stale keystrokes after a pause', () => {
    const b = new ScanBuffer({ resetAfterMs: 500 })
    b.push('x', 0)
    expect(type(b, 'S1001', { start: 2000 })?.code).toBe('S1001')
  })

  it('ignores Enter with nothing buffered', () => {
    expect(new ScanBuffer().push('Enter', 0)).toBeNull()
  })

  it('handles Backspace and Escape', () => {
    const b = new ScanBuffer()
    'S10X'.split('').forEach((k, i) => b.push(k, i))
    b.push('Backspace', 5)
    expect(b.pending).toBe('S10')
    b.push('Escape', 6)
    expect(b.pending).toBe('')
  })

  it('drops input longer than maxLength', () => {
    const b = new ScanBuffer({ maxLength: 5 })
    expect(type(b, '1234567')?.code).toBe('7')
  })
})

describe('RepeatGuard', () => {
  it('suppresses the same code within the window only', () => {
    const g = new RepeatGuard(3000)
    expect(g.shouldIgnore('S1', 0)).toBe(false)
    expect(g.shouldIgnore('S1', 500)).toBe(true)
    expect(g.shouldIgnore('S2', 600)).toBe(false)
    expect(g.shouldIgnore('S1', 700)).toBe(false)
    expect(g.shouldIgnore('S1', 5000)).toBe(false)
  })
})

describe('student codes', () => {
  it('normalises case and whitespace', () => {
    expect(normalizeStudentCode('  s1001 ')).toBe('S1001')
  })

  it('extracts IDs from URL and prefixed QR payloads', () => {
    expect(normalizeStudentCode('https://school.example/id/s1234')).toBe('S1234')
    expect(normalizeStudentCode('https://school.example/card?id=ab-9')).toBe('AB-9')
    expect(normalizeStudentCode('STUDENT:S77')).toBe('S77')
  })

  it('validates the allowed format', () => {
    expect(isValidStudentCode('S1001')).toBe(true)
    expect(isValidStudentCode('A_B-1')).toBe(true)
    expect(isValidStudentCode('')).toBe(false)
    expect(isValidStudentCode('S 1001')).toBe(false)
    expect(isValidStudentCode('X'.repeat(33))).toBe(false)
    expect(isValidStudentCode("S1'--")).toBe(false)
  })
})

describe('suggestMealPeriod', () => {
  const periods = [
    { code: 'lunch', label: 'Lunch', starts_at: '11:00:00', ends_at: '14:00:00', sort_order: 20, active: true },
    { code: 'breakfast', label: 'Breakfast', starts_at: '06:30:00', ends_at: '09:30:00', sort_order: 10, active: true },
    { code: 'snack', label: 'Snack', starts_at: '14:30:00', ends_at: '17:00:00', sort_order: 30, active: false },
  ]
  const at = (hhmm) => new Date(`2026-10-19T${hhmm}:00Z`)

  it('picks the period in progress', () => {
    expect(suggestMealPeriod(periods, at('07:00'), 'UTC')?.code).toBe('breakfast')
    expect(suggestMealPeriod(periods, at('12:30'), 'UTC')?.code).toBe('lunch')
  })

  it('picks the next period between services', () => {
    expect(suggestMealPeriod(periods, at('10:00'), 'UTC')?.code).toBe('lunch')
    expect(suggestMealPeriod(periods, at('05:00'), 'UTC')?.code).toBe('breakfast')
  })

  it('falls back to the last active period late in the day, skipping inactive ones', () => {
    expect(suggestMealPeriod(periods, at('15:00'), 'UTC')?.code).toBe('lunch')
  })

  it('uses the school time zone, not the device time zone', () => {
    // 05:00 UTC is 07:00 in Africa/Johannesburg (UTC+2)
    expect(suggestMealPeriod(periods, at('05:00'), 'Africa/Johannesburg')?.code).toBe('breakfast')
  })

  it('returns null with no active periods', () => {
    expect(suggestMealPeriod([], at('12:00'), 'UTC')).toBeNull()
  })
})

describe('CSV', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(escapeCell('Mensah, Ama')).toBe('"Mensah, Ama"')
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCell(null)).toBe('')
  })

  it('neutralises spreadsheet formulas but keeps negative numbers', () => {
    expect(escapeCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(escapeCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(escapeCell('+1')).toBe("'+1")
    expect(escapeCell('-5')).toBe('-5')
  })

  it('round-trips through the parser', () => {
    const csv = toCsv(['a', 'b'], [['1, 2', 'line\nbreak'], ['x', 'y']])
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['1, 2', 'line\nbreak'], ['x', 'y']])
  })
})

describe('roster import validation', () => {
  it('maps common header names and normalises IDs', () => {
    const { rows, errors } = parseRoster('Student ID,First Name,Surname,Class\ns1,Ama,Mensah,5A\n')
    expect(errors).toEqual([])
    expect(rows).toEqual([{ student_code: 'S1', first_name: 'Ama', last_name: 'Mensah', active: true }])
  })

  it('reports missing columns', () => {
    expect(parseRoster('id,name\n1,Ama').errors[0].message).toMatch(/first_name, last_name/)
  })

  it('reports bad rows with file line numbers, including duplicates', () => {
    const { errors } = parseRoster(
      'student_id,first_name,last_name,active\nS1,Ama,Mensah,yes\nBAD ID,Kofi,Owusu,yes\nS1,Esi,,maybe\n',
    )
    expect(errors.map((e) => e.line)).toEqual([3, 4])
    expect(errors[1].message).toMatch(/last name is missing/)
    expect(errors[1].message).toMatch(/active must be yes\/no/)
    expect(errors[1].message).toMatch(/duplicate student ID \(also on line 2\)/)
  })

  it('reads the active column', () => {
    const { rows } = parseRoster('student_id,first_name,last_name,active\nS1,A,B,no\nS2,C,D,\n')
    expect(rows.map((r) => r.active)).toEqual([false, true])
  })
})

describe('permissions (UI)', () => {
  it('limits check-in staff to the check-in screen', () => {
    expect(can('checkin', 'checkIn')).toBe(true)
    expect(can('checkin', 'viewRecords')).toBe(false)
    expect(can('checkin', 'exportRecords')).toBe(false)
    expect(homePath('checkin')).toBe('/check-in')
  })

  it('lets supervisors correct and export but not manage roster or staff', () => {
    expect(can('supervisor', 'correctRecords')).toBe(true)
    expect(can('supervisor', 'exportRecords')).toBe(true)
    expect(can('supervisor', 'manageStudents')).toBe(false)
    expect(can('supervisor', 'manageStaff')).toBe(false)
  })

  it('gives admins everything and no-role users nothing', () => {
    expect(can('admin', 'manageStaff')).toBe(true)
    expect(can(null, 'checkIn')).toBe(false)
    expect(homePath(null)).toBe('/no-access')
  })
})

describe('check-in messages', () => {
  const student = { student_code: 'S1', first_name: 'Ama', last_name: 'Mensah' }

  it('confirms with the student name', () => {
    const m = describeCheckIn(
      { status: 'ok', student, record_id: 'r', meal_period: 'lunch', meal_period_label: 'Lunch', checked_in_at: '2026-10-19T12:00:00Z', served_count: 1 },
      'UTC',
    )
    expect(m).toMatchObject({ tone: 'success', title: 'Ama Mensah', detail: 'Checked in for Lunch' })
  })

  it('explains a duplicate including the original time', () => {
    const m = describeCheckIn(
      { status: 'duplicate', student, meal_period: 'lunch', meal_period_label: 'Lunch', first_checked_in_at: '2026-10-19T12:04:00Z', served_count: 3 },
      'UTC',
    )
    expect(m.tone).toBe('warning')
    expect(m.title).toContain('Ama Mensah')
    expect(m.detail).toMatch(/12:04/)
    expect(m.detail).toMatch(/No new record/)
  })

  it('gives clear errors for unknown and invalid IDs', () => {
    expect(describeCheckIn({ status: 'unknown_student', student_code: 'X9' }, 'UTC')).toMatchObject({
      tone: 'error',
      title: 'ID not recognised',
    })
    expect(describeCheckIn({ status: 'invalid_id', student_code: '' }, 'UTC').detail).toMatch(/Manual lookup/)
  })
})

describe('feeding plans', () => {
  const plans = [
    { code: 'once', label: 'Once a day', meals_per_day: 1 },
    { code: 'twice', label: 'Twice a day', meals_per_day: 2 },
    { code: 'thrice', label: 'Thrice a day', meals_per_day: 3 },
  ]

  it('reads the plan column by code, name or number of meals', () => {
    const csv = 'student_id,first_name,last_name,plan\nS1,A,B,once\nS2,C,D,Twice a day\nS3,E,F,3\nS4,G,H,\nS5,I,J,thrice a day\n'
    const { rows, errors } = parseRoster(csv, plans)
    expect(errors).toEqual([])
    expect(rows.map((r) => r.plan_code)).toEqual(['once', 'twice', 'thrice', null, 'thrice'])
  })

  it('rejects an unknown plan and omits plan_code when there is no plan column', () => {
    expect(parseRoster('student_id,first_name,last_name,plan\nS1,A,B,four\n', plans).errors[0].message).toMatch(
      /unknown plan “four”/,
    )
    expect(parseRoster('student_id,first_name,last_name\nS1,A,B\n', plans).rows[0]).not.toHaveProperty('plan_code')
  })

  const student = { student_code: 'S1', first_name: 'Ama', last_name: 'Mensah', plan_label: 'Once a day' }

  it('shows the plan with the confirmation', () => {
    const m = describeCheckIn(
      { status: 'ok', student, meal_period_label: 'Lunch', checked_in_at: '2026-10-19T12:00:00Z', served_count: 1 },
      'UTC',
    )
    expect(m.subtitle).toBe('Once a day')
  })

  it('explains a meal period outside the plan', () => {
    const m = describeCheckIn(
      { status: 'not_on_plan', student, meal_period_label: 'Breakfast', allowed_periods: ['Lunch'] },
      'UTC',
    )
    expect(m).toMatchObject({ tone: 'error', title: 'Not in meal plan: Ama Mensah' })
    expect(m.detail).toBe('Once a day covers Lunch only. Breakfast is not included, so no meal was recorded.')
  })

  it('explains the daily limit', () => {
    const m = describeCheckIn(
      {
        status: 'plan_limit_reached',
        student: { ...student, plan_label: 'Twice a day' },
        meal_period_label: 'Supper',
        meals_today: 2,
        meals_per_day: 2,
        meals_today_periods: ['Breakfast', 'Lunch'],
      },
      'UTC',
    )
    expect(m.tone).toBe('warning')
    expect(m.detail).toBe('Twice a day: already had 2 of 2 meals today (Breakfast and Lunch). No meal was recorded.')
  })
})

describe('meal chits', () => {
  const plans = [
    { code: 'once', chits: { lunch: 'blue', supper: 'blue' } },
    { code: 'twice', chits: { lunch: 'pink', supper: 'yellow' } },
  ]

  it('finds the chit colour for a plan and meal period', () => {
    expect(chitFor(plans, 'twice', 'lunch')).toBe('pink')
    expect(chitFor(plans, 'twice', 'supper')).toBe('yellow')
    expect(chitFor(plans, 'once', 'supper')).toBe('blue')
    expect(CHIT_COLORS.pink.label).toBe('Pinkish red')
  })

  it('returns null when there is no plan or no chit', () => {
    expect(chitFor(plans, null, 'lunch')).toBeNull()
    expect(chitFor(plans, 'once', 'breakfast')).toBeNull()
    expect(chitFor([{ code: 'x', chits: { lunch: 'tartan' } }], 'x', 'lunch')).toBeNull()
  })
})
