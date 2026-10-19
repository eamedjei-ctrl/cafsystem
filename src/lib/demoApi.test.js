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
