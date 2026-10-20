import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDb } from './harness'

let db
let tablet
let supervisor
let admin
let noRole
let inactiveAdmin
let recordId

beforeAll(async () => {
  db = await TestDb.create()
  tablet = await db.createUser('tablet@school.test', 'checkin')
  supervisor = await db.createUser('super@school.test', 'supervisor')
  admin = await db.createUser('admin@school.test', 'admin')
  noRole = await db.createUser('newhire@school.test', null)
  inactiveAdmin = await db.createUser('former@school.test', 'admin', { active: false })
  await db.addStudent('S1001', 'Ama', 'Mensah')
  const [row] = await db.as(tablet, `select public.check_in('S1001', 'lunch') as r`)
  recordId = row.r.record_id
})

afterAll(async () => {
  await db.close()
})

const count = async (user, table) => (await db.as(user, `select count(*)::int as n from ${table}`))[0].n

const ALL_TABLES = [
  'public.students',
  'public.meal_records',
  'public.meal_record_details',
  'public.audit_log',
  'public.staff_profiles',
  'public.meal_periods',
  'public.app_settings',
]

describe('anonymous visitors (anon key, not signed in)', () => {
  it.each(ALL_TABLES)('cannot read %s', async (table) => {
    await expect(count(null, table)).rejects.toThrow(/permission denied/)
  })

  it('cannot call any function', async () => {
    await expect(db.as(null, `select public.check_in('S1001', 'lunch')`)).rejects.toThrow(/permission denied/)
    await expect(db.as(null, `select * from public.search_students('ama')`)).rejects.toThrow(/permission denied/)
    await expect(db.as(null, `select public.import_students('[]')`)).rejects.toThrow(/permission denied/)
  })
})

describe('signed-in user without a role', () => {
  it('sees only their own profile and no data', async () => {
    expect(await count(noRole, 'public.staff_profiles')).toBe(1)
    expect(await count(noRole, 'public.students')).toBe(0)
    expect(await count(noRole, 'public.meal_records')).toBe(0)
    expect(await count(noRole, 'public.meal_periods')).toBe(0)
    expect(await count(noRole, 'public.audit_log')).toBe(0)
  })

  it('cannot check students in or search', async () => {
    await expect(db.as(noRole, `select public.check_in('S1001', 'breakfast')`)).rejects.toThrow(/permission/)
    await expect(db.as(noRole, `select * from public.search_students('ama')`)).rejects.toThrow(/permission/)
  })

  it('cannot give themselves a role', async () => {
    await db.as(noRole, `update public.staff_profiles set role = 'admin' where id = auth.uid()`)
    const [p] = await db.sql(`select role from public.staff_profiles where id = $1`, [noRole.id])
    expect(p.role).toBeNull()
  })

  it('cannot create a profile row', async () => {
    await expect(
      db.as(noRole, `insert into public.staff_profiles (id, role) values (gen_random_uuid(), 'admin')`),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('deactivated staff', () => {
  it('lose all access, even with the admin role', async () => {
    expect(await count(inactiveAdmin, 'public.students')).toBe(0)
    await expect(db.as(inactiveAdmin, `select public.import_students('[]')`)).rejects.toThrow(/permission/)
    await expect(db.as(inactiveAdmin, `select public.check_in('S1001', 'snack')`)).rejects.toThrow(/permission/)
  })
})

describe('check-in role (cafeteria tablet)', () => {
  it('can read meal periods and settings', async () => {
    expect(await count(tablet, 'public.meal_periods')).toBe(4)
    expect(await count(tablet, 'public.app_settings')).toBe(1)
  })

  it('cannot browse the roster, meal records or audit log', async () => {
    expect(await count(tablet, 'public.students')).toBe(0)
    expect(await count(tablet, 'public.meal_records')).toBe(0)
    expect(await count(tablet, 'public.meal_record_details')).toBe(0)
    expect(await count(tablet, 'public.audit_log')).toBe(0)
  })

  it('cannot write meal records directly', async () => {
    await expect(
      db.as(
        tablet,
        `insert into public.meal_records (student_id, meal_period, service_date, method)
         values (gen_random_uuid(), 'breakfast', current_date, 'scan')`,
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(db.as(tablet, `delete from public.meal_records`)).rejects.toThrow(/permission denied/)
    await expect(db.as(tablet, `update public.meal_records set voided = true`)).rejects.toThrow(/permission denied/)
  })

  it('cannot correct records, add past records or import students', async () => {
    await expect(
      db.as(tablet, `select public.correct_meal_record($1, 'nope', p_voided => true)`, [recordId]),
    ).rejects.toThrow(/permission/)
    await expect(
      db.as(tablet, `select public.add_meal_record('S1001', 'breakfast', current_date, 'nope')`),
    ).rejects.toThrow(/permission/)
    await expect(db.as(tablet, `select public.import_students('[]')`)).rejects.toThrow(/permission/)
  })

  it('cannot modify students', async () => {
    await db.as(tablet, `update public.students set first_name = 'Hacked'`)
    const [s] = await db.sql(`select first_name from public.students`)
    expect(s.first_name).toBe('Ama')
  })

  it('cannot call internal helper functions', async () => {
    await expect(db.as(tablet, `select private.school_today()`)).rejects.toThrow(/permission denied/)
    await expect(db.as(tablet, `select private.require_reason('x')`)).rejects.toThrow(/permission denied/)
  })

  it('sees only its own staff profile', async () => {
    expect(await count(tablet, 'public.staff_profiles')).toBe(1)
  })
})

describe('supervisor role', () => {
  it('can read records, students, staff names and the audit log', async () => {
    expect(await count(supervisor, 'public.meal_records')).toBe(1)
    const [detail] = await db.as(supervisor, `select first_name, recorded_by_name from public.meal_record_details`)
    expect(detail).toEqual({ first_name: 'Ama', recorded_by_name: 'tablet@school.test' })
    expect(await count(supervisor, 'public.students')).toBe(1)
    expect(await count(supervisor, 'public.staff_profiles')).toBe(5)
  })

  it('cannot change the roster, staff roles or settings', async () => {
    await expect(
      db.as(supervisor, `insert into public.students (student_code, first_name, last_name) values ('X1', 'a', 'b')`),
    ).rejects.toThrow(/row-level security/)
    await expect(db.as(supervisor, `select public.import_students('[]')`)).rejects.toThrow(/permission/)
    await db.as(supervisor, `update public.staff_profiles set role = 'admin' where id = auth.uid()`)
    await db.as(supervisor, `update public.app_settings set timezone = 'Africa/Accra'`)
    const [p] = await db.sql(`select role from public.staff_profiles where id = $1`, [supervisor.id])
    expect(p.role).toBe('supervisor')
    const [s] = await db.sql(`select timezone from public.app_settings`)
    expect(s.timezone).toBe('UTC')
  })

  it('cannot hard-delete students or records', async () => {
    await expect(db.as(supervisor, `delete from public.students`)).rejects.toThrow(/permission denied/)
    await expect(db.as(supervisor, `delete from public.meal_records`)).rejects.toThrow(/permission denied/)
  })
})

describe('admin role', () => {
  it('can import a roster (upsert by student ID)', async () => {
    const rows = [
      { student_code: 's1001', first_name: 'Ama', last_name: 'Mensah-Ofori' },
      { student_code: 'S2001', first_name: 'Yaw', last_name: 'Asante' },
      { student_code: 'S2002', first_name: 'Abena', last_name: 'Darko' },
    ]
    const [{ r }] = await db.as(admin, `select public.import_students($1) as r`, [JSON.stringify(rows)])
    expect(r).toEqual({ total: 3, inserted: 2, updated: 1, unchanged: 0 })

    const [{ r: again }] = await db.as(admin, `select public.import_students($1) as r`, [JSON.stringify(rows)])
    expect(again).toEqual({ total: 3, inserted: 0, updated: 0, unchanged: 3 })
  })

  it('rejects the whole import if any row is invalid', async () => {
    const rows = [
      { student_code: 'S3001', first_name: 'Good', last_name: 'Row' },
      { student_code: 'BAD CODE!', first_name: 'Bad', last_name: 'Row' },
    ]
    await expect(db.as(admin, `select public.import_students($1)`, [JSON.stringify(rows)])).rejects.toThrow()
    expect(await db.sql(`select 1 from public.students where student_code = 'S3001'`)).toHaveLength(0)
  })

  it('can assign staff roles, and the change is audited', async () => {
    await db.as(admin, `update public.staff_profiles set role = 'checkin' where id = $1`, [noRole.id])
    const [p] = await db.sql(`select role from public.staff_profiles where id = $1`, [noRole.id])
    expect(p.role).toBe('checkin')
    const audit = await db.sql(
      `select changed_by from public.audit_log where table_name = 'staff_profiles' and record_id = $1`,
      [noRole.id],
    )
    expect(audit).toEqual([{ changed_by: admin.id }])
  })

  it('cannot remove the last active admin', async () => {
    await expect(
      db.as(admin, `update public.staff_profiles set role = 'supervisor' where id = auth.uid()`),
    ).rejects.toThrow(/At least one active admin/)
    await expect(db.as(admin, `update public.staff_profiles set active = false where id = auth.uid()`)).rejects.toThrow(
      /At least one active admin/,
    )
    await expect(db.sql(`delete from auth.users where id = $1`, [admin.id])).rejects.toThrow(
      /At least one active admin/,
    )
  })

  it('can update settings', async () => {
    await db.as(admin, `update public.app_settings set timezone = 'Africa/Accra'`)
    const [s] = await db.sql(`select timezone from public.app_settings`)
    expect(s.timezone).toBe('Africa/Accra')
  })
})
