import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TestDb } from './harness'

let db
let tablet
let supervisor
let admin

async function checkIn(code, period) {
  const [row] = await db.as(tablet, `select public.check_in($1, $2) as r`, [code, period])
  return row.r
}

beforeAll(async () => {
  db = await TestDb.create()
  tablet = await db.createUser('tablet@school.test', 'checkin')
  supervisor = await db.createUser('super@school.test', 'supervisor')
  admin = await db.createUser('admin@school.test', 'admin')
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  await db.sql(`delete from public.meal_records`)
  await db.sql(`delete from public.students`)
  // Restore the school's default plans (some tests change them).
  await db.sql(`update public.feeding_plans set meals_per_day = case code when 'once' then 1 when 'twice' then 2 else 3 end`)
  await db.sql(`delete from public.feeding_plan_periods`)
  await db.sql(`insert into public.feeding_plan_periods (plan_code, meal_period, chit_color) values
    ('once', 'lunch', 'blue'), ('once', 'supper', 'blue'),
    ('twice', 'lunch', 'pink'), ('twice', 'supper', 'yellow'),
    ('thrice', 'breakfast', 'blue'), ('thrice', 'lunch', 'blue'), ('thrice', 'supper', 'blue')`)
  await db.addStudent('S1', 'Ama', 'Once')
  await db.addStudent('S2', 'Kofi', 'Twice')
  await db.addStudent('S3', 'Esi', 'Thrice')
  await db.addStudent('S4', 'Yaw', 'Noplan')
  await db.sql(`update public.students set plan_code = case student_code
    when 'S1' then 'once' when 'S2' then 'twice' when 'S3' then 'thrice' end`)
})

describe('default feeding plans', () => {
  it('provides once, twice and thrice a day with their meals and chit colours', async () => {
    const plans = await db.as(
      tablet,
      `select p.code, p.meals_per_day, array_agg(fpp.meal_period order by mp.sort_order) as periods,
              array_agg(fpp.chit_color order by mp.sort_order) as chits
       from public.feeding_plans p
       join public.feeding_plan_periods fpp on fpp.plan_code = p.code
       join public.meal_periods mp on mp.code = fpp.meal_period
       group by p.code, p.meals_per_day, p.sort_order order by p.sort_order`,
    )
    expect(plans).toEqual([
      { code: 'once', meals_per_day: 1, periods: ['lunch', 'supper'], chits: ['blue', 'blue'] },
      { code: 'twice', meals_per_day: 2, periods: ['lunch', 'supper'], chits: ['pink', 'yellow'] },
      { code: 'thrice', meals_per_day: 3, periods: ['breakfast', 'lunch', 'supper'], chits: ['blue', 'blue', 'blue'] },
    ])
  })

  it('ships those defaults in the migrations', async () => {
    const fresh = await TestDb.create()
    try {
      const rows = await fresh.sql(
        `select plan_code, meal_period, chit_color from public.feeding_plan_periods order by plan_code, meal_period`,
      )
      expect(rows.map((r) => `${r.plan_code}:${r.meal_period}:${r.chit_color}`)).toEqual([
        'once:lunch:blue',
        'once:supper:blue',
        'thrice:breakfast:blue',
        'thrice:lunch:blue',
        'thrice:supper:blue',
        'twice:lunch:pink',
        'twice:supper:yellow',
      ])
    } finally {
      await fresh.close()
    }
  })

  it('adds supper and retires the unused snack period', async () => {
    const periods = await db.sql(`select code, active from public.meal_periods order by sort_order`)
    expect(periods).toEqual([
      { code: 'breakfast', active: true },
      { code: 'lunch', active: true },
      { code: 'snack', active: false },
      { code: 'supper', active: true },
    ])
  })
})

describe('check-in with feeding plans', () => {
  it('serves a once-a-day student one meal, at lunch or supper', async () => {
    const breakfast = await checkIn('S1', 'breakfast')
    expect(breakfast.status).toBe('not_on_plan')
    expect(breakfast.allowed_periods).toEqual(['Lunch', 'Supper'])
    expect(breakfast.student).toMatchObject({ first_name: 'Ama', plan_label: 'Once a day' })

    const lunch = await checkIn('S1', 'lunch')
    expect(lunch.status).toBe('ok')
    expect(lunch.student).toMatchObject({ plan_code: 'once', plan_label: 'Once a day' })
    expect(await checkIn('S1', 'supper')).toMatchObject({
      status: 'plan_limit_reached',
      meals_today: 1,
      meals_per_day: 1,
      meals_today_periods: ['Lunch'],
    })
  })

  it('lets a once-a-day student take supper instead of lunch', async () => {
    expect((await checkIn('S1', 'supper')).status).toBe('ok')
    expect((await checkIn('S1', 'lunch')).status).toBe('plan_limit_reached')
  })

  it('serves a twice-a-day student at lunch and supper, not breakfast', async () => {
    expect((await checkIn('S2', 'breakfast')).status).toBe('not_on_plan')
    expect((await checkIn('S2', 'lunch')).status).toBe('ok')
    expect((await checkIn('S2', 'supper')).status).toBe('ok')
  })

  it('serves a thrice-a-day student three times', async () => {
    for (const p of ['breakfast', 'lunch', 'supper']) expect((await checkIn('S3', p)).status).toBe('ok')
  })

  it('still reports duplicates before plan rules', async () => {
    await checkIn('S1', 'lunch')
    expect((await checkIn('S1', 'lunch')).status).toBe('duplicate')
  })

  it('does not restrict students with no plan', async () => {
    for (const p of ['breakfast', 'lunch', 'supper']) expect((await checkIn('S4', p)).status).toBe('ok')
  })

  it('frees the allowance again when a meal is voided', async () => {
    const r = await checkIn('S1', 'lunch')
    await db.as(supervisor, `select public.correct_meal_record($1, 'wrong student', p_voided => true)`, [r.record_id])
    expect((await checkIn('S1', 'supper')).status).toBe('ok')
  })

  it('stores the plan on the meal record and in the report view', async () => {
    await checkIn('S2', 'lunch')
    await db.sql(`update public.students set plan_code = 'thrice' where student_code = 'S2'`)
    const [row] = await db.as(supervisor, `select plan_code, plan_label from public.meal_record_details`)
    expect(row).toEqual({ plan_code: 'twice', plan_label: 'Twice a day' })
  })

  it('lets supervisors add a record outside the plan as an override', async () => {
    const [{ id }] = await db.as(
      supervisor,
      `select public.add_meal_record('S1', 'breakfast', public.school_today(), 'Early exam') as id`,
    )
    const [rec] = await db.sql(`select plan_code, method from public.meal_records where id = $1`, [id])
    expect(rec).toEqual({ plan_code: 'once', method: 'admin' })
  })
})

describe('managing plans', () => {
  it('lets an admin change the periods and limit, with an audit trail', async () => {
    await db.as(admin, `select public.set_feeding_plan('once', 'Once a day', 1, '{breakfast,lunch}', '{"breakfast":"green","lunch":"blue"}')`)
    const periods = await db.sql(
      `select meal_period, chit_color from public.feeding_plan_periods where plan_code = 'once' order by meal_period`,
    )
    expect(periods).toEqual([
      { meal_period: 'breakfast', chit_color: 'green' },
      { meal_period: 'lunch', chit_color: 'blue' },
    ])
    const audit = await db.sql(
      `select reason, changed_by from public.audit_log where table_name = 'feeding_plan_periods' order by id desc limit 1`,
    )
    expect(audit).toEqual([{ reason: 'Feeding plan updated', changed_by: admin.id }])
  })

  it('rejects impossible plans', async () => {
    await expect(db.as(admin, `select public.set_feeding_plan('twice', 'Twice', 2, '{lunch}')`)).rejects.toThrow(
      /Meals per day/,
    )
    await expect(db.as(admin, `select public.set_feeding_plan('twice', 'Twice', 1, '{}')`)).rejects.toThrow(
      /at least one/,
    )
    await expect(db.as(admin, `select public.set_feeding_plan('twice', 'Twice', 1, '{dinner}')`)).rejects.toThrow(
      /Unknown meal period/,
    )
    await expect(
      db.as(admin, `select public.set_feeding_plan('twice', 'Twice', 1, '{lunch}', '{"lunch":"tartan"}')`),
    ).rejects.toThrow(/chit_color/)
  })

  it('only admins can change plans, and nobody can write the tables directly', async () => {
    await expect(db.as(supervisor, `select public.set_feeding_plan('once', 'x', 1, '{lunch}')`)).rejects.toThrow(
      /permission/,
    )
    await expect(db.as(admin, `delete from public.feeding_plan_periods`)).rejects.toThrow(/permission denied/)
    await expect(db.as(null, `select * from public.feeding_plans`)).rejects.toThrow(/permission denied/)
  })
})

describe('roster import with plans', () => {
  it('sets plans from the file and keeps them when a file has no plan column', async () => {
    const withPlans = [
      { student_code: 'S1', first_name: 'Ama', last_name: 'Once', plan_code: 'thrice' },
      { student_code: 'S9', first_name: 'New', last_name: 'Kid', plan_code: 'twice' },
    ]
    await db.as(admin, `select public.import_students($1)`, [JSON.stringify(withPlans)])
    const noPlans = [{ student_code: 'S1', first_name: 'Ama', last_name: 'Once' }]
    const [{ r }] = await db.as(admin, `select public.import_students($1) as r`, [JSON.stringify(noPlans)])
    expect(r.unchanged).toBe(1)
    const rows = await db.sql(`select student_code, plan_code from public.students where student_code in ('S1','S9') order by 1`)
    expect(rows).toEqual([
      { student_code: 'S1', plan_code: 'thrice' },
      { student_code: 'S9', plan_code: 'twice' },
    ])
  })

  it('rejects an unknown plan', async () => {
    const rows = [{ student_code: 'S1', first_name: 'Ama', last_name: 'Once', plan_code: 'fourtimes' }]
    await expect(db.as(admin, `select public.import_students($1)`, [JSON.stringify(rows)])).rejects.toThrow()
  })
})

describe('plan summary', () => {
  it('counts students and meals per plan for supervisors', async () => {
    await checkIn('S1', 'lunch')
    await checkIn('S2', 'lunch')
    await checkIn('S2', 'supper')
    await checkIn('S4', 'breakfast')
    const [{ s }] = await db.as(
      supervisor,
      `select public.feeding_plan_summary(public.school_today(), public.school_today()) as s`,
    )
    expect(s).toEqual([
      { plan_code: 'once', plan_label: 'Once a day', meals_per_day: 1, enrolled: 1, served: { lunch: 1 } },
      { plan_code: 'twice', plan_label: 'Twice a day', meals_per_day: 2, enrolled: 1, served: { lunch: 1, supper: 1 } },
      { plan_code: 'thrice', plan_label: 'Thrice a day', meals_per_day: 3, enrolled: 1, served: {} },
      { plan_code: null, plan_label: 'No plan set', meals_per_day: null, enrolled: 1, served: { breakfast: 1 } },
    ])
  })

  it('shows nothing to check-in staff', async () => {
    await checkIn('S1', 'lunch')
    const [{ s }] = await db.as(tablet, `select public.feeding_plan_summary(current_date - 1, current_date + 1) as s`)
    expect(s.every((p) => p.enrolled === 0 && Object.keys(p.served).length === 0)).toBe(true)
  })
})

describe('times fed per student', () => {
  const counts = async (user, search = '', limit = 50, offset = 0) => {
    const [{ c }] = await db.as(
      user,
      `select public.student_meal_counts(public.school_today(), public.school_today(), $1, $2, $3) as c`,
      [search, limit, offset],
    )
    return c
  }

  it('lists every active student with their meals served, voided records excluded', async () => {
    await checkIn('S2', 'lunch')
    await checkIn('S2', 'supper')
    await checkIn('S3', 'lunch')
    await db.sql(`update public.meal_records set voided = true, voided_at = now(), void_reason = 'test'
      where student_id = (select id from public.students where student_code = 'S3')`)
    expect(await counts(supervisor)).toEqual({
      total: 4,
      rows: [
        { student_code: 'S4', first_name: 'Yaw', last_name: 'Noplan', times_fed: 0 },
        { student_code: 'S1', first_name: 'Ama', last_name: 'Once', times_fed: 0 },
        { student_code: 'S3', first_name: 'Esi', last_name: 'Thrice', times_fed: 0 },
        { student_code: 'S2', first_name: 'Kofi', last_name: 'Twice', times_fed: 2 },
      ],
    })
  })

  it('includes inactive students only when they were fed in the range', async () => {
    await checkIn('S1', 'lunch')
    await db.addStudent('S5', 'Abena', 'Gone', false)
    await db.sql(`update public.students set active = false where student_code = 'S1'`)
    const { rows } = await counts(admin)
    expect(rows.map((r) => r.student_code)).toEqual(['S4', 'S1', 'S3', 'S2'])
  })

  it('searches by name or ID, treats wildcards literally and pages', async () => {
    expect((await counts(supervisor, 'kofi')).rows.map((r) => r.student_code)).toEqual(['S2'])
    expect((await counts(supervisor, 's3')).rows.map((r) => r.student_code)).toEqual(['S3'])
    expect((await counts(supervisor, '%')).total).toBe(0)
    expect(await counts(supervisor, '', 2, 2)).toMatchObject({ total: 4, rows: [{ student_code: 'S3' }, { student_code: 'S2' }] })
  })

  it('shows nothing to check-in staff', async () => {
    await checkIn('S1', 'lunch')
    expect(await counts(tablet)).toEqual({ total: 0, rows: [] })
  })
})
