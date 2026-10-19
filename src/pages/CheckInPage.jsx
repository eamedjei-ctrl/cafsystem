import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../lib/auth'
import { checkIn, searchStudents } from '../lib/api'
import { can } from '../lib/permissions'
import { RepeatGuard } from '../lib/scanner'
import { useScanner } from '../lib/useScanner'
import { isValidStudentCode, normalizeStudentCode } from '../lib/studentCode'
import { suggestMealPeriod } from '../lib/mealPeriods'
import { describeCheckIn, formatTime, fullName } from '../lib/checkinMessages'
import { playFeedback, unlockAudio } from '../lib/feedback'
import { Alert, Button, Modal, Spinner, inputClass } from '../components/ui'

const PERIOD_STORAGE_KEY = 'checkin.mealPeriod'
const SOUND_STORAGE_KEY = 'checkin.sound'
const DISPLAY_MS = { success: 3500, warning: 6000, error: 7000 }

const TONE_STYLES = {
  success: 'bg-emerald-600 text-white',
  warning: 'bg-amber-400 text-amber-950',
  error: 'bg-red-600 text-white',
}
const TONE_ICONS = { success: '✓', warning: '!', error: '✕' }

function readStorage(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable (private mode): settings just won't persist
  }
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** Keep the tablet screen awake during service (where supported). */
function useWakeLock() {
  useEffect(() => {
    let lock = null
    const request = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          lock = await navigator.wakeLock.request('screen')
        }
      } catch {
        // not supported or denied; harmless
      }
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => {
      document.removeEventListener('visibilitychange', request)
      lock?.release().catch(() => {})
    }
  }, [])
}

export default function CheckInPage() {
  const { settings, periods, role, profile, signOut } = useAuth()
  const timeZone = settings.timezone
  const activePeriods = periods.filter((p) => p.active)
  const online = useOnline()
  useWakeLock()

  const [periodCode, setPeriodCode] = useState(() => {
    const saved = readStorage(PERIOD_STORAGE_KEY)
    if (saved && activePeriods.some((p) => p.code === saved)) return saved
    return suggestMealPeriod(periods, new Date(), timeZone)?.code ?? ''
  })
  const period = activePeriods.find((p) => p.code === periodCode)

  const [sound, setSound] = useState(() => readStorage(SOUND_STORAGE_KEY) !== 'off')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null) // { tone, title, detail, subtitle, key }
  const [recent, setRecent] = useState([])
  const [servedCount, setServedCount] = useState(null)
  const [lookupOpen, setLookupOpen] = useState(false)

  const guard = useRef(new RepeatGuard(3000))
  const queue = useRef(Promise.resolve())
  const clearTimer = useRef(null)

  // Offer to switch when the current time moves into a different meal period.
  const [suggested, setSuggested] = useState(null)
  useEffect(() => {
    const tick = () => {
      const s = suggestMealPeriod(periods, new Date(), timeZone)
      setSuggested(s && s.code !== periodCode ? s : null)
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [periods, timeZone, periodCode])

  const choosePeriod = (code) => {
    setPeriodCode(code)
    writeStorage(PERIOD_STORAGE_KEY, code)
    setServedCount(null)
    setFeedback(null)
    guard.current.reset()
  }

  const show = useCallback(
    (message) => {
      clearTimeout(clearTimer.current)
      setFeedback({ ...message, key: Date.now() })
      if (sound) playFeedback(message.tone)
      clearTimer.current = setTimeout(() => setFeedback(null), DISPLAY_MS[message.tone])
    },
    [sound],
  )

  const submit = useCallback(
    (rawCode, method) => {
      // Process scans one at a time, in order, even if they arrive quickly.
      queue.current = queue.current.then(async () => {
        const code = normalizeStudentCode(rawCode)
        if (!period) {
          show({ tone: 'error', title: 'Choose a meal period', detail: 'Select the meal period at the top of the screen first.' })
          return
        }
        if (!isValidStudentCode(code)) {
          show(describeCheckIn({ status: 'invalid_id', student_code: code }, timeZone))
          return
        }
        if (!navigator.onLine) {
          show({
            tone: 'error',
            title: 'No connection',
            detail: 'This device is offline, so the check-in was NOT recorded. Reconnect, then scan again.',
          })
          return
        }
        setBusy(true)
        try {
          const result = await checkIn(code, period.code, method)
          const message = describeCheckIn(result, timeZone)
          show(message)
          if ('served_count' in result) setServedCount(result.served_count)
          setRecent((r) =>
            [
              {
                key: `${Date.now()}-${code}`,
                tone: message.tone,
                name: result.student ? fullName(result.student) : code,
                note:
                  result.status === 'ok'
                    ? method === 'manual'
                      ? 'Manual'
                      : 'Scanned'
                    : message.title.split(':')[0],
                at: new Date().toISOString(),
              },
              ...r,
            ].slice(0, 12),
          )
        } catch (err) {
          show({
            tone: 'error',
            title: 'Check-in failed',
            detail: `${err.message || 'Network error'}. The meal was NOT recorded. Please scan again.`,
          })
        } finally {
          setBusy(false)
        }
      })
      return queue.current
    },
    [period, show, timeZone],
  )

  useScanner(
    ({ code }) => {
      // Ignore a double-fire or a card held under the scanner.
      if (guard.current.shouldIgnore(normalizeStudentCode(code), Date.now())) return
      submit(code, 'scan')
    },
    { enabled: !lookupOpen },
  )

  const toggleSound = () => {
    unlockAudio()
    setSound((s) => {
      writeStorage(SOUND_STORAGE_KEY, s ? 'off' : 'on')
      return !s
    })
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white" onPointerDown={unlockAudio}>
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="mr-2">
          <div className="text-xs uppercase tracking-wider text-slate-400">{settings.school_name}</div>
          <div className="text-lg font-bold">Meal check-in</div>
        </div>
        <div role="radiogroup" aria-label="Meal period" className="flex flex-wrap gap-2">
          {activePeriods.map((p) => (
            <button
              key={p.code}
              role="radio"
              aria-checked={p.code === periodCode}
              onClick={() => choosePeriod(p.code)}
              className={`rounded-xl px-5 py-3 text-base font-semibold transition-colors ${
                p.code === periodCode ? 'bg-white text-slate-900' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {servedCount !== null && (
            <div className="rounded-xl bg-white/10 px-4 py-2 text-center" aria-live="polite">
              <div className="text-2xl font-bold leading-none">{servedCount}</div>
              <div className="text-xs text-slate-300">served</div>
            </div>
          )}
          <Button variant="secondary" size="lg" onClick={() => setLookupOpen(true)}>
            Manual lookup
          </Button>
        </div>
      </header>

      {!online && (
        <div role="alert" className="bg-red-600 px-4 py-2 text-center font-semibold">
          Offline: check-ins cannot be recorded until the connection returns.
        </div>
      )}
      {suggested && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-sky-700 px-4 py-2 text-sm">
          It is now {suggested.label} time.
          <button onClick={() => choosePeriod(suggested.code)} className="rounded-lg bg-white px-3 py-1 font-semibold text-sky-800">
            Switch to {suggested.label}
          </button>
        </div>
      )}

      {/* Main status panel */}
      <main className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section
          aria-live="assertive"
          className="flex min-h-[50vh] flex-1 cursor-pointer items-center justify-center rounded-3xl"
          onClick={() => setFeedback(null)}
        >
          {feedback ? (
            <div
              key={feedback.key}
              className={`animate-pop-in flex h-full w-full flex-col items-center justify-center rounded-3xl p-8 text-center ${TONE_STYLES[feedback.tone]}`}
            >
              <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-black/10 text-6xl font-black">
                {TONE_ICONS[feedback.tone]}
              </div>
              <div className="text-4xl font-extrabold leading-tight md:text-6xl">{feedback.title}</div>
              {feedback.subtitle && <div className="mt-2 text-2xl font-semibold opacity-90">{feedback.subtitle}</div>}
              <div className="mt-4 max-w-2xl text-xl md:text-2xl">{feedback.detail}</div>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center rounded-3xl border-4 border-dashed border-white/15 p-8 text-center">
              {busy ? (
                <Spinner className="h-16 w-16 text-white" />
              ) : period ? (
                <>
                  <div className="text-6xl" aria-hidden="true">
                    ▥
                  </div>
                  <div className="mt-4 text-4xl font-bold md:text-5xl">Ready to scan</div>
                  <div className="mt-2 text-xl text-slate-300">
                    {period.label} · scan a student ID card
                  </div>
                </>
              ) : (
                <div className="text-3xl font-bold">Select a meal period to begin</div>
              )}
            </div>
          )}
        </section>

        {/* Recent check-ins on this device */}
        <aside className="w-full rounded-3xl bg-white/5 p-4 lg:w-80">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Recent on this device</h2>
          {recent.length === 0 ? (
            <p className="text-slate-400">No scans yet.</p>
          ) : (
            <ul className="space-y-2">
              {recent.map((r) => (
                <li key={r.key} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
                  <span
                    className={`h-3 w-3 shrink-0 rounded-full ${
                      r.tone === 'success' ? 'bg-emerald-400' : r.tone === 'warning' ? 'bg-amber-400' : 'bg-red-500'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="text-xs text-slate-400">
                      {r.note} · {formatTime(r.at, timeZone)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </main>

      <footer className="flex flex-wrap items-center gap-2 px-4 pb-4 text-sm text-slate-400">
        <span>{profile?.full_name || profile?.email}</span>
        <span className="flex-1" />
        <Button variant="dark" onClick={toggleSound}>
          Sound: {sound ? 'on' : 'off'}
        </Button>
        <Button variant="dark" onClick={toggleFullscreen}>
          Full screen
        </Button>
        {can(role, 'viewRecords') && (
          <Link to="/records" className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10 hover:text-white">
            Dashboard
          </Link>
        )}
        <Button variant="dark" onClick={signOut}>
          Sign out
        </Button>
      </footer>

      <ManualLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        periodLabel={period?.label}
        onPick={(code) => {
          setLookupOpen(false)
          submit(code, 'manual')
        }}
      />
    </div>
  )
}

function ManualLookup({ open, onClose, onPick, periodLabel }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setError(null)
    }
  }, [open])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return undefined
    }
    let cancelled = false
    const id = setTimeout(async () => {
      setSearching(true)
      setError(null)
      try {
        const rows = await searchStudents(q)
        if (!cancelled) setResults(rows)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [query])

  const typedCode = normalizeStudentCode(query)

  return (
    <Modal open={open} onClose={onClose} title={`Manual lookup${periodLabel ? ` · ${periodLabel}` : ''}`} wide>
      <div className="space-y-4">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length === 1) onPick(results[0].student_code)
          }}
          placeholder="Type a name or student ID (at least 2 characters)"
          className={`${inputClass} py-4 text-xl`}
          aria-label="Search students"
        />
        {error && <Alert>{error}</Alert>}
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {searching && results.length === 0 && (
            <div className="flex justify-center py-6 text-teal-700">
              <Spinner className="h-8 w-8" />
            </div>
          )}
          {results.map((s) => (
            <button
              key={s.student_code}
              onClick={() => onPick(s.student_code)}
              className="flex w-full items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-4 text-left ring-1 ring-slate-200 hover:bg-teal-50 hover:ring-teal-300"
            >
              <span>
                <span className="block text-lg font-semibold text-slate-900">
                  {s.last_name}, {s.first_name}
                </span>
                <span className="text-sm text-slate-600">
                  ID {s.student_code}
                  {s.class_name && ` · Class ${s.class_name}`}
                  {s.plan_label && ` · ${s.plan_label}`}
                </span>
              </span>
              <span className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Check in</span>
            </button>
          ))}
          {!searching && query.trim().length >= 2 && results.length === 0 && !error && (
            <div className="rounded-xl bg-slate-50 p-4 text-slate-600">
              No active students match “{query.trim()}”.
              {isValidStudentCode(typedCode) && (
                <Button variant="secondary" size="sm" className="ml-2" onClick={() => onPick(typedCode)}>
                  Try ID {typedCode} anyway
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="text-sm text-slate-500">
          Use this when a card is missing or will not scan. Lookups are recorded as “manual” check-ins.
        </p>
      </div>
    </Modal>
  )
}
