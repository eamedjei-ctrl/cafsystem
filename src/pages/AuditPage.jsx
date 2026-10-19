import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { PAGE_SIZE, listAudit, listStaff } from '../lib/api'
import { Alert, Badge, Card, Field, PageHeader, Pagination, Spinner, inputClass } from '../components/ui'

const TABLE_LABELS = {
  meal_records: 'Meal record',
  students: 'Student',
  staff_profiles: 'Staff',
  meal_periods: 'Meal period',
  app_settings: 'Settings',
}
const ACTION_TONES = { INSERT: 'green', UPDATE: 'amber', DELETE: 'red' }
const HIDDEN_FIELDS = new Set(['updated_at', 'created_at'])

/** Fields whose value differs between old and new (or all fields for insert/delete). */
export function changedFields(entry) {
  const oldData = entry.old_data ?? {}
  const newData = entry.new_data ?? {}
  const keys = [...new Set([...Object.keys(oldData), ...Object.keys(newData)])].filter((k) => !HIDDEN_FIELDS.has(k))
  return keys
    .filter((k) => JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]))
    .map((k) => ({ field: k, from: oldData[k], to: newData[k] }))
}

const show = (v) => (v === null || v === undefined || v === '' ? '∅' : String(v))

export default function AuditPage() {
  const { settings } = useAuth()
  const timeZone = settings.timezone
  const [filters, setFilters] = useState({ table: '', from: '', to: '' })
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [staffNames, setStaffNames] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    listStaff()
      .then((list) => setStaffNames(Object.fromEntries(list.map((s) => [s.id, s.full_name || s.email]))))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, count } = await listAudit(filters, page, timeZone)
      setRows(data)
      setTotal(count)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters, page, timeZone])

  useEffect(() => {
    load()
  }, [load])

  const update = (patch) => {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  const fmt = new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' })

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every correction, roster change and staff access change. Entries cannot be edited or deleted."
      />
      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <Field label="Type">
          {(id) => (
            <select id={id} className={inputClass} value={filters.table} onChange={(e) => update({ table: e.target.value })}>
              <option value="">All</option>
              {Object.entries(TABLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="From">
          {(id) => <input id={id} type="date" className={inputClass} value={filters.from} onChange={(e) => update({ from: e.target.value })} />}
        </Field>
        <Field label="To">
          {(id) => <input id={id} type="date" className={inputClass} value={filters.to} onChange={(e) => update({ to: e.target.value })} />}
        </Field>
      </Card>

      {error && <Alert className="mb-4">{error}</Alert>}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-10 text-center text-teal-700">
            <Spinner className="mx-auto h-8 w-8" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-slate-500">No audit entries match.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((entry) => {
              const data = entry.new_data ?? entry.old_data ?? {}
              const subject =
                entry.table_name === 'students'
                  ? `${data.first_name ?? ''} ${data.last_name ?? ''} (${data.student_code ?? ''})`
                  : entry.table_name === 'staff_profiles'
                    ? data.email
                    : entry.table_name === 'meal_records'
                      ? `${data.meal_period} on ${data.service_date}`
                      : entry.record_id
              return (
                <li key={entry.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={ACTION_TONES[entry.action]}>{entry.action}</Badge>
                    <span className="font-medium text-slate-900">{TABLE_LABELS[entry.table_name] ?? entry.table_name}</span>
                    <span className="text-slate-600">{subject}</span>
                    <span className="ml-auto text-xs text-slate-500">
                      {fmt.format(new Date(entry.changed_at))} ·{' '}
                      {entry.changed_by ? staffNames[entry.changed_by] ?? 'Unknown staff' : 'System / database'}
                    </span>
                  </div>
                  {entry.reason && <div className="mt-1 text-slate-700">Reason: {entry.reason}</div>}
                  {entry.action === 'UPDATE' && (
                    <ul className="mt-1 space-y-0.5 font-mono text-xs text-slate-600">
                      {changedFields(entry).map((c) => (
                        <li key={c.field}>
                          {c.field}: {show(c.from)} → {show(c.to)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
      </Card>
    </>
  )
}
