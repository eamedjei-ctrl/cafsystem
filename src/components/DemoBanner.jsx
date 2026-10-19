import { DEMO_MODE, resetDemo } from '../lib/api'

/** Always-visible reminder that demo mode uses fake, browser-only data. */
export default function DemoBanner() {
  if (!DEMO_MODE) return null
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-fuchsia-700 px-4 py-1.5 text-center text-sm font-medium text-white">
      <span>DEMO MODE: fictional sample data, saved only in this browser. Not for real students.</span>
      <button
        type="button"
        className="rounded bg-white/20 px-2 py-0.5 text-xs font-semibold hover:bg-white/30"
        onClick={() => {
          if (window.confirm('Reset all demo data back to the original sample data?')) {
            resetDemo()
            window.location.reload()
          }
        }}
      >
        Reset demo data
      </button>
    </div>
  )
}
