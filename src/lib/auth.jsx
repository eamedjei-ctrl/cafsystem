import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authClient, getFeedingPlans, getMealPeriods, getOwnProfile, getSettings } from './api'

const AuthContext = createContext(null)

const DEFAULT_SETTINGS = { school_name: '', timezone: 'UTC' }

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [periods, setPeriods] = useState([])
  const [plans, setPlans] = useState([])
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    authClient.getSession().then(({ data }) => setSession(data.session))
    const { data } = authClient.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id

  const loadProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null)
      return
    }
    setLoadingProfile(true)
    setError(null)
    try {
      const p = await getOwnProfile(userId)
      setProfile(p)
      if (p?.role && p.active) {
        const [s, mp, fp] = await Promise.all([getSettings(), getMealPeriods(), getFeedingPlans()])
        setSettings(s)
        setPeriods(mp)
        setPlans(fp)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingProfile(false)
    }
  }, [userId])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      // Inactive profiles have no access; treat them as role-less in the UI.
      role: profile?.active ? profile.role : null,
      settings,
      periods,
      plans,
      reloadPlans: () => getFeedingPlans().then(setPlans),
      loading: session === undefined || loadingProfile,
      error,
      reload: loadProfile,
      signIn: async (email, password) => {
        const { error: e } = await authClient.signInWithPassword({ email, password })
        if (!e) return
        if (e.message === 'Invalid login credentials') throw new Error('Incorrect email or password.')
        if (/fetch|network/i.test(e.message)) throw new Error('Cannot reach the server. Check the internet connection and try again.')
        throw new Error(e.message)
      },
      signOut: async () => {
        await authClient.signOut()
        setProfile(null)
      },
    }),
    [session, profile, settings, periods, plans, loadingProfile, error, loadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
