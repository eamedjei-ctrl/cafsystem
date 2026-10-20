/**
 * Turns a check_in() result into what the cafeteria screen shows.
 * tone: success (green) | warning (amber) | error (red)
 */

export function fullName(student) {
  return `${student.first_name} ${student.last_name}`.trim()
}

export function formatTime(iso, timeZone) {
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

/** "Twice a day" */
export function studentSubtitle(student) {
  return student.plan_label || undefined
}

/** ["Breakfast", "Lunch"] -> "Breakfast and Lunch" */
export function listLabels(labels) {
  if (!labels?.length) return 'no meal periods'
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

export function describeCheckIn(result, timeZone) {
  switch (result.status) {
    case 'ok':
      return {
        tone: 'success',
        title: fullName(result.student),
        detail: `Checked in for ${result.meal_period_label}`,
        subtitle: studentSubtitle(result.student),
      }
    case 'not_on_plan':
      return {
        tone: 'error',
        title: `Not in meal plan: ${fullName(result.student)}`,
        detail: `${result.student.plan_label} covers ${listLabels(result.allowed_periods)} only. ${result.meal_period_label} is not included, so no meal was recorded.`,
        subtitle: studentSubtitle(result.student),
      }
    case 'plan_limit_reached':
      return {
        tone: 'warning',
        title: `Daily limit reached: ${fullName(result.student)}`,
        detail: `${result.student.plan_label}: already had ${result.meals_today} of ${result.meals_per_day} meal${result.meals_per_day === 1 ? '' : 's'} today (${listLabels(result.meals_today_periods)}). No meal was recorded.`,
        subtitle: studentSubtitle(result.student),
      }
    case 'duplicate':
      return {
        tone: 'warning',
        title: `Already served: ${fullName(result.student)}`,
        detail: `Checked in for ${result.meal_period_label} today at ${formatTime(result.first_checked_in_at, timeZone)}. No new record was added.`,
        subtitle: studentSubtitle(result.student),
      }
    case 'unknown_student':
      return {
        tone: 'error',
        title: 'ID not recognised',
        detail: `No student has ID “${result.student_code}”. Check the card, or use Manual lookup.`,
      }
    case 'inactive_student':
      return {
        tone: 'error',
        title: `Inactive record: ${fullName(result.student)}`,
        detail: 'This student is marked inactive. No meal was recorded. Please refer them to the office.',
      }
    case 'invalid_id':
      return {
        tone: 'error',
        title: 'Invalid ID',
        detail: 'That scan does not look like a student ID. Try scanning again, or use Manual lookup.',
      }
    case 'invalid_period':
      return {
        tone: 'error',
        title: 'Meal period unavailable',
        detail: 'The selected meal period is not active. Choose another period at the top of the screen.',
      }
    default:
      return { tone: 'error', title: 'Unexpected response', detail: 'Please try again.' }
  }
}
