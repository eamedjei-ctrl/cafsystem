import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../lib/auth'
import { countStudentsByPlan, setFeedingPlan } from '../lib/api'
import { can } from '../lib/permissions'
import { Alert, Button, Card, PageHeader, inputClass } from '../components/ui'

export default function PlansPage() {
  const { role, plans, periods, reloadPlans } = useAuth()
  const canEdit = can(role, 'manageStudents')
  const [counts, setCounts] = useState({})
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    countStudentsByPlan(plans).then(setCounts).catch(() => {})
  }, [plans])

  return (
    <>
      <PageHeader
        title="Feeding plans"
        description="Each student belongs to one section: fed once, twice or three times a day. Check-in only allows the meal periods in the student's plan, up to the daily limit."
      />
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.code}
            plan={plan}
            periods={periods}
            students={counts[plan.code]}
            canEdit={canEdit}
            onSaved={async (label) => {
              await reloadPlans()
              setNotice(`Saved “${label}”.`)
            }}
          />
        ))}
      </div>
      <Card className="mt-4 p-4 text-sm text-slate-600">
        <strong className="text-slate-900">{counts.none ?? 0}</strong> active student(s) have <strong>no plan</strong>. They
        are not restricted at check-in.{' '}
        <Link to="/students?plan=none" className="font-medium text-teal-700 underline">
          Assign plans on the Students page
        </Link>
        .
      </Card>
    </>
  )
}

function PlanCard({ plan, periods, students, canEdit, onSaved }) {
  const [label, setLabel] = useState(plan.label)
  const [mealsPerDay, setMealsPerDay] = useState(plan.meals_per_day)
  const [chosen, setChosen] = useState(plan.periods)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLabel(plan.label)
    setMealsPerDay(plan.meals_per_day)
    setChosen(plan.periods)
  }, [plan])

  const usable = periods.filter((p) => p.active || chosen.includes(p.code))
  const dirty =
    label !== plan.label || mealsPerDay !== plan.meals_per_day || [...chosen].sort().join() !== [...plan.periods].sort().join()
  const toggle = (code) => setChosen((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await setFeedingPlan({ code: plan.code, label: label.trim(), mealsPerDay, periods: chosen })
      await onSaved(label.trim())
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const labels = periods.filter((p) => chosen.includes(p.code)).map((p) => p.label)
  const rule =
    mealsPerDay >= chosen.length
      ? `Served at ${labels.join(', ') || '—'}.`
      : `Any ${mealsPerDay} of ${labels.join(', ')} each day.`

  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-3xl font-black text-teal-700">{plan.meals_per_day}×</div>
          <h2 className="text-lg font-bold text-slate-900">{plan.label}</h2>
        </div>
        <Link to={`/students?plan=${plan.code}`} className="rounded-lg bg-slate-100 px-3 py-1.5 text-center text-sm hover:bg-slate-200">
          <span className="block text-xl font-bold text-slate-900">{students ?? '…'}</span>
          <span className="text-xs text-slate-600">students</span>
        </Link>
      </div>

      <p className="mb-4 text-sm text-slate-600">{rule}</p>

      {canEdit && (
        <div className="mt-auto space-y-3 border-t border-slate-100 pt-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Name</span>
            <input className={inputClass} value={label} maxLength={50} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Meal periods included</legend>
            <div className="flex flex-wrap gap-2">
              {usable.map((p) => (
                <label
                  key={p.code}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ${
                    chosen.includes(p.code) ? 'bg-teal-50 ring-teal-400' : 'ring-slate-300'
                  }`}
                >
                  <input type="checkbox" checked={chosen.includes(p.code)} onChange={() => toggle(p.code)} />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Meals allowed per day</span>
            <select className={inputClass} value={mealsPerDay} onChange={(e) => setMealsPerDay(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n} disabled={n > chosen.length}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {error && <Alert>{error}</Alert>}
          <Button onClick={save} disabled={!dirty || busy || chosen.length === 0 || !label.trim()} className="w-full">
            {busy ? 'Saving…' : 'Save plan'}
          </Button>
        </div>
      )}
    </Card>
  )
}
