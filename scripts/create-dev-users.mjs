#!/usr/bin/env node
/**
 * Creates three LOCAL development staff accounts, one per role:
 *
 *   tablet@demo.school      / demo-password-1   (checkin)
 *   supervisor@demo.school  / demo-password-1   (supervisor)
 *   admin@demo.school       / demo-password-1   (admin)
 *
 * Usage (after `supabase start`):
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> npm run dev:users
 *
 * Refuses to run against anything other than localhost: the service_role key
 * bypasses Row Level Security and must never be used from the browser.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceKey) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (shown by `supabase status`).')
  process.exit(1)
}
const host = new URL(url).hostname
if (!['127.0.0.1', 'localhost'].includes(host)) {
  console.error(`Refusing to create demo accounts on ${host}. This script is for local development only.`)
  process.exit(1)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
const password = 'demo-password-1'
const users = [
  { email: 'tablet@demo.school', full_name: 'Cafeteria Tablet', role: 'checkin' },
  { email: 'supervisor@demo.school', full_name: 'Sam Supervisor', role: 'supervisor' },
  { email: 'admin@demo.school', full_name: 'Alex Admin', role: 'admin' },
]

for (const u of users) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: u.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: u.full_name },
  })
  let id = data?.user?.id
  if (error) {
    if (!/already/i.test(error.message)) throw error
    const { data: list } = await supabase.auth.admin.listUsers()
    id = list.users.find((x) => x.email === u.email)?.id
  }
  const { error: roleError } = await supabase
    .from('staff_profiles')
    .update({ role: u.role, full_name: u.full_name, active: true })
    .eq('id', id)
  if (roleError) throw roleError
  console.log(`✓ ${u.email} (${u.role})`)
}
console.log(`\nPassword for all accounts: ${password}`)
