# Cafeteria Meal Tracker

A tablet-friendly web app for recording which students receive meals in a school cafeteria.
Students scan the barcode or QR code on their ID card, and the app records the meal and shows a
clear confirmation. Staff can search, correct and export the records.

- **Frontend:** React (JavaScript) + Vite + Tailwind CSS, hosted on Vercel
- **Backend:** Supabase (PostgreSQL, Auth, Row Level Security)
- **Scanner:** any USB barcode/QR scanner in keyboard mode (no drivers)

## Features

| Area | What it does |
| --- | --- |
| Check-in screen | Large-print status for a busy line. Shows a green confirmation with the student's name, an amber "already served" notice for duplicates (with the original time), and a red error for unknown, invalid or inactive IDs. Plays a different beep for each outcome. Includes manual name/ID lookup, a served counter, an offline warning and full-screen mode, and keeps the screen awake. |
| Meal records | Filter by date range, meal period, class, student and status. Per-period totals, pagination and CSV export. |
| Corrections | Supervisors can change a record's meal period or date, void or restore it, or add a missed record. A reason is always required and goes into the audit log. |
| Students | View the roster. Admins can add, edit or deactivate students and import a roster CSV. |
| Staff | Admins assign roles (`checkin`, `supervisor`, `admin`) and deactivate accounts. |
| Audit log | Append-only history of corrections, roster changes and access changes. |

## Quick start (local)

Requires Node 20+, Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase start                       # starts local Postgres/Auth and applies migrations + seed data
cp .env.example .env.local           # then paste the anon key printed by `supabase start`
SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase status`> npm run dev:users
npm run dev                          # http://localhost:5173
```

Sign in as `tablet@demo.school`, `supervisor@demo.school` or `admin@demo.school` (password
`demo-password-1`). On the check-in screen, type a demo ID such as `DEMO0001` and press Enter to
simulate a scan. `DEMO0059` shows the inactive-student message, and `NOPE` shows the unknown-ID
error.

All seed data is fictional. **Never load `supabase/seed.sql` into a production project.**

## Tests

```bash
npm test
```

- `src/lib/lib.test.js`: scanner input handling, ID normalisation, meal-period suggestion, CSV
  export escaping (including formula injection), roster validation, UI permissions, and check-in
  messages.
- `tests/db/*.db.test.js`: runs the **real migrations** in an embedded Postgres (PGlite), with
  Supabase's roles and default grants recreated. It checks the check-in rules (duplicates, unknown,
  inactive and invalid IDs, time zone handling, voiding) and the access controls for every role:
  anonymous, no role, deactivated, check-in, supervisor and admin. It also covers the audit trail
  and safeguards such as the append-only audit log and the last-admin rule. No Docker needed.

## Documentation

- [docs/SETUP.md](docs/SETUP.md): Supabase credentials, hosted setup, first admin, deployment to
  Vercel, school-specific configuration
- [docs/STAFF_GUIDE.md](docs/STAFF_GUIDE.md): day-to-day use for cafeteria staff, supervisors and
  admins, including roster import
- [docs/SECURITY.md](docs/SECURITY.md): roles, Row Level Security, audit trail and operational
  safeguards
- [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md): design assumptions, what needs school-specific input,
  and known limitations

## Project layout

```
src/
  pages/            CheckInPage, RecordsPage, StudentsPage, StaffPage, AuditPage, LoginPage
  components/       Layout and shared UI
  lib/              api.js (all database calls), auth.jsx, scanner.js, csv.js, roster.js, …
supabase/
  migrations/       schema, RLS policies, RPC functions, triggers
  seed.sql          fictional local sample data
  config.toml       local Supabase CLI config
tests/db/           database rule and access-control tests (PGlite)
scripts/            create-dev-users.mjs (local only)
```

Out of scope for this MVP: payments, meal-plan eligibility, and offline queuing of check-ins.
