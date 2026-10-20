import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './lib/auth'
import { can, homePath } from './lib/permissions'
import { configError } from './lib/supabase'
import { Alert, FullPageSpinner } from './components/ui'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import CheckInPage from './pages/CheckInPage'
import RecordsPage from './pages/RecordsPage'
import StudentsPage from './pages/StudentsPage'
import StaffPage from './pages/StaffPage'
import AuditPage from './pages/AuditPage'
import PlansPage from './pages/PlansPage'
import TimesFedPage from './pages/TimesFedPage'
import NoAccessPage from './pages/NoAccessPage'

/** Gate a route on a permission. The database enforces the same rules. */
function RequirePermission({ permission, children }) {
  const { role } = useAuth()
  if (!can(role, permission)) return <Navigate to={homePath(role)} replace />
  return children
}

export default function App() {
  const { session, loading, role, error } = useAuth()
  const location = useLocation()

  if (configError) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Alert>{configError}</Alert>
      </div>
    )
  }
  if (loading) return <FullPageSpinner />

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Alert>Could not load your account: {error}. Check the connection and reload the page.</Alert>
      </div>
    )
  }

  if (!role) return <NoAccessPage />

  return (
    <Routes>
      <Route
        path="/check-in"
        element={
          <RequirePermission permission="checkIn">
            <CheckInPage />
          </RequirePermission>
        }
      />
      <Route element={<Layout />}>
        <Route
          path="/records"
          element={
            <RequirePermission permission="viewRecords">
              <RecordsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/times-fed"
          element={
            <RequirePermission permission="viewRecords">
              <TimesFedPage />
            </RequirePermission>
          }
        />
        <Route
          path="/students"
          element={
            <RequirePermission permission="viewStudents">
              <StudentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/plans"
          element={
            <RequirePermission permission="viewStudents">
              <PlansPage />
            </RequirePermission>
          }
        />
        <Route
          path="/audit"
          element={
            <RequirePermission permission="viewAudit">
              <AuditPage />
            </RequirePermission>
          }
        />
        <Route
          path="/staff"
          element={
            <RequirePermission permission="manageStaff">
              <StaffPage />
            </RequirePermission>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to={homePath(role)} replace />} />
    </Routes>
  )
}
