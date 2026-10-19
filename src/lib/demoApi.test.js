import { beforeEach, describe, expect, it } from 'vitest'
import * as demo from './demoApi'

const signInAs = async (email) => {
  await demo.auth.signOut()
  const { error } = await demo.auth.signInWithPassword({ email, password: demo.DEMO_PASSWORD })
  expect(error).toBeNull()
}

beforeEach(async () => {
  demo.resetDemo()
  await demo.auth.signOut()
})

describe('demo mode backend', () => {
  it('rejects a wrong password and allows the demo accounts', async () => {
    const bad = await demo.auth.signInWithPassword({ email: 'admin@demo.school', password: 'nope' })
    expect(bad.error.message).toBe('Invalid login credentials')
    for (const a of demo.DEMO_ACCOUNTS) await signInAs(a.email)
  })

  it('applies the same check-in rules as the database', async () => {
    await signInAs('tablet@demo.school')
    expect((await demo.checkIn('demo0001', 'lunch')).status).toBe('ok')
    const dup = await demo.checkIn('DEMO0001', 'lunch', 'manual')
    expect(dup.status).toBe('duplicate')
    expect(dup.served_count).toBe(1)
    expect((await demo.checkIn('DEMO0001', 'breakfast')).status).toBe('ok')
    expect((await demo.checkIn('NOPE', 'lunch')).status).toBe('unknown_student')
    expect((await demo.checkIn('DEMO0059', 'lunch')).status).toBe('inactive_student')
    expect((await demo.checkIn('bad id!', 'lunch')).status).toBe('invalid_id')
  })

  it('enforces roles', async () => {
    await expect(demo.checkIn('DEMO0001', 'lunch')).rejects.toThrow(/permission/)
    await signInAs('tablet@demo.school')
    await expect(demo.listRecords({ status: 'active' })).rejects.toThrow(/permission/)
    await signInAs('supervisor@demo.school')
    await expect(demo.importStudents([])).rejects.toThrow(/permission/)
    await expect(demo.listRecords({ status: 'active' })).resolves.toHaveProperty('count')
  })

  it('requires a reason for corrections and audits them', async () => {
    await signInAs('supervisor@demo.school')
    const r = await demo.checkIn('DEMO0002', 'lunch')
    await expect(demo.correctRecord({ id: r.record_id, reason: '', voided: true })).rejects.toThrow(/reason/)
    await demo.correctRecord({ id: r.record_id, reason: 'Wrong card', voided: true })
    const { data } = await demo.listAudit({})
    expect(data[0]).toMatchObject({ table_name: 'meal_records', action: 'UPDATE', reason: 'Wrong card' })
    expect((await demo.checkIn('DEMO0002', 'lunch')).status).toBe('ok')
  })

  it('keeps at least one active admin', async () => {
    await signInAs('admin@demo.school')
    await expect(demo.updateStaff('demo-user-admin', { role: 'supervisor' })).rejects.toThrow(/active admin/)
  })
})

describe('demo mode feeding plans', () => {
  const codeOnPlan = async (plan) => {
    await signInAs('admin@demo.school')
    const { data } = await demo.listStudents({ planCode: plan })
    return data[0].student_code
  }

  it('applies once / twice / thrice a day rules', async () => {
    const once = await codeOnPlan('once')
    const twice = await codeOnPlan('twice')
    const thrice = await codeOnPlan('thrice')
    await signInAs('tablet@demo.school')
    expect((await demo.checkIn(once, 'breakfast')).status).toBe('not_on_plan')
    expect((await demo.checkIn(once, 'lunch')).status).toBe('ok')
    expect((await demo.checkIn(twice, 'supper')).status).toBe('not_on_plan')
    for (const p of ['breakfast', 'lunch', 'supper']) expect((await demo.checkIn(thrice, p)).status).toBe('ok')
  })

  it('enforces the daily limit when a plan allows a choice', async () => {
    const once = await codeOnPlan('once')
    await demo.setFeedingPlan({ code: 'once', label: 'Once a day', mealsPerDay: 1, periods: ['breakfast', 'lunch', 'supper'] })
    await signInAs('tablet@demo.school')
    expect((await demo.checkIn(once, 'breakfast')).status).toBe('ok')
    expect(await demo.checkIn(once, 'supper')).toMatchObject({ status: 'plan_limit_reached', meals_today: 1 })
  })

  it('splits students into sections and summarises meals per plan', async () => {
    await signInAs('supervisor@demo.school')
    const plans = await demo.getFeedingPlans()
    const counts = await demo.countStudentsByPlan(plans)
    expect(Object.keys(counts)).toEqual(['once', 'twice', 'thrice', 'none'])
    expect(counts.once + counts.twice + counts.thrice + counts.none).toBe(58)
    const summary = await demo.feedingPlanSummary('2000-01-01', '2999-12-31')
    expect(summary.map((s) => s.plan_label)).toEqual(['Once a day', 'Twice a day', 'Thrice a day', 'No plan set'])
    // Seeded history respects the plans: nobody on "once" ate breakfast.
    expect(summary[0].served.breakfast).toBeUndefined()
  })
})
