/** "HH:MM" or "HH:MM:SS" → minutes since midnight. */
export function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** Minutes since midnight for `date` in the given IANA time zone. */
export function minutesInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/**
 * Suggest the meal period to pre-select on the check-in screen:
 *  1. the active period whose window contains the current time, otherwise
 *  2. the next upcoming active period today, otherwise
 *  3. the last active period of the day.
 * Staff can always change the selection; this never blocks a check-in.
 */
export function suggestMealPeriod(periods, now, timeZone) {
  const active = periods
    .filter((p) => p.active)
    .sort((a, b) => timeToMinutes(a.starts_at) - timeToMinutes(b.starts_at))
  if (active.length === 0) return null
  const minutes = minutesInZone(now, timeZone)

  const current = active.find(
    (p) => minutes >= timeToMinutes(p.starts_at) && minutes < timeToMinutes(p.ends_at),
  )
  if (current) return current

  const upcoming = active.find((p) => timeToMinutes(p.starts_at) > minutes)
  return upcoming ?? active[active.length - 1]
}
