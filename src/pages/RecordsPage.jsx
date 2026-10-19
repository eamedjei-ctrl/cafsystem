import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import {
  PAGE_SIZE,
  addRecord,
  correctRecord,
  countRecordsByPeriod,
  feedingPlanSummary,
  fetchAllRecords,
  getSchoolToday,
  listClasses,
  listRecords,
  searchStudents,
} from '../lib/api'
import { can } from '../lib/permissions'
import { downloadCsv, toCsv } from '../lib/csv'
import { formatTime } from '../lib/checkinMessages'
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Pagination, Spinner, inputClass } from '../components/ui'

const METHOD_LABELS = { scan: 'Scan', manual: 'Manual', admin: 'Added by staff' }

function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

export default function RecordsPage() {
  const { role, periods, plans, settings } = useAuth()
  const timeZone = settings.timezone
  const canCorrect = can(role, 'correctRecords')
  const canExport = can(role, 'exportRecords')

  const [today, setToday] = useState(null)
  const [filters, setFilters] = useState({ from: '', to: '', mealPeriod: '', className: '', planCode: '', search: '', status: 'active' })
  const search = useDebounced(filters.search)
  const [page, setPage] = useState(0)
  const [classes, setClasses] = useState([])

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [periodCounts, setPeriodCounts] = useState({})
  const [planSummary, setPlanSummary] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(null)
  const [editing, setEditing] = useState(null) // { record, mode: 'edit' | 'void' | 'restore' }
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    getSchoolToday()
      .then((d) => {
        setToday(d)
        setFilters((f) => ({ ...f, from: d, to: d }))
      })
      .catch((e) => setError(e.message))
    listClasses().then(setClasses).catch(() => {})
  }, [])

  const effective = { ...filters, search }

  const load = useCallback(async () => {
    if (!effective.from) return
    setLoading(true)
    setError(null)
    try {
      const [{ data, count }, counts, summary] = await Promise.all([
        listRecords(effective, page),
        countRecordsByPeriod({ ...effective, mealPeriod: '' }, periods),
        feedingPlanSummary(effective.from, effective.to || effective.from),
      ])
      setRows(data)
      setTotal(count)
      setPeriodCounts(counts)
      setPlanSummary(summary)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [JSON.stringify(effective), page, periods])

  useEffect(() => {
    load()
  }, [load])

  const update = (patch) => {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  async function exportCsv() {
    setExporting(0)
    setError(null)
    try {
      const all = await fetchAllRecords(effective, setExporting)
      const csv = toCsv(
        ['Service date', 'Meal period', 'Check-in time', 'Student ID', 'First name', 'Last name', 'Class', 'Feeding plan', 'Method', 'Recorded by', 'Status', 'Void reason'],
        all.map((r) => [
          r.service_date,
          r.meal_period_label,
          formatTime(r.checked_in_at, timeZone),
          r.student_code,
          r.first_name,
          r.last_name,
          r.class_name,
          r.plan_label ?? 'No plan',
          METHOD_LABELS[r.method],
          r.recorded_by_name,
          r.voided ? 'Voided' : 'Served',
          r.void_reason,
        ]),
      )
      const range = effective.from === effective.to ? effective.from : `${effective.from}_to_${effective.to}`
      downloadCsv(`meal-records_${range}${effective.mealPeriod ? `_${effective.mealPeriod}` : ''}.csv`, csv)
      setNotice(`Exported ${all.length.toLocaleString()} records.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(null)
    }
  }

  const totalServed = Object.values(periodCounts).reduce((a, b) => a + b, 0)

  return (
    <>
      <PageHeader
        title="Meal records"
        description={`Dates use the school time zone (${timeZone}).`}
        actions={
          <>
            {canCorrect && (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                Add missed record
              </Button>
            )}
            {canExport && (
              <Button onClick={exportCsv} disabled={exporting !== null || total === 0}>
                {exporting !== null ? `Exporting… ${exporting.toLocaleString()}` : 'Export CSV'}
              </Button>
            )}
          </>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Field label="From">
            {(id) => (
              <input id={id} type="date" className={inputClass} value={filters.from} max={filters.to || today || undefined} onChange={(e) => update({ from: e.target.value })} />
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <input id={id} type="date" className={inputClass} value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />
            )}
          </Field>
          <Field label="Meal period">
            {(id) => (
              <select id={id} className={inputClass} value={filters.mealPeriod} onChange={(e) => update({ mealPeriod: e.target.value })}>
                <option value="">All periods</option>
                {periods.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Class">
            {(id) => (
              <select id={id} className={inputClass} value={filters.className} onChange={(e) => update({ className: e.target.value })}>
                <option value="">All classes</option>
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Feeding plan">
            {(id) => (
              <select id={id} className={inputClass} value={filters.planCode} onChange={(e) => update({ planCode: e.target.value })}>
                <option value="">All plans</option>
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
                <option value="none">No plan</option>
              </select>
            )}
          </Field>
          <Field label="Student">
            {(id) => (
              <input id={id} type="search" placeholder="Name or ID" className={inputClass} value={filters.search} onChange={(e) => update({ search: e.target.value })} />
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <select id={id} className={inputClass} value={filters.status} onChange={(e) => update({ status: e.target.value })}>
                <option value="active">Served</option>
                <option value="voided">Voided</option>
                <option value="all">All</option>
              </select>
            )}
          </Field>
        </div>
        {today && (
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={() => update({ from: today, to: today })}>
              Today
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const d = new Date(`${today}T00:00:00Z`)
                const dow = (d.getUTCDay() + 6) % 7
                d.setUTCDate(d.getUTCDate() - dow)
                update({ from: d.toISOString().slice(0, 10), to: today })
              }}
            >
              This week
            </Button>
            <Button variant="ghost" size="sm" onClick={() => update({ from: `${today.slice(0, 8)}01`, to: today })}>
              This month
            </Button>
          </div>
        )}
      </Card>

      {/* Summary */}
      <div className="mb-4 flex flex-wrap gap-3">
        <SummaryTile label="Total" value={totalServed} />
        {periods
          .filter((p) => p.active || periodCounts[p.code])
          .map((p) => (
            <SummaryTile key={p.code} label={p.label} value={periodCounts[p.code] ?? 0} />
          ))}
      </div>

      <PlanSummary summary={planSummary} periods={periods} selected={filters.planCode} onSelect={(code) => update({ planCode: code })} />

      {error && <Alert className="mb-4">{error}</Alert>}
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Recorded by</th>
                <th className="px-4 py-3">Status</th>
                {canCorrect && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-teal-700">
                    <Spinner className="mx-auto h-8 w-8" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                    No records match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className={r.voided ? 'bg-slate-50 text-slate-500' : ''}>
                    <td className="whitespace-nowrap px-4 py-3">{r.service_date}</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatTime(r.checked_in_at, timeZone)}</td>
                    <td className="px-4 py-3">{r.meal_period_label}</td>
                    <td className="px-4 py-3">
                      <div className={`font-medium ${r.voided ? 'line-through' : 'text-slate-900'}`}>
                        {r.last_name}, {r.first_name}
                      </div>
                      <div className="text-xs text-slate-500">{r.student_code}</div>
                    </td>
                    <td className="px-4 py-3">{r.class_name}</td>
                    <td className="whitespace-nowrap px-4 py-3">{r.plan_label ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={r.method === 'scan' ? 'slate' : r.method === 'manual' ? 'blue' : 'amber'}>
                        {METHOD_LABELS[r.method]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{r.recorded_by_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      {r.voided ? (
                        <span title={r.void_reason ?? ''}>
                          <Badge tone="red">Voided</Badge>
                        </span>
                      ) : (
                        <Badge tone="green">Served</Badge>
                      )}
                    </td>
                    {canCorrect && (
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {!r.voided && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing({ record: r, mode: 'edit' })}>
                            Edit
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing({ record: r, mode: r.voided ? 'restore' : 'void' })}
                        >
                          {r.voided ? 'Restore' : 'Void'}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
      </Card>

      <CorrectionDialog
        editing={editing}
        periods={periods}
        today={today}
        onClose={() => setEditing(null)}
        onDone={(message) => {
          setEditing(null)
          setNotice(message)
          load()
        }}
      />
      <AddRecordDialog
        open={adding}
        periods={periods}
        today={today}
        onClose={() => setAdding(false)}
        onDone={(message) => {
          setAdding(false)
          setNotice(message)
          load()
        }}
      />
    </>
  )
}

/** "By feeding plan" section: students per plan and meals served per period. */
function PlanSummary({ summary, periods, selected, onSelect }) {
  if (!summary.length) return null
  const shown = periods.filter((p) => p.active || summary.some((s) => s.served[p.code]))
  return (
    <Card className="mb-4 overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold text-slate-900">By feeding plan</h2>
        <p className="text-xs text-slate-500">Meals served in the selected dates, grouped by the plan each student was on. Click a row to filter.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">Section</th>
              <th className="px-4 py-2 text-right">Students</th>
              {shown.map((p) => (
                <th key={p.code} className="px-4 py-2 text-right">
                  {p.label}
                </th>
              ))}
              <th className="px-4 py-2 text-right">Total meals</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.map((s) => {
              const code = s.plan_code ?? 'none'
              const total = Object.values(s.served).reduce((a, b) => a + b, 0)
              return (
                <tr
                  key={code}
                  onClick={() => onSelect(selected === code ? '' : code)}
                  className={`cursor-pointer hover:bg-teal-50 ${selected === code ? 'bg-teal-50' : ''}`}
                >
                  <td className="px-4 py-2 font-medium text-slate-900">
                    {s.meals_per_day && <span className="mr-2 font-black text-teal-700">{s.meals_per_day}×</span>}
                    {s.plan_label}
                  </td>
                  <td className="px-4 py-2 text-right">{s.enrolled}</td>
                  {shown.map((p) => (
                    <td key={p.code} className="px-4 py-2 text-right tabular-nums">
                      {s.served[p.code] ?? 0}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{total}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function SummaryTile({ label, value }) {
  return (
    <div className="min-w-28 rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
      <div className="text-2xl font-bold text-slate-900">{value.toLocaleString()}</div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
    </div>
  )
}

function ReasonField({ value, onChange }) {
  return (
    <Field label="Reason for this change" hint="Required. Saved permanently in the audit log.">
      {(id) => (
        <textarea
          id={id}
          required
          minLength={3}
          maxLength={500}
          rows={2}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}

function CorrectionDialog({ editing, periods, today, onClose, onDone }) {
  const record = editing?.record
  const mode = editing?.mode
  const [mealPeriod, setMealPeriod] = useState('')
  const [serviceDate, setServiceDate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (record) {
      setMealPeriod(record.meal_period)
      setServiceDate(record.service_date)
      setReason('')
      setError(null)
    }
  }, [record])

  if (!record) return <Modal open={false} onClose={onClose} />

  const titles = { edit: 'Edit meal record', void: 'Void meal record', restore: 'Restore meal record' }
  const unchanged = mode === 'edit' && mealPeriod === record.meal_period && serviceDate === record.service_date

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await correctRecord({
        id: record.id,
        reason,
        mealPeriod: mode === 'edit' && mealPeriod !== record.meal_period ? mealPeriod : null,
        serviceDate: mode === 'edit' && serviceDate !== record.service_date ? serviceDate : null,
        voided: mode === 'void' ? true : mode === 'restore' ? false : null,
      })
      const name = `${record.first_name} ${record.last_name}`
      onDone(mode === 'void' ? `Voided the record for ${name}.` : mode === 'restore' ? `Restored the record for ${name}.` : `Updated the record for ${name}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={titles[mode]}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="font-semibold">
            {record.first_name} {record.last_name} ({record.student_code})
          </div>
          <div className="text-slate-600">
            {record.meal_period_label} on {record.service_date}
          </div>
        </div>
        {mode === 'void' && (
          <p className="text-sm text-slate-600">
            Voiding keeps the record for the audit trail but excludes it from counts and exports of served meals. The
            student can then be checked in again for this period.
          </p>
        )}
        {mode === 'edit' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Meal period">
              {(id) => (
                <select id={id} className={inputClass} value={mealPeriod} onChange={(e) => setMealPeriod(e.target.value)}>
                  {periods.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Service date">
              {(id) => (
                <input id={id} type="date" required max={today ?? undefined} className={inputClass} value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
              )}
            </Field>
          </div>
        )}
        <ReasonField value={reason} onChange={setReason} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={mode === 'void' ? 'danger' : 'primary'} disabled={busy || unchanged || reason.trim().length < 3}>
            {busy ? 'Saving…' : mode === 'void' ? 'Void record' : mode === 'restore' ? 'Restore record' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function AddRecordDialog({ open, periods, today, onClose, onDone }) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [student, setStudent] = useState(null)
  const [mealPeriod, setMealPeriod] = useState('')
  const [serviceDate, setServiceDate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setMatches([])
      setStudent(null)
      setMealPeriod(periods.find((p) => p.active)?.code ?? '')
      setServiceDate(today ?? '')
      setReason('')
      setError(null)
    }
  }, [open, periods, today])

  useEffect(() => {
    if (student || query.trim().length < 2) {
      setMatches([])
      return undefined
    }
    const id = setTimeout(() => {
      searchStudents(query.trim()).then(setMatches).catch((e) => setError(e.message))
    }, 250)
    return () => clearTimeout(id)
  }, [query, student])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await addRecord({ studentCode: student.student_code, mealPeriod, serviceDate, reason })
      onDone(`Added a record for ${student.first_name} ${student.last_name}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a missed meal record">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Use this when a student was served but not checked in (for example, the scanner was down).
        </p>
        {student ? (
          <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm">
            <span>
              <span className="font-semibold">
                {student.first_name} {student.last_name}
              </span>{' '}
              ({student.student_code}) {student.class_name && `· ${student.class_name}`}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setStudent(null)}>
              Change
            </Button>
          </div>
        ) : (
          <Field label="Student">
            {(id) => (
              <>
                <input id={id} className={inputClass} placeholder="Search name or ID" value={query} onChange={(e) => setQuery(e.target.value)} />
                {matches.length > 0 && (
                  <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg ring-1 ring-slate-200">
                    {matches.map((m) => (
                      <li key={m.student_code}>
                        <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-teal-50" onClick={() => setStudent(m)}>
                          {m.last_name}, {m.first_name} · {m.student_code} {m.class_name && `· ${m.class_name}`}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Meal period">
            {(id) => (
              <select id={id} className={inputClass} value={mealPeriod} onChange={(e) => setMealPeriod(e.target.value)}>
                {periods.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Service date">
            {(id) => (
              <input id={id} type="date" required max={today ?? undefined} className={inputClass} value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
            )}
          </Field>
        </div>
        <ReasonField value={reason} onChange={setReason} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !student || !mealPeriod || !serviceDate || reason.trim().length < 3}>
            {busy ? 'Saving…' : 'Add record'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
