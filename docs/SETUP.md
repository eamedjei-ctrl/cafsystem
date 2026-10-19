# Setup and deployment

Steps marked **SCHOOL-SPECIFIC** need information only the school can provide.

## 1. Supabase credentials

The frontend needs two values. Both are designed to be public, because every request is
checked by Row Level Security in the database:

| Variable | Where to find it |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Same page → `anon` / publishable key |

Put them in `.env.local` for local development (copy `.env.example`), and in Vercel's
Environment Variables for production. `.env.local` is git-ignored.

> **Never** put the `service_role` / secret key in a `VITE_` variable, in the frontend, or in git.
> It bypasses Row Level Security. Only `scripts/create-dev-users.mjs` uses it, and only against
> localhost.

## 2. Local development

**Without a database:** set `VITE_DEMO_MODE=true` in `.env.local` and run `npm run dev`. The app
then uses fictional in-browser data (`src/lib/demoApi.js`) and shows a demo banner. Never enable
demo mode in a production deployment: demo data is not protected by the database's security
rules.

**With a local Supabase:**

```bash
npm install
supabase start          # applies supabase/migrations/* and supabase/seed.sql
supabase status         # prints API URL, anon key and service_role key
cp .env.example .env.local   # paste the anon key
SUPABASE_SERVICE_ROLE_KEY=... npm run dev:users
npm run dev
```

Reset the local database at any time with `supabase db reset`, which re-runs the migrations and
seed data.

## 3. Hosted Supabase project

1. Create a project at supabase.com. Pick the region closest to the school.
2. Link and push the migrations (this does **not** load the seed data):
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   Alternatively, paste `supabase/migrations/20261019000000_initial_schema.sql` into the SQL
   Editor and run it once.
3. **Authentication settings** (Dashboard → Authentication):
   - Sign In / Providers → Email: enabled. **Disable "Allow new users to sign up".** Staff accounts
     are created by invitation only. Even if someone did sign up, they would get a profile with no
     role and could see nothing.
   - URL Configuration → Site URL: your Vercel URL (for example `https://meals.example.org`). Add it
     to Redirect URLs too, so invitation and password-reset links work.
   - Optional but recommended: set a minimum password length of 12 or more, and enable leaked
     password protection if your plan includes it.
4. **SCHOOL-SPECIFIC: time zone and name.** In the SQL Editor:
   ```sql
   update public.app_settings set school_name = 'Your School', timezone = 'Africa/Accra';
   ```
   Use the school's [IANA time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).
   It decides which calendar day a check-in belongs to.
5. **SCHOOL-SPECIFIC: meal periods.** The migration creates Breakfast (06:30–09:30), Lunch
   (11:00–14:00) and After-school snack (14:30–17:00). Adjust them to the school's schedule:
   ```sql
   update public.meal_periods set starts_at = '07:00', ends_at = '08:30' where code = 'breakfast';
   update public.meal_periods set active = false where code = 'snack';
   insert into public.meal_periods (code, label, starts_at, ends_at, sort_order)
     values ('dinner', 'Dinner', '17:30', '19:30', 40);
   ```
   The times only pre-select the likely period on the tablet. Check-ins outside the window are
   still accepted. Don't delete a period that has records; set `active = false` instead.

## 4. Create the first admin

1. Dashboard → Authentication → Users → **Invite user** (or Add user) with the administrator's
   email.
2. In the SQL Editor, give that account the admin role:
   ```sql
   update public.staff_profiles set role = 'admin', full_name = 'Admin Name'
   where email = 'admin@yourschool.org';
   ```
3. From then on, the admin can assign roles to other invited staff on the **Staff** page.

For a shared cafeteria tablet, create a dedicated account (for example
`cafeteria-tablet-1@yourschool.org`) with the **Check-in staff** role. It can only check students
in.

## 5. Load the roster

See "Importing the roster" in [STAFF_GUIDE.md](STAFF_GUIDE.md). In short, an admin uploads a CSV
on the Students page. **SCHOOL-SPECIFIC:** the `student_id` column must contain exactly the value
encoded in each card's barcode or QR code.

## 6. Deploy the frontend to Vercel

1. Import the GitHub repository in Vercel. The framework preset is detected as Vite from
   `vercel.json`.
2. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production
   (and Preview if you use it).
3. Deploy. `vercel.json` adds the SPA rewrite and security headers: a CSP that only allows
   connections to `*.supabase.co`, no framing, no referrer and HSTS.
   - If you use a custom Supabase domain, add it to `connect-src` in `vercel.json`.
4. Set the Vercel URL as the Site URL in Supabase (step 3.3).

## 7. Set up the check-in tablet

- Plug in a USB (or Bluetooth HID) scanner. Configure it to send **Enter** after each scan. This
  is the default on most scanners. Tab also works.
- If the cards' QR codes contain a URL (such as `https://school.example/id/S1234`) or a prefix
  (`STUDENT:S1234`), the app extracts the ID automatically. Other formats need a change to
  `src/lib/studentCode.js` and to the `student_code` check constraint.
- Open the site, sign in with the tablet account, and tap **Full screen**. On iPad or Android you
  can also "Add to Home Screen" for a kiosk-like window. Consider the OS's guided-access or kiosk
  mode.
- Turn the volume up. Each outcome has its own beep.
- Test with a few cards before service: a valid card, the same card twice (duplicate), and an
  unknown code.

## Applying future schema changes safely

- Never edit a migration that has already been applied. Add a new timestamped file in
  `supabase/migrations/` instead.
- Run `npm test` first. The database tests apply every migration in order and re-check all access
  rules.
- Try it locally with `supabase db reset`, then `supabase db push`. Take a backup first (Supabase
  takes daily backups on paid plans; you can also run `supabase db dump`).
- Prefer additive changes (new columns with defaults, new tables). Avoid dropping columns that hold
  data.
- Any new table needs `enable row level security` and explicit policies. Any new function needs
  `security definer set search_path = ''` (if it bypasses RLS), a role check, and
  `revoke execute ... from public, anon`.
