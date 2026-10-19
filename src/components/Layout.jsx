import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../lib/auth'
import { can, ROLE_LABELS } from '../lib/permissions'

const NAV = [
  { to: '/check-in', label: 'Check-in', permission: 'checkIn' },
  { to: '/records', label: 'Meal records', permission: 'viewRecords' },
  { to: '/students', label: 'Students', permission: 'viewStudents' },
  { to: '/plans', label: 'Feeding plans', permission: 'viewStudents' },
  { to: '/audit', label: 'Audit log', permission: 'viewAudit' },
  { to: '/staff', label: 'Staff', permission: 'manageStaff' },
]

export default function Layout() {
  const { role, profile, settings, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 antialiased">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-bold">{settings.school_name || 'Cafeteria'} · Meals</span>
          <nav className="flex flex-wrap gap-1" aria-label="Main">
            {NAV.filter((n) => can(role, n.permission)).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-300">
              {profile?.full_name || profile?.email} · {ROLE_LABELS[role]}
            </span>
            <button onClick={signOut} className="rounded-md px-3 py-1.5 font-medium hover:bg-white/10">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
