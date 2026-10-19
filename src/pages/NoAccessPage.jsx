import { useAuth } from '../lib/auth'
import { Button } from '../components/ui'

export default function NoAccessPage() {
  const { profile, user, signOut, reload } = useAuth()
  const inactive = profile && !profile.active

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold">{inactive ? 'Account deactivated' : 'Account not set up yet'}</h1>
        <p className="text-slate-600">
          {inactive
            ? 'This staff account has been deactivated. Contact a school administrator if you need access.'
            : 'You are signed in, but an administrator has not given your account a role yet. Ask them to assign one on the Staff page, then press "Check again".'}
        </p>
        <p className="text-sm text-slate-500">Signed in as {user?.email}</p>
        <div className="flex gap-2">
          <Button onClick={reload}>Check again</Button>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  )
}
