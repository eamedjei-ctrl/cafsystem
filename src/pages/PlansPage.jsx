import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../lib/auth'
import { countStudentsByPlan, setFeedingPlan } from '../lib/api'
import { can } from '../lib/permissions'
import { CHIT_COLORS } from '../lib/chits'
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
        description="Each student belongs to one section: fed once, twice or three times a day. Check-in only allows the meal periods in the student's plan, up to the daily limit, and shows which colour chit to collect."
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
    </>
  )
}

function PlanCard({ plan, periods, students, canEdit, onSaved }) {
  const [label, setLabel] = useState(plan.label)
  const [mealsPerDay, setMealsPerDay] = useState(plan.meals_per_day)
  const [chosen, setChosen] = useState(plan.periods)
  const [chits, setChits] = useState(plan.chits ?? {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLabel(plan.label)
    setMealsPerDay(plan.meals_per_day)
    setChosen(plan.periods)
    setChits(plan.chits ?? {})
  }, [plan])

  const usable = periods.filter((p) => p.active || chosen.includes(p.code))
  const chitKey = (map, codes) => codes.map((c) => `${c}:${map?.[c] ?? ''}`).sort().join()
  const dirty =
    label !== plan.label ||
    mealsPerDay !== plan.meals_per_day ||
    [...chosen].sort().join() !== [...plan.periods].sort().join() ||
    chitKey(chits, chosen) !== chitKey(plan.chits, chosen)
  const toggle = (code) => setChosen((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await setFeedingPlan({ code: plan.code, label: label.trim(), mealsPerDay, periods: chosen, chits })
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
          <div className="text-3xl font-black text-blue-700">{plan.meals_per_day}×</div>
          <h2 className="text-lg font-bold text-slate-900">{plan.label}</h2>
        </div>
        <Link to={`/students?plan=${plan.code}`} className="rounded-lg bg-slate-100 px-3 py-1.5 text-center text-sm hover:bg-slate-200">
          <span className="block text-xl font-bold text-slate-900">{students ?? '…'}</span>
          <span className="text-xs text-slate-600">students</span>
        </Link>
      </div>

      <p className="mb-3 text-sm text-slate-600">{rule}</p>

      <ul className="mb-4 space-y-1.5" aria-label="Meal chits">
        {periods
          .filter((p) => plan.periods.includes(p.code))
          .map((p) => (
            <li key={p.code} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-slate-700">{p.label}</span>
              <ChitChip color={plan.chits?.[p.code]} />
            </li>
          ))}
      </ul>

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
                    chosen.includes(p.code) ? 'bg-blue-50 ring-blue-400' : 'ring-slate-300'
                  }`}
                >
                  <input type="checkbox" checked={chosen.includes(p.code)} onChange={() => toggle(p.code)} />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>
          {chosen.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-slate-700">Chit colour</legend>
              {usable
                .filter((p) => chosen.includes(p.code))
                .map((p) => (
                  <label key={p.code} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-700">{p.label}</span>
                    <select
                      className={`${inputClass} w-40`}
                      value={chits[p.code] ?? ''}
                      onChange={(e) => setChits((c) => ({ ...c, [p.code]: e.target.value }))}
                    >
                      <option value="">No chit</option>
                      {Object.entries(CHIT_COLORS).map(([key, c]) => (
                        <option key={key} value={key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
            </fieldset>
          )}
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

function ChitChip({ color }) {
  const chit = CHIT_COLORS[color]
  if (!chit) return <span className="text-xs text-slate-400">No chit</span>
  return <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${chit.swatch}`}>{chit.label} chit</span>
}
