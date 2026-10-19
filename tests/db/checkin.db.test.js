import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TestDb } from './harness'

let db
let tablet
let supervisor

async function checkIn(user, code, period = 'lunch', method = 'scan') {
  const [row] = await db.as(user, `select public.check_in($1, $2, $3::public.check_in_method) as r`, [
    code,
    period,
    method,
  ])
  return row.r
}

const recordCount = async () => (await db.sql(`select count(*)::int as n from public.meal_records`))[0].n

beforeAll(async () => {
  db = await TestDb.create()
  tablet = await db.createUser('tablet@school.test', 'checkin')
  supervisor = await db.createUser('super@school.test', 'supervisor')
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  await db.sql(`delete from public.meal_records`)
  await db.sql(`delete from public.students`)
  await db.sql(`update public.meal_periods set active = true`)
  await db.addStudent('S1001', 'Ama', 'Mensah', '5A')
  await db.addStudent('S1002', 'Kofi', 'Owusu', '5B')
  await db.addStudent('S1003', 'Esi', 'Boateng', '6A', false)
})

describe('check_in rules', () => {
  it('records a check-in and returns the student name', async () => {
    const r = await checkIn(tablet, 'S1001')
    expect(r.status).toBe('ok')
    expect(r.student).toMatchObject({ first_name: 'Ama', last_name: 'Mensah', class_name: '5A' })
    expect(r.served_count).toBe(1)

    const rows = await db.sql(
      `select meal_period, method, recorded_by, service_date = private.school_today() as is_today
       from public.meal_records`,
    )
    expect(rows).toEqual([{ meal_period: 'lunch', method: 'scan', recorded_by: tablet.id, is_today: true }])
  })

  it('normalises scanner input (whitespace, lower case)', async () => {
    expect((await checkIn(tablet, '  s1001\n')).status).toBe('ok')
  })

  it('detects a duplicate for the same student and meal period', async () => {
    const first = await checkIn(tablet, 'S1001')
    const second = await checkIn(tablet, 'S1001')
    expect(second.status).toBe('duplicate')
    expect(second.first_checked_in_at).toBe(first.checked_in_at)
    expect(second.student).toMatchObject({ first_name: 'Ama' })
    expect(await recordCount()).toBe(1)
  })

  it('allows the same student in a different meal period', async () => {
    expect((await checkIn(tablet, 'S1001', 'breakfast')).status).toBe('ok')
    expect((await checkIn(tablet, 'S1001', 'lunch')).status).toBe('ok')
  })

  it('treats a manual lookup the same way as a scan for duplicates', async () => {
    expect((await checkIn(tablet, 'S1001', 'lunch', 'scan')).status).toBe('ok')
    expect((await checkIn(tablet, 'S1001', 'lunch', 'manual')).status).toBe('duplicate')
  })

  it('rejects an unknown student ID', async () => {
    expect(await checkIn(tablet, 'NOPE999')).toEqual({ status: 'unknown_student', student_code: 'NOPE999' })
  })

  it('rejects malformed IDs', async () => {
    expect((await checkIn(tablet, '')).status).toBe('invalid_id')
    expect((await checkIn(tablet, "S1'; drop table students;--")).status).toBe('invalid_id')
    expect((await checkIn(tablet, 'X'.repeat(33))).status).toBe('invalid_id')
  })

  it('reports an inactive student and does not record a meal', async () => {
    const r = await checkIn(tablet, 'S1003')
    expect(r.status).toBe('inactive_student')
    expect(r.student).toMatchObject({ first_name: 'Esi' })
    expect(await recordCount()).toBe(0)
  })

  it('rejects unknown or inactive meal periods', async () => {
    expect((await checkIn(tablet, 'S1001', 'dinner')).status).toBe('invalid_period')
    await db.sql(`update public.meal_periods set active = false where code = 'snack'`)
    expect((await checkIn(tablet, 'S1001', 'snack')).status).toBe('invalid_period')
  })

  it('does not let the check-in screen create administrative records', async () => {
    await expect(checkIn(tablet, 'S1001', 'lunch', 'admin')).rejects.toThrow(/add_meal_record/)
  })

  it('allows a new check-in after the earlier one was voided', async () => {
    const first = await checkIn(tablet, 'S1001')
    await db.as(supervisor, `select public.correct_meal_record($1, 'Scanned wrong card', p_voided => true)`, [
      first.record_id,
    ])
    expect((await checkIn(tablet, 'S1001')).status).toBe('ok')
  })

  it('enforces one record per period at the database level', async () => {
    const r = await checkIn(tablet, 'S1001')
    await expect(
      db.sql(
        `insert into public.meal_records (student_id, meal_period, service_date, method)
         select student_id, meal_period, service_date, 'scan' from public.meal_records where id = $1`,
        [r.record_id],
      ),
    ).rejects.toThrow(/meal_records_one_per_period/)
  })

  it('assigns the service date using the school time zone', async () => {
    await db.sql(`update public.app_settings set timezone = 'Pacific/Kiritimati'`) // UTC+14
    const [{ ok }] = await db.sql(
      `select private.school_today() = (now() at time zone 'Pacific/Kiritimati')::date as ok`,
    )
    expect(ok).toBe(true)
    await db.sql(`update public.app_settings set timezone = 'UTC'`)
  })

  it('rejects an invalid time zone setting', async () => {
    await expect(db.sql(`update public.app_settings set timezone = 'Mars/Olympus'`)).rejects.toThrow(
      /Unknown time zone/,
    )
  })
})

describe('manual lookup', () => {
  it('finds active students by name or ID fragment', async () => {
    const byName = await db.as(tablet, `select * from public.search_students('mens')`)
    expect(byName.map((s) => s.student_code)).toEqual(['S1001'])
    expect(await db.as(tablet, `select * from public.search_students('kofi owusu')`)).toHaveLength(1)
    // inactive S1003 is excluded
    expect(await db.as(tablet, `select * from public.search_students('s100')`)).toHaveLength(2)
  })

  it('needs at least 2 characters and treats wildcards literally', async () => {
    expect(await db.as(tablet, `select * from public.search_students('a')`)).toHaveLength(0)
    expect(await db.as(tablet, `select * from public.search_students('%%')`)).toHaveLength(0)
    expect(await db.as(tablet, `select * from public.search_students('__')`)).toHaveLength(0)
  })

  it('caps the number of results', async () => {
    for (let i = 0; i < 40; i++) await db.addStudent(`T${i}`, 'Test', `Pupil${i}`)
    expect(await db.as(tablet, `select * from public.search_students('pupil', 1000)`)).toHaveLength(25)
  })
})

describe('corrections and audit trail', () => {
  it('voids a record with a reason and writes an audit entry', async () => {
    const r = await checkIn(tablet, 'S1001')
    await db.as(supervisor, `select public.correct_meal_record($1, 'Student swapped cards', p_voided => true)`, [
      r.record_id,
    ])

    const [rec] = await db.sql(`select voided, void_reason, voided_by from public.meal_records where id = $1`, [
      r.record_id,
    ])
    expect(rec).toEqual({ voided: true, void_reason: 'Student swapped cards', voided_by: supervisor.id })

    const audit = await db.sql(
      `select action, reason, changed_by, (old_data->>'voided')::boolean as old_voided
       from public.audit_log where table_name = 'meal_records' and record_id = $1`,
      [r.record_id],
    )
    expect(audit).toEqual([
      { action: 'UPDATE', reason: 'Student swapped cards', changed_by: supervisor.id, old_voided: false },
    ])
  })

  it('requires a reason', async () => {
    const r = await checkIn(tablet, 'S1001')
    await expect(
      db.as(supervisor, `select public.correct_meal_record($1, '  ', p_voided => true)`, [r.record_id]),
    ).rejects.toThrow(/reason/)
  })

  it('moves a record to another meal period, but not onto an existing one', async () => {
    const lunch = await checkIn(tablet, 'S1001', 'lunch')
    await db.as(supervisor, `select public.correct_meal_record($1, 'Was breakfast', p_meal_period => 'breakfast')`, [
      lunch.record_id,
    ])
    const lunch2 = await checkIn(tablet, 'S1001', 'lunch')
    expect(lunch2.status).toBe('ok')
    await expect(
      db.as(supervisor, `select public.correct_meal_record($1, 'oops again', p_meal_period => 'breakfast')`, [
        lunch2.record_id,
      ]),
    ).rejects.toThrow(/already has a record/)
  })

  it('will not restore a voided record if the student has since checked in', async () => {
    const first = await checkIn(tablet, 'S1001')
    await db.as(supervisor, `select public.correct_meal_record($1, 'mistake', p_voided => true)`, [first.record_id])
    await checkIn(tablet, 'S1001')
    await expect(
      db.as(supervisor, `select public.correct_meal_record($1, 'undo', p_voided => false)`, [first.record_id]),
    ).rejects.toThrow(/already has a record/)
  })

  it('adds a missed record for a past date with an audit entry', async () => {
    const [{ id }] = await db.as(
      supervisor,
      `select public.add_meal_record('S1002', 'lunch', public.school_today() - 1, 'Scanner was down') as id`,
    )
    const [rec] = await db.sql(`select method from public.meal_records where id = $1`, [id])
    expect(rec.method).toBe('admin')
    expect(await db.sql(`select reason from public.audit_log where record_id = $1`, [id])).toEqual([
      { reason: 'Scanner was down' },
    ])
  })

  it('refuses records dated in the future', async () => {
    await expect(
      db.as(supervisor, `select public.add_meal_record('S1002', 'lunch', public.school_today() + 1, 'future')`),
    ).rejects.toThrow(/future/)
  })

  it('makes the audit log append-only, even for the database owner', async () => {
    await db.sql(`update public.students set class_name = '5C' where student_code = 'S1001'`)
    await expect(db.sql(`update public.audit_log set reason = 'tampered'`)).rejects.toThrow(/cannot be modified/)
    await expect(db.sql(`delete from public.audit_log`)).rejects.toThrow(/cannot be modified/)
    await expect(db.sql(`truncate public.audit_log`)).rejects.toThrow(/cannot be modified/)
  })
})
