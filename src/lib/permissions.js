/**
 * What each role may do in the UI. This only decides what to SHOW: the
 * database enforces the same rules with RLS and function checks
 * (supabase/migrations), so hiding a button is never the only protection.
 */
const GRANTS = {
  checkin: ['checkIn'],
  supervisor: ['checkIn', 'viewRecords', 'exportRecords', 'correctRecords', 'viewStudents', 'viewAudit'],
  admin: [
    'checkIn',
    'viewRecords',
    'exportRecords',
    'correctRecords',
    'viewStudents',
    'manageStudents',
    'viewAudit',
    'manageStaff',
  ],
}

export const ROLES = ['checkin', 'supervisor', 'admin']

export function can(role, permission) {
  return Boolean(role && GRANTS[role]?.includes(permission))
}

export const ROLE_LABELS = {
  checkin: 'Check-in staff',
  supervisor: 'Supervisor',
  admin: 'Administrator',
}

export const ROLE_DESCRIPTIONS = {
  checkin: 'Can check students in and use manual lookup. Cannot see records or the roster.',
  supervisor: 'Can view, search, export and correct meal records, and view the roster and audit log.',
  admin: 'Full access, including the student roster and staff accounts.',
}

/** Where to send a user after sign-in. */
export function homePath(role) {
  if (can(role, 'viewRecords')) return '/records'
  if (can(role, 'checkIn')) return '/check-in'
  return '/no-access'
}
