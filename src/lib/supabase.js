import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configError =
  import.meta.env.VITE_DEMO_MODE !== 'true' && (!url || !anonKey)
    ? 'Supabase is not configured. Copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see docs/SETUP.md).'
    : null

// Only the anon (public) key belongs in the browser. Access to data is
// controlled by Row Level Security in the database, never by this key.
export const supabase = createClient(url || 'http://localhost', anonKey || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
