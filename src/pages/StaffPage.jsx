import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { listStaff, updateStaff } from '../lib/api'
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../lib/permissions'
import { Alert, Badge, Button, Card, PageHeader, Spinner, inputClass } from '../components/ui'

export default function StaffPage() {
  const { user, reload } = useAuth()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [savingId, setSavingId] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      setStaff(await listStaff())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function change(member, changes, label) {
    setSavingId(member.id)
    setError(null)
    setNotice(null)
    try {
      const updated = await updateStaff(member.id, changes)
      setStaff((list) => list.map((s) => (s.id === updated.id ? updated : s)))
      setNotice(`${member.email}: ${label}.`)
      if (member.id === user.id) reload()
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Staff accounts"
        description="Assign each account the lowest role it needs. Role changes are recorded in the audit log."
      />

      <Alert tone="info" className="mb-4">
        <strong>Adding staff:</strong> invite them from the Supabase dashboard (Authentication → Users → Invite user).
        They appear here with no role and cannot see anything until you assign one. See docs/STAFF_GUIDE.md.
      </Alert>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {ROLES.map((r) => (
          <Card key={r} className="p-4 text-sm">
            <div className="font-semibold">{ROLE_LABELS[r]}</div>
            <div className="text-slate-600">{ROLE_DESCRIPTIONS[r]}</div>
          </Card>
        ))}
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-blue-50 text-left text-xs font-semibold uppercase tracking-wide text-blue-900">
              <tr>
                <th className="px-4 py-3">Staff member</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-blue-700">
                    <Spinner className="mx-auto h-8 w-8" />
                  </td>
                </tr>
              ) : (
                staff.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {s.full_name || '—'} {s.id === user.id && <Badge tone="blue">You</Badge>}
                      </div>
                      <div className="text-xs text-slate-500">{s.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Role for ${s.email}`}
                        className={`${inputClass} w-48`}
                        value={s.role ?? ''}
                        disabled={savingId === s.id}
                        onChange={(e) =>
                          change(s, { role: e.target.value || null }, `role set to ${ROLE_LABELS[e.target.value] ?? 'none'}`)
                        }
                      >
                        <option value="">No access</option>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {s.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant={s.active ? 'ghost' : 'secondary'}
                        size="sm"
                        disabled={savingId === s.id}
                        onClick={() => change(s, { active: !s.active }, s.active ? 'deactivated' : 'reactivated')}
                      >
                        {s.active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
