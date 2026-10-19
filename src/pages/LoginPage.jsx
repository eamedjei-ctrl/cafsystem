import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { DEMO_ACCOUNTS, DEMO_MODE, DEMO_PASSWORD } from '../lib/api'
import { ROLE_LABELS } from '../lib/permissions'
import { Alert, Button, Field, inputClass } from '../components/ui'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-2rem)] items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div>
          <h1 className="text-2xl font-bold">Cafeteria meals</h1>
          <p className="mt-1 text-sm text-slate-600">Staff sign-in</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <Field label="Email">
          {(id) => (
            <input
              id={id}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-xs text-slate-500">Accounts are created by a school administrator.</p>
        {DEMO_MODE && (
          <div className="space-y-2 rounded-xl bg-fuchsia-50 p-4 ring-1 ring-fuchsia-200">
            <p className="text-sm font-semibold text-fuchsia-900">Demo accounts (password: {DEMO_PASSWORD})</p>
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => {
                  setEmail(a.email)
                  setPassword(DEMO_PASSWORD)
                }}
                className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-sm ring-1 ring-fuchsia-200 hover:bg-fuchsia-100"
              >
                <span className="font-medium text-slate-900">{a.email}</span>
                <span className="text-xs text-slate-600">{ROLE_LABELS[a.role]}</span>
              </button>
            ))}
            <p className="text-xs text-fuchsia-900">Tap an account to fill it in, then press Sign in.</p>
          </div>
        )}
      </form>
    </div>
  )
}
