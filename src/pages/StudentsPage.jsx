import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../lib/auth'
import { PAGE_SIZE, countStudentsByPlan, importStudents, listClasses, listStudents, saveStudent } from '../lib/api'
import { can } from '../lib/permissions'
import { parseRoster, ROSTER_TEMPLATE } from '../lib/roster'
import { downloadCsv } from '../lib/csv'
import { isValidStudentCode, normalizeStudentCode } from '../lib/studentCode'
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Pagination, Spinner, inputClass } from '../components/ui'

export default function StudentsPage() {
  const { role, plans } = useAuth()
  const canManage = can(role, 'manageStudents')
  const [params, setParams] = useSearchParams()
  const planCode = params.get('plan') ?? ''
  const [planCounts, setPlanCounts] = useState({})
  const planLabel = (code) => plans.find((p) => p.code === code)?.label

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [className, setClassName] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [page, setPage] = useState(0)
  const [classes, setClasses] = useState([])
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [editing, setEditing] = useState(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search)
      setPage(0)
    }, 300)
    return () => clearTimeout(id)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [{ data, count }, counts] = await Promise.all([
        listStudents({ search: debounced, className, includeInactive, planCode }, page),
        countStudentsByPlan(plans, { includeInactive }),
      ])
      setRows(data)
      setTotal(count)
      setPlanCounts(counts)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [debounced, className, includeInactive, planCode, plans, page])

  useEffect(() => {
    load()
  }, [load])

  const refreshClasses = () => listClasses().then(setClasses).catch(() => {})
  useEffect(() => {
    refreshClasses()
  }, [])

  const done = (message) => {
    setEditing(null)
    setImporting(false)
    setNotice(message)
    load()
    refreshClasses()
  }

  return (
    <>
      <PageHeader
        title="Students"
        description="Only the student ID, name, class, feeding plan and active status are stored."
        actions={
          canManage && (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)}>
                Import roster CSV
              </Button>
              <Button
                onClick={() =>
                  setEditing({
                    student_code: '',
                    first_name: '',
                    last_name: '',
                    class_name: '',
                    active: true,
                    plan_code: planCode && planCode !== 'none' ? planCode : '',
                  })
                }
              >
                Add student
              </Button>
            </>
          )
        }
      />

      {/* Feeding-plan sections */}
      <div role="tablist" aria-label="Feeding plan" className="mb-4 flex flex-wrap gap-2">
        {[
          { code: '', label: 'All students', count: Object.values(planCounts).reduce((a, b) => a + b, 0) },
          ...plans.map((p) => ({ code: p.code, label: p.label, count: planCounts[p.code] })),
          { code: 'none', label: 'No plan', count: planCounts.none },
        ].map((tab) => {
          const selected = tab.code === planCode
          return (
            <button
              key={tab.code || 'all'}
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setParams(tab.code ? { plan: tab.code } : {})
                setPage(0)
              }}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 transition-colors ${
                selected ? 'bg-teal-700 text-white ring-teal-700' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
              } ${tab.code === 'none' && tab.count > 0 && !selected ? 'text-amber-800 ring-amber-300' : ''}`}
            >
              {tab.label}
              <span className={`rounded-full px-2 py-0.5 text-xs ${selected ? 'bg-white/20' : 'bg-slate-100'}`}>
                {tab.count ?? '…'}
              </span>
            </button>
          )
        })}
      </div>
      {planCode === 'none' && planCounts.none > 0 && (
        <Alert tone="warning" className="mb-4">
          These students have no feeding plan, so check-in does not restrict them. {canManage && 'Edit each one, or import a roster CSV with a plan column.'}
        </Alert>
      )}

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="Search" className="min-w-56 flex-1">
          {(id) => <input id={id} type="search" placeholder="Name or ID" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} />}
        </Field>
        <Field label="Class">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={className}
              onChange={(e) => {
                setClassName(e.target.value)
                setPage(0)
              }}
            >
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => {
              setIncludeInactive(e.target.checked)
              setPage(0)
            }}
          />
          Include inactive
        </label>
      </Card>

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
                <th className="px-4 py-3">Student ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Feeding plan</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-teal-700">
                    <Spinner className="mx-auto h-8 w-8" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No students found.
                  </td>
                </tr>
              ) : (
                rows.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-mono">{s.student_code}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {s.last_name}, {s.first_name}
                    </td>
                    <td className="px-4 py-3">{s.class_name}</td>
                    <td className="px-4 py-3">
                      {s.plan_code ? <Badge tone="blue">{planLabel(s.plan_code) ?? s.plan_code}</Badge> : <Badge tone="amber">No plan</Badge>}
                    </td>
                    <td className="px-4 py-3">{s.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                          Edit
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

      {canManage && (
        <>
          <StudentDialog student={editing} plans={plans} onClose={() => setEditing(null)} onDone={done} />
          <ImportDialog open={importing} plans={plans} onClose={() => setImporting(false)} onDone={done} />
        </>
      )}
    </>
  )
}

function StudentDialog({ student, plans, onClose, onDone }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setForm(student ? { ...student, plan_code: student.plan_code ?? '' } : null)
    setError(null)
  }, [student])

  if (!form) return <Modal open={false} onClose={onClose} />

  const code = normalizeStudentCode(form.student_code)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  async function submit(e) {
    e.preventDefault()
    if (!isValidStudentCode(code)) {
      setError('Student ID must be 1–32 letters, digits, "-" or "_".')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveStudent({ ...form, student_code: code })
      onDone(form.id ? `Saved ${form.first_name} ${form.last_name}.` : `Added ${form.first_name} ${form.last_name}.`)
    } catch (err) {
      setError(/duplicate key|students_student_code_key/.test(err.message) ? 'Another student already has this ID.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={form.id ? 'Edit student' : 'Add student'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Student ID" hint={form.id ? 'This must match the code on the student’s card. Changing it does not affect past records.' : 'The value encoded on the ID card barcode / QR code.'}>
          {(id) => <input id={id} required className={`${inputClass} font-mono`} value={form.student_code} onChange={(e) => set({ student_code: e.target.value })} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            {(id) => <input id={id} required maxLength={100} className={inputClass} value={form.first_name} onChange={(e) => set({ first_name: e.target.value })} />}
          </Field>
          <Field label="Last name">
            {(id) => <input id={id} required maxLength={100} className={inputClass} value={form.last_name} onChange={(e) => set({ last_name: e.target.value })} />}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Class">
            {(id) => <input id={id} maxLength={50} className={inputClass} value={form.class_name} onChange={(e) => set({ class_name: e.target.value })} />}
          </Field>
          <Field label="Feeding plan">
            {(id) => (
              <select id={id} className={inputClass} value={form.plan_code} onChange={(e) => set({ plan_code: e.target.value })}>
                <option value="">No plan (not restricted)</option>
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
          <span>
            Active
            <span className="block text-slate-500">Inactive students cannot be checked in. Their past records are kept.</span>
          </span>
        </label>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ImportDialog({ open, plans, onClose, onDone }) {
  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) {
      setParsed(null)
      setFileName('')
      setProgress(null)
      setError(null)
    }
  }, [open])

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (file.size > 5 * 1024 * 1024) {
      setError('That file is larger than 5 MB. Split it into smaller files.')
      return
    }
    setFileName(file.name)
    setParsed(parseRoster(await file.text(), plans))
  }

  async function runImport() {
    setProgress(0)
    setError(null)
    try {
      const r = await importStudents(parsed.rows, setProgress)
      onDone(`Import complete: ${r.inserted} added, ${r.updated} updated, ${r.unchanged} unchanged.`)
    } catch (err) {
      setError(`Import failed and was not applied for the failing batch: ${err.message}`)
      setProgress(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import student roster" wide>
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          Upload a CSV with the columns <code>student_id, first_name, last_name, class</code> and optionally{' '}
          <code>plan</code> (<code>once</code>, <code>twice</code> or <code>thrice</code>) and <code>active</code> (yes/no). If
          the file has no <code>plan</code> column, existing plans are kept. Students are matched by student ID: existing students are updated, new ones are
          added. Students missing from the file are <strong>not</strong> removed. Deactivate them individually, or include
          them with <code>active</code> set to <code>no</code>.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" aria-label="Roster CSV file" />
          <Button variant="ghost" size="sm" onClick={() => downloadCsv('roster-template.csv', ROSTER_TEMPLATE)}>
            Download template
          </Button>
        </div>

        {parsed && (
          <>
            <Alert tone={parsed.errors.length ? 'error' : 'info'}>
              <strong>{fileName}</strong>: {parsed.rows.length} valid row(s)
              {parsed.errors.length > 0 && `, ${parsed.errors.length} row(s) with problems. Fix them and upload again.`}
            </Alert>
            {parsed.errors.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-red-50 p-3 text-red-800">
                {parsed.errors.slice(0, 100).map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
                {parsed.errors.length > 100 && <li>…and {parsed.errors.length - 100} more</li>}
              </ul>
            )}
            {parsed.errors.length === 0 && parsed.rows.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-lg ring-1 ring-slate-200">
                <table className="min-w-full text-xs">
                  <tbody className="divide-y divide-slate-100">
                    {parsed.rows.slice(0, 10).map((r) => (
                      <tr key={r.student_code}>
                        <td className="px-3 py-1.5 font-mono">{r.student_code}</td>
                        <td className="px-3 py-1.5">
                          {r.last_name}, {r.first_name}
                        </td>
                        <td className="px-3 py-1.5">{r.class_name}</td>
                        {'plan_code' in r && (
                          <td className="px-3 py-1.5">{plans.find((p) => p.code === r.plan_code)?.label ?? 'No plan'}</td>
                        )}
                        <td className="px-3 py-1.5">{r.active ? 'Active' : 'Inactive'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 10 && <p className="px-3 py-1.5 text-slate-500">…and {parsed.rows.length - 10} more</p>}
              </div>
            )}
          </>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={runImport} disabled={!parsed || parsed.errors.length > 0 || parsed.rows.length === 0 || progress !== null}>
            {progress !== null ? `Importing… ${progress}/${parsed.rows.length}` : `Import ${parsed?.rows.length ?? ''} students`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
