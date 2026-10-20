import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { PAGE_SIZE, getSchoolToday, studentMealCounts } from '../lib/api'
import { can } from '../lib/permissions'
import { downloadCsv, toCsv } from '../lib/csv'
import { Alert, Button, Card, Field, PageHeader, Pagination, Spinner, inputClass } from '../components/ui'

const EXPORT_PAGE = 1000

function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

export default function TimesFedPage() {
  const { role, settings } = useAuth()
  const canExport = can(role, 'exportRecords')

  const [today, setToday] = useState(null)
  const [filters, setFilters] = useState({ from: '', to: '', search: '' })
  const search = useDebounced(filters.search)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getSchoolToday()
      .then((d) => {
        setToday(d)
        setFilters((f) => ({ ...f, from: d, to: d }))
      })
      .catch((e) => setError(e.message))
  }, [])

  const effective = { from: filters.from, to: filters.to || filters.from, search }

  const load = useCallback(async () => {
    if (!effective.from) return
    setLoading(true)
    setError(null)
    try {
      const { data, count } = await studentMealCounts(effective, page)
      setRows(data)
      setTotal(count)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [JSON.stringify(effective), page])

  useEffect(() => {
    load()
  }, [load])

  const update = (patch) => {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  async function exportCsv() {
    setExporting(true)
    setError(null)
    try {
      const all = []
      for (let p = 0; ; p++) {
        const { data, count } = await studentMealCounts(effective, p, EXPORT_PAGE)
        all.push(...data)
        if (all.length >= count || data.length === 0) break
      }
      const csv = toCsv(
        ['Student name', 'Student ID', 'Times fed'],
        all.map((r) => [`${r.first_name} ${r.last_name}`, r.student_code, r.times_fed]),
      )
      const range = effective.from === effective.to ? effective.from : `${effective.from}_to_${effective.to}`
      downloadCsv(`times-fed_${range}.csv`, csv)
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Times fed"
        description={`How many meals each student was served in the chosen dates. Voided records are not counted. Dates use the school time zone (${settings.timezone}).`}
        actions={
          canExport && (
            <Button onClick={exportCsv} disabled={exporting || total === 0}>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
          )
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
          <Field label="Student" className="col-span-2">
            {(id) => (
              <input id={id} type="search" placeholder="Name or ID" className={inputClass} value={filters.search} onChange={(e) => update({ search: e.target.value })} />
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
                d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
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

      {error && <Alert className="mb-4">{error}</Alert>}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-blue-50 text-left text-xs font-semibold uppercase tracking-wide text-blue-900">
              <tr>
                <th className="px-4 py-3">Student name</th>
                <th className="px-4 py-3">Student ID</th>
                <th className="px-4 py-3 text-right">Times fed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-blue-700">
                    <Spinner className="mx-auto h-8 w-8" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                    No students match.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.student_code}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {r.first_name} {r.last_name}
                    </td>
                    <td className="px-4 py-3 font-mono">{r.student_code}</td>
                    <td className={`px-4 py-3 text-right text-base font-semibold tabular-nums ${r.times_fed ? 'text-blue-800' : 'text-slate-400'}`}>
                      {r.times_fed}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
      </Card>
    </>
  )
}
