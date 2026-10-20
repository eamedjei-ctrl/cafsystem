/**
 * Meal chit colours. Students hand in a coloured chit for each meal; the colour
 * depends on their feeding plan and the meal period (feeding_plan_periods.chit_color).
 */
export const CHIT_COLORS = {
  blue: { label: 'Blue', swatch: 'bg-blue-600 text-white' },
  pink: { label: 'Pinkish red', swatch: 'bg-rose-500 text-white' },
  yellow: { label: 'Yellow', swatch: 'bg-yellow-300 text-yellow-950' },
  green: { label: 'Green', swatch: 'bg-green-600 text-white' },
  orange: { label: 'Orange', swatch: 'bg-orange-500 text-white' },
  purple: { label: 'Purple', swatch: 'bg-purple-600 text-white' },
  white: { label: 'White', swatch: 'bg-white text-slate-900 ring-1 ring-slate-300' },
}

/** The chit colour key for a plan and meal period, or null. */
export function chitFor(plans, planCode, mealPeriod) {
  const color = plans?.find((p) => p.code === planCode)?.chits?.[mealPeriod]
  return color && CHIT_COLORS[color] ? color : null
}
