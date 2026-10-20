# Security model

## Principles

1. **The database is the security boundary.** The React app hides features a role can't use, but
   every rule is enforced again in PostgreSQL through Row Level Security (RLS), privileges and
   function checks. A user calling the Supabase API directly with their token gets the same
   restrictions.
2. **Least privilege.** The cafeteria tablet's role can check students in and look up names, and
   nothing else. It cannot list the roster, read meal history or export.
3. **Data minimisation.** A student record holds only the ID code, first and last name, feeding plan
   and an active flag.
4. **No silent changes.** Meal records cannot be edited or deleted directly by any app user.
   Corrections go through functions that require a reason and write to an append-only audit log.

## Who can do what (enforced in the database)

| Object | anon | signed in, no role / deactivated | checkin | supervisor | admin |
| --- | --- | --- | --- | --- | --- |
| `students` | ✗ | ✗ | ✗ (only via `check_in` / `search_students`) | read | read, insert, update |
| `meal_records` | ✗ | ✗ | ✗ (write only via `check_in`) | read; write via `correct_meal_record` / `add_meal_record` | same as supervisor |
| `meal_record_details` (view) | ✗ | ✗ | ✗ | read | read |
| `audit_log` | ✗ | ✗ | ✗ | read | read |
| `staff_profiles` | ✗ | own row | own row | read all | read all, update |
| `meal_periods`, `app_settings` | ✗ | ✗ | read | read | read, update |
| `feeding_plans`, `feeding_plan_periods` | ✗ | ✗ | read | read | read; write via `set_feeding_plan` |
| delete anything | ✗ | ✗ | ✗ | ✗ | ✗ (deactivate instead) |

How this is implemented, in `supabase/migrations/20261019000000_initial_schema.sql`:

- RLS is enabled on every table, and policies check `private.current_staff_role()`, which returns
  null for users with no role or an inactive profile.
- Helper functions live in a `private` schema that the Data API does not expose.
- All anon privileges are revoked. Direct `insert`/`update`/`delete` on `meal_records` and
  `audit_log` is revoked from `authenticated`, and `delete`/`truncate` is revoked on all other
  tables.
- `EXECUTE` on every function is revoked from `PUBLIC` and `anon` and granted to `authenticated`
  only for the RPCs that need it. Each RPC is `SECURITY DEFINER` with `search_path = ''` and starts
  with an explicit role check.
- The `meal_record_details` view uses `security_invoker = true`, so it applies the caller's RLS.
- `search_students` returns at most 25 active students, needs 2 or more characters, escapes LIKE
  wildcards, and only returns ID, name and feeding plan.
  - Trade-off: someone with the tablet account could still discover names by trying many searches.
    That is the minimum needed for manual lookup. Limit who knows the tablet password and
    deactivate it if it is lost.

All of these rules are covered by `tests/db/access.db.test.js`.

## Check-in integrity

- A **partial unique index** (`student_id, meal_period, service_date where not voided`) makes
  duplicates impossible, even when two tablets scan the same card at the same moment.
- Feeding-plan rules (allowed meal periods and the daily limit) are checked inside `check_in`.
  The function locks the student row, so two tablets cannot both serve a student past the limit.
- The service date is computed **in the database** in the school's time zone, so a tablet with a
  wrong clock cannot record meals on the wrong day.
- Student IDs are normalised (trimmed, upper-cased) and validated against a strict pattern, both in
  the app and by a check constraint.

## Audit trail

- Triggers write to `audit_log` on corrections, voids and restores, administratively added
  records, every roster change, staff role and active changes, meal-period changes and settings
  changes. Each entry stores the old and new row (JSON), who made the change, when, and the reason.
- Normal scans are not duplicated into the audit log. The meal record itself stores who recorded
  it and when.
- The audit log is append-only. `UPDATE`, `DELETE` and `TRUNCATE` are rejected by triggers for
  every role, including the database owner.
- `changed_by` is deliberately not a foreign key, so entries survive the deletion of the staff
  account that made them.

## Operational safeguards

- Self-sign-up should be disabled (see SETUP.md). New accounts start with no role.
- At least one active admin always remains (enforced by a trigger), so nobody can lock the school
  out.
- Students with meal history cannot be deleted (`on delete restrict`), only deactivated.
- The roster import is all-or-nothing per batch, is validated client-side and server-side, and is
  limited to 5,000 rows per call.
- CSV exports neutralise spreadsheet formula injection (cells starting with `=`, `+`, `-` or `@`).
- The tablet suppresses repeat scans of the same card within 3 seconds, processes scans strictly in
  order, warns when offline, and never claims success unless the database confirmed it.
- Security headers in `vercel.json`: a CSP restricting scripts to the app's origin and connections
  to Supabase, `X-Frame-Options: DENY`, HSTS, `no-referrer`, and `noindex`.

## Recommendations for the school

- Use a separate account for each tablet so lost devices can be deactivated individually.
- Use strong passwords, and enable MFA for admins in Supabase if your plan supports it.
- Supervisors and admins on shared computers should sign out after use.
- Review the Staff page each term, and deactivate accounts for people who have left.
- Agree a retention period for meal records with the school's data-protection lead.
  - Records are kept indefinitely by default.
  - Deleting old records would require a new, reviewed migration. The audit log is append-only.
