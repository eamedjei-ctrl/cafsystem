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

export function describeCheckIn(result, timeZone) {
  switch (result.status) {
    case 'ok':
      return {
        tone: 'success',
        title: fullName(result.student),
        detail: `Checked in for ${result.meal_period_label}`,
        subtitle: result.student.class_name ? `Class ${result.student.class_name}` : undefined,
      }
    case 'duplicate':
      return {
        tone: 'warning',
        title: `Already served: ${fullName(result.student)}`,
        detail: `Checked in for ${result.meal_period_label} today at ${formatTime(result.first_checked_in_at, timeZone)}. No new record was added.`,
        subtitle: result.student.class_name ? `Class ${result.student.class_name}` : undefined,
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
