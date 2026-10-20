# Staff guide

## Roles at a glance

| | Check-in staff | Supervisor | Administrator |
| --- | :-: | :-: | :-: |
| Check students in, manual lookup | ✓ | ✓ | ✓ |
| View and search meal records | | ✓ | ✓ |
| Export CSV | | ✓ | ✓ |
| Correct records (edit, void, restore, add missed) | | ✓ | ✓ |
| View students, feeding plans and the audit log | | ✓ | ✓ |
| Add, edit or import students; edit feeding plans | | | ✓ |
| Manage staff accounts and roles | | | ✓ |

## Cafeteria staff: running the check-in screen

1. Sign in on the tablet. The check-in screen opens.
2. Check that the right **meal period** is highlighted at the top. The app selects it from the
   time of day and shows a blue bar offering to switch when the next period starts. Tap a period
   to change it.
3. Students scan their ID card. Watch or listen for the result:

| Screen | Sound | Meaning | What to do |
| --- | --- | --- | --- |
| **Green** with the student's name | one high beep | Meal recorded | Serve the student |
| **Amber** "Already served" | two beeps | This student already checked in for this meal today. The time of the first check-in is shown. Nothing new was recorded. | Follow school policy for second servings |
| **Red** "Not in meal plan" | low tone | The student's feeding plan does not include this meal (e.g. a once-a-day student at breakfast). Nothing was recorded. | Do not serve; refer to the supervisor if there is a mistake |
| **Amber** "Daily limit reached" | two beeps | The student has already had all the meals their plan allows today | Do not serve |
| **Red** "ID not recognised" | low tone | No student has this ID | Try again, or use Manual lookup. The card may be damaged or the student may not be in the roster. |
| **Red** "Inactive record" | low tone | The student is marked inactive | Refer the student to the office |
| **Red** "Invalid ID" | low tone | The scan was not a valid ID (misread or wrong barcode) | Scan again |
| **Red** "Check-in failed" or "No connection" | low tone | The meal was **not** recorded | Fix the connection and scan again |

   The result clears automatically after a few seconds, or when you tap it.
4. **No card or the card won't scan?** Tap **Manual lookup**, type at least two letters of the
   name or ID, and tap **Check in** next to the right student. Check the student ID shown, because
   names can repeat.
5. The **served** counter shows how many students have checked in for this period today, across
   all devices. The right-hand list shows recent scans on this tablet only.
6. If the red **Offline** bar appears, check-ins cannot be recorded. Keep a paper list of names and
   ask a supervisor to add them afterwards with **Add missed record**.

Tips: tap **Full screen** at the start of service. A card held under the scanner or a scanner that
fires twice is ignored for 3 seconds, so it won't show a false "already served".

## Feeding plans (sections)

Every student belongs to one section:

| Section | Meals | Chit |
| --- | --- | --- |
| Once a day | One meal: Lunch **or** Supper | Blue |
| Twice a day | Lunch and Supper | Lunch: pinkish red · Supper: yellow |
| Thrice a day | Breakfast, Lunch and Supper | Blue at every meal |

The green confirmation shows the student's section, for example "Twice a day", and the chit to
collect, for example "Collect pinkish red chit". Before the first scan, the screen also lists which
chit each section hands in for the selected meal.
Students with **no plan** are not restricted. Edit a student on the Students page to assign one.

Admins can change a section on the **Feeding plans** page:

- **Meal periods included:** which meals the section can be served.
- **Chit colour:** the colour of chit students in that section hand in at each meal.
- **Meals allowed per day:** a limit. If you tick more periods than the limit, students can choose.
  For example, Once a day ticks Lunch and Supper with a limit of 1, so students eat at either one.

Changes apply to the next scan and are recorded in the audit log.

## Supervisors: records, corrections and export

- **Meal records** shows today's records by default. Use the filters for dates, meal period,
  feeding plan, student name or ID, and status (served or voided). The tiles show totals per period.
  The **By feeding plan** table shows, for each section, how many students are on it and how many
  meals they were served in each period. Click a row to filter the list to that section.
- **Export CSV** downloads every record that matches the current filters, not just the visible
  page. The file opens in Excel or Google Sheets.
- **Times fed** is a table of every student's name, ID and the number of meals they were served
  in the chosen dates (today by default). Students who were not fed show 0. Voided records are not
  counted. **Export CSV** on that page downloads the whole table.
- **Edit** changes a record's meal period or date, for example when the tablet was left on
  Breakfast during Lunch.
- **Void** cancels a record that should not exist, such as a wrong card or a test scan. The record
  is kept for the audit trail but is no longer counted. The student can then be checked in again.
- **Restore** un-voids a record. It is refused if the student has checked in again since.
- **Add missed record** adds a meal for a student who was served but not checked in. This is a
  deliberate override, so it is allowed even outside the student's feeding plan.
- Every correction requires a **reason**, which is stored permanently with your name in the
  **Audit log**.

## Administrators

### Adding staff

1. In the Supabase dashboard, go to Authentication → Users → **Invite user** and enter their email.
2. They set a password from the invitation email and sign in. They see "Account not set up yet".
3. On the **Staff** page, choose their role. Give each person the lowest role they need. The
   cafeteria tablet should use a dedicated **Check-in staff** account.

When someone leaves, click **Deactivate** on the Staff page. They immediately lose access to all
data. The app always keeps at least one active administrator.

### Importing the roster

1. Export the student list from the school's information system as a CSV with these columns:

   | Column | Required | Notes |
   | --- | --- | --- |
   | `student_id` | yes | Exactly what the ID card's barcode/QR encodes. 1–32 letters, digits, `-` or `_`. Not case-sensitive. |
   | `first_name` | yes | |
   | `last_name` | yes | `surname` is also accepted |
   | `plan` | no | `once`, `twice` or `thrice` (or `1`/`2`/`3`, or the plan name). Blank = no plan. If the column is missing, each student's current plan is kept. |
   | `active` | no | `yes`/`no` (default yes) |

   Do not include any other personal data. Extra columns are ignored and never uploaded.
   A template is available from the import dialog. `docs/sample-roster.csv` is a fictional example.
2. Go to **Students → Import roster CSV** and choose the file. Every row is checked first. If any
   row has a problem (missing name, bad ID, duplicate ID), the file is listed with line numbers
   and nothing is imported.
3. Click **Import**. Students are matched by `student_id`: new IDs are added, and existing ones are
   updated (name, active). Any other columns, such as an old `class` column, are ignored.
4. If the file has a `plan` column, each student's feeding plan is set from it (blank = no plan).
5. Students who are **not** in the file are left unchanged. To remove leavers, include them with
   `active` set to `no`, or deactivate them on the Students page. Students are never deleted, so
   meal history is preserved.

Re-importing the same file is safe. Unchanged students are reported as "unchanged" and do not
create audit entries.
