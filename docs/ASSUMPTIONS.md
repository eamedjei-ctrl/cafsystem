# Assumptions, school-specific decisions and limitations

## Assumptions made in this MVP

| Topic | Assumption | Where to change it |
| --- | --- | --- |
| ID card contents | The barcode/QR encodes the student ID as plain text (1–32 letters, digits, `-`, `_`), optionally inside a URL or with a `STUDENT:` prefix | `src/lib/studentCode.js` and the `student_code` check constraint |
| Scanner | USB/Bluetooth scanner in keyboard (HID) mode that ends each scan with Enter or Tab | `src/lib/scanner.js` |
| Duplicate rule | One meal per student per meal period per school day. Different periods on the same day are allowed. | `meal_records_one_per_period` index |
| Meal period windows | Used only to pre-select the period on the tablet. Late check-ins are allowed. | `suggestMealPeriod`, `check_in()` |
| Day boundary | Midnight in the school's time zone (`app_settings.timezone`) | SQL `update public.app_settings …` |
| Duplicate handling | A duplicate is shown as a warning and no record is added. Second servings are not tracked. | `check_in()` |
| Inactive students | Cannot be checked in (red message, no record) | `check_in()` |
| Corrections | Supervisors and admins can correct; a reason is mandatory; records are voided, never deleted | `correct_meal_record()` |
| Missed-record dates | Any past or current date; future dates are rejected | `add_meal_record()` |
| Staff onboarding | Staff are invited via the Supabase dashboard; admins then assign roles in the app | `docs/SETUP.md` |
| Data retained | Student ID, first and last name, class, active flag; nothing else | `students` table |

## Needs school-specific information before go-live

1. **Time zone** and school name (`app_settings`).
2. **Meal periods**: names and times, and whether there are more or fewer than three.
3. **Card format**: scan a real card into a text editor to see exactly what it sends.
4. **Roster export** from the school's information system, mapped to the CSV columns.
5. **Who gets which role**, and how many tablets are needed (one check-in account each).
6. **Data protection**: retention period for meal records, who may export, and whether parents or
   students must be informed under local regulations.
7. **Policy for duplicates and inactive students**: who handles them in the line.
8. **Hosting region** for the Supabase project, if local data-residency rules apply.

## Known limitations (deliberately out of scope)

- **No offline queue.** If the network is down, check-ins are refused with a clear message rather
  than stored locally. Offline mode with later sync would need conflict handling.
- **No payments or meal-plan eligibility.** Every active student can be checked in.
- **No in-app staff invitations.** Creating auth users needs the service-role key, which must never
  reach the browser. A Supabase Edge Function could add this later.
- **No in-app editing of meal periods or time zone.** Change these with SQL (see SETUP.md). Admins
  have the database permissions, so a settings page would be easy to add.
- **Exports are capped at 50,000 rows** per download. Narrow the date range for larger exports.
- **Manual-lookup searches** expose names to the check-in role (see SECURITY.md).
- The tablet's "recent" list is per-device and is cleared on reload. The authoritative data is in
  Meal records.
