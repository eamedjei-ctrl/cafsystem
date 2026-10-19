-- =============================================================================
-- Cafeteria Meal Tracker — initial schema
--
-- Security model (summary — see docs/SECURITY.md):
--   * Every table has Row Level Security enabled. The anon role gets nothing.
--   * Staff roles live in public.staff_profiles. A signed-in user with no
--     profile role (or an inactive profile) has no access to any data.
--   * meal_records can only be written through SECURITY DEFINER functions
--     (check_in, add_meal_record, correct_meal_record) that enforce the
--     check-in rules and the caller's role. There are no direct write policies.
--   * Changes are written to public.audit_log by triggers. The audit log is
--     append-only: updates and deletes are rejected for every role.
--
-- This migration is written to be safe to run on an empty project. It does not
-- drop or rewrite existing data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schemas
-- -----------------------------------------------------------------------------
-- Helper functions used by RLS policies live in "private", which is NOT exposed
-- through the Supabase Data API, so they cannot be called directly as RPCs.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
-- checkin    : cafeteria staff / shared tablet. Can check students in and look
--              up students by name. Cannot browse records or the roster.
-- supervisor : can view, search, export and correct meal records; view roster
--              and audit log.
-- admin      : everything a supervisor can do, plus manage the roster and staff.
create type public.staff_role as enum ('checkin', 'supervisor', 'admin');

-- scan   : ID read by the scanner (or typed + Enter on the check-in screen)
-- manual : student picked from manual lookup on the check-in screen
-- admin  : record added afterwards by a supervisor/admin as a correction
create type public.check_in_method as enum ('scan', 'manual', 'admin');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- Single-row settings table. "id" is always true, so there can only be one row.
create table public.app_settings (
  id boolean primary key default true check (id),
  school_name text not null default 'Sample School',
  -- IANA time zone used to decide which calendar day a check-in belongs to.
  -- SCHOOL-SPECIFIC: set this to the school's local time zone.
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

create table public.staff_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  -- null role = signed in but not authorised for anything yet
  role public.staff_role,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  -- The value encoded on the student's ID card (barcode / QR). Stored
  -- upper-case so look-ups are case-insensitive.
  student_code text not null unique
    check (student_code ~ '^[A-Z0-9_-]{1,32}$'),
  first_name text not null check (length(btrim(first_name)) between 1 and 100),
  last_name text not null check (length(btrim(last_name)) between 1 and 100),
  class_name text not null default '' check (length(class_name) <= 50),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index students_class_idx on public.students (class_name);
create index students_name_idx on public.students (lower(last_name), lower(first_name));

create table public.meal_periods (
  code text primary key check (code ~ '^[a-z0-9_]{1,30}$'),
  label text not null check (length(btrim(label)) between 1 and 50),
  -- Used only to pre-select the likely period on the check-in screen. Check-ins
  -- are NOT rejected outside these times (late students still get served).
  starts_at time not null,
  ends_at time not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  check (ends_at > starts_at)
);

create table public.meal_records (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: a student with meal history cannot be deleted, only deactivated.
  student_id uuid not null references public.students (id) on delete restrict,
  meal_period text not null references public.meal_periods (code) on update cascade,
  -- The school-local calendar date of service (see private.school_today()).
  service_date date not null,
  checked_in_at timestamptz not null default now(),
  method public.check_in_method not null,
  recorded_by uuid references public.staff_profiles (id) on delete set null,
  voided boolean not null default false,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references public.staff_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (voided = (voided_at is not null))
);

-- Core check-in rule: at most ONE non-voided record per student, meal period
-- and day. Enforced by the database, so it holds even if two tablets scan the
-- same card at the same moment.
create unique index meal_records_one_per_period
  on public.meal_records (student_id, meal_period, service_date)
  where not voided;

create index meal_records_date_period_idx on public.meal_records (service_date, meal_period);
create index meal_records_student_idx on public.meal_records (student_id, service_date);

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  reason text,
  -- Not a foreign key on purpose: the log is immutable and must survive the
  -- deletion of the staff account that made the change.
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_changed_at_idx on public.audit_log (changed_at desc);

-- -----------------------------------------------------------------------------
-- Helper functions (private, used by policies and RPCs)
-- -----------------------------------------------------------------------------

-- Role of the calling user, or null if they are not active staff.
create function private.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select sp.role
  from public.staff_profiles sp
  where sp.id = auth.uid() and sp.active
$$;

create function private.has_role(p_roles public.staff_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() = any (p_roles), false)
$$;

create function private.school_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select s.timezone from public.app_settings s where s.id),
    'UTC'
  ))::date
$$;

create function private.require_role(p_roles public.staff_role[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_roles) then
    raise exception 'You do not have permission to do this.'
      using errcode = '42501';
  end if;
end;
$$;

create function private.require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 then
    raise exception 'A reason of at least 3 characters is required.'
      using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer.'
      using errcode = '22023';
  end if;
  return v_reason;
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers: updated_at, validation, audit
-- -----------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.app_settings
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.staff_profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.students
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.meal_records
  for each row execute function private.set_updated_at();

-- Normalise student data so look-ups and searches are predictable.
create function private.normalize_student()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.student_code := upper(btrim(new.student_code, E' \t\r\n'));
  new.first_name := btrim(new.first_name);
  new.last_name := btrim(new.last_name);
  new.class_name := btrim(coalesce(new.class_name, ''));
  return new;
end;
$$;

create trigger normalize_student before insert or update on public.students
  for each row execute function private.normalize_student();

-- Reject time zones Postgres does not recognise.
create function private.validate_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception when others then
  raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
end;
$$;

create trigger validate_settings before insert or update on public.app_settings
  for each row execute function private.validate_settings();

-- Never allow the last active admin to be demoted, deactivated or deleted,
-- otherwise nobody could manage staff from the app.
create function private.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_losing_admin boolean;
begin
  if tg_op = 'DELETE' then
    v_losing_admin := old.role = 'admin' and old.active;
  else
    v_losing_admin := old.role = 'admin' and old.active
      and (new.role is distinct from 'admin' or not new.active);
  end if;

  if v_losing_admin and not exists (
    select 1 from public.staff_profiles
    where role = 'admin' and active and id <> old.id
  ) then
    raise exception 'At least one active admin is required.' using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger protect_last_admin before update or delete on public.staff_profiles
  for each row execute function private.protect_last_admin();

-- Only an admin may change role/active, and staff may not edit other people's
-- profiles. (RLS already limits UPDATE to admins; this is defence in depth for
-- any future policy changes.) service_role / direct SQL bypass this check.
create function private.guard_staff_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.has_role(array['admin']::public.staff_role[]) then
    if new.role is distinct from old.role or new.active is distinct from old.active
       or new.id <> auth.uid() then
      raise exception 'Only an admin can change staff access.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_staff_profile_update before update on public.staff_profiles
  for each row execute function private.guard_staff_profile_update();

-- Generic audit trigger. The reason for a change is passed by the RPCs through
-- the transaction-local setting "app.audit_reason".
create function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_changed_by uuid;
begin
  -- Skip no-op updates (only updated_at changed).
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;

  -- Only reference staff that exist (service_role / SQL changes have no uid).
  select sp.id into v_changed_by from public.staff_profiles sp where sp.id = auth.uid();

  insert into public.audit_log (table_name, record_id, action, old_data, new_data, reason, changed_by)
  values (
    tg_table_name,
    -- meal_periods is keyed by "code"; every other audited table by "id".
    coalesce(v_new ->> 'id', v_new ->> 'code', v_old ->> 'id', v_old ->> 'code'),
    tg_op,
    v_old,
    v_new,
    nullif(current_setting('app.audit_reason', true), ''),
    v_changed_by
  );
  return null;
end;
$$;

-- Normal scans are not audited (the meal record itself records who/when);
-- corrections and administrative additions are.
create trigger audit_meal_records_change after update or delete on public.meal_records
  for each row execute function private.write_audit_log();
create trigger audit_meal_records_admin_insert after insert on public.meal_records
  for each row when (new.method = 'admin') execute function private.write_audit_log();
create trigger audit_students after insert or update or delete on public.students
  for each row execute function private.write_audit_log();
create trigger audit_staff_profiles after update or delete on public.staff_profiles
  for each row execute function private.write_audit_log();
create trigger audit_meal_periods after insert or update or delete on public.meal_periods
  for each row execute function private.write_audit_log();
create trigger audit_app_settings after update on public.app_settings
  for each row execute function private.write_audit_log();

-- The audit log is append-only, for every role including service_role.
create function private.reject_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The audit log cannot be modified.' using errcode = '42501';
end;
$$;

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function private.reject_audit_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.reject_audit_change();

-- Create a (role-less) staff profile for every new auth user. An admin must
-- assign a role before the user can see anything.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.staff_profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.students enable row level security;
alter table public.meal_periods enable row level security;
alter table public.meal_records enable row level security;
alter table public.audit_log enable row level security;

-- app_settings: any active staff may read; admins may update.
create policy "staff read settings" on public.app_settings
  for select to authenticated
  using ((select private.current_staff_role()) is not null);
create policy "admin update settings" on public.app_settings
  for update to authenticated
  using ((select private.has_role(array['admin']::public.staff_role[])))
  with check ((select private.has_role(array['admin']::public.staff_role[])));

-- staff_profiles: everyone can read their own profile (so the app knows their
-- role); supervisors/admins can read all (to show "recorded by"); admins update.
create policy "read own profile" on public.staff_profiles
  for select to authenticated
  using (id = (select auth.uid()));
create policy "supervisors read profiles" on public.staff_profiles
  for select to authenticated
  using ((select private.has_role(array['supervisor', 'admin']::public.staff_role[])));
create policy "admin update profiles" on public.staff_profiles
  for update to authenticated
  using ((select private.has_role(array['admin']::public.staff_role[])))
  with check ((select private.has_role(array['admin']::public.staff_role[])));

-- students: supervisors/admins read; admins write. Check-in staff use the
-- check_in / search_students functions instead, which expose only what the
-- check-in screen needs. No delete policy: deactivate students instead.
create policy "supervisors read students" on public.students
  for select to authenticated
  using ((select private.has_role(array['supervisor', 'admin']::public.staff_role[])));
create policy "admin insert students" on public.students
  for insert to authenticated
  with check ((select private.has_role(array['admin']::public.staff_role[])));
create policy "admin update students" on public.students
  for update to authenticated
  using ((select private.has_role(array['admin']::public.staff_role[])))
  with check ((select private.has_role(array['admin']::public.staff_role[])));

-- meal_periods: any active staff read (the tablet needs the list); admins write.
create policy "staff read meal periods" on public.meal_periods
  for select to authenticated
  using ((select private.current_staff_role()) is not null);
create policy "admin insert meal periods" on public.meal_periods
  for insert to authenticated
  with check ((select private.has_role(array['admin']::public.staff_role[])));
create policy "admin update meal periods" on public.meal_periods
  for update to authenticated
  using ((select private.has_role(array['admin']::public.staff_role[])))
  with check ((select private.has_role(array['admin']::public.staff_role[])));

-- meal_records: supervisors/admins read. All writes go through functions.
create policy "supervisors read meal records" on public.meal_records
  for select to authenticated
  using ((select private.has_role(array['supervisor', 'admin']::public.staff_role[])));

-- audit_log: supervisors/admins read. Inserts happen only via triggers.
create policy "supervisors read audit log" on public.audit_log
  for select to authenticated
  using ((select private.has_role(array['supervisor', 'admin']::public.staff_role[])));

-- -----------------------------------------------------------------------------
-- Reporting view (respects the RLS of the underlying tables)
-- -----------------------------------------------------------------------------
create view public.meal_record_details
with (security_invoker = true)
as
select
  r.id,
  r.service_date,
  r.meal_period,
  mp.label as meal_period_label,
  r.checked_in_at,
  r.method,
  r.voided,
  r.void_reason,
  r.updated_at,
  s.id as student_id,
  s.student_code,
  s.first_name,
  s.last_name,
  s.class_name,
  r.recorded_by,
  coalesce(nullif(sp.full_name, ''), sp.email) as recorded_by_name
from public.meal_records r
join public.students s on s.id = r.student_id
join public.meal_periods mp on mp.code = r.meal_period
left join public.staff_profiles sp on sp.id = r.recorded_by;

-- -----------------------------------------------------------------------------
-- RPC functions (the only way to write meal records)
-- -----------------------------------------------------------------------------

-- Check a student in for a meal period today.
-- Returns jsonb with "status" one of:
--   ok | duplicate | unknown_student | inactive_student | invalid_id | invalid_period
create function public.check_in(
  p_student_code text,
  p_meal_period text,
  p_method public.check_in_method default 'scan'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_student_code, ''), E' \t\r\n'));
  v_today date;
  v_student public.students%rowtype;
  v_period public.meal_periods%rowtype;
  v_record public.meal_records%rowtype;
  v_student_json jsonb;
  v_served integer;
begin
  perform private.require_role(array['checkin', 'supervisor', 'admin']::public.staff_role[]);

  if p_method not in ('scan', 'manual') then
    raise exception 'Use add_meal_record for administrative entries.' using errcode = '22023';
  end if;

  if v_code !~ '^[A-Z0-9_-]{1,32}$' then
    return jsonb_build_object('status', 'invalid_id', 'student_code', left(v_code, 40));
  end if;

  select * into v_period from public.meal_periods where code = p_meal_period;
  if not found or not v_period.active then
    return jsonb_build_object('status', 'invalid_period', 'meal_period', p_meal_period);
  end if;

  select * into v_student from public.students where student_code = v_code;
  if not found then
    return jsonb_build_object('status', 'unknown_student', 'student_code', v_code);
  end if;

  v_student_json := jsonb_build_object(
    'student_code', v_student.student_code,
    'first_name', v_student.first_name,
    'last_name', v_student.last_name,
    'class_name', v_student.class_name
  );

  if not v_student.active then
    return jsonb_build_object('status', 'inactive_student', 'student', v_student_json);
  end if;

  v_today := private.school_today();

  insert into public.meal_records (student_id, meal_period, service_date, method, recorded_by)
  values (v_student.id, v_period.code, v_today, p_method, auth.uid())
  on conflict (student_id, meal_period, service_date) where (not voided) do nothing
  returning * into v_record;

  select count(*) into v_served
  from public.meal_records
  where service_date = v_today and meal_period = v_period.code and not voided;

  if v_record.id is null then
    select * into v_record
    from public.meal_records
    where student_id = v_student.id and meal_period = v_period.code
      and service_date = v_today and not voided;

    return jsonb_build_object(
      'status', 'duplicate',
      'student', v_student_json,
      'meal_period', v_period.code,
      'meal_period_label', v_period.label,
      'first_checked_in_at', v_record.checked_in_at,
      'served_count', v_served
    );
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'student', v_student_json,
    'record_id', v_record.id,
    'meal_period', v_period.code,
    'meal_period_label', v_period.label,
    'checked_in_at', v_record.checked_in_at,
    'served_count', v_served
  );
end;
$$;

-- Manual lookup for the check-in screen. Returns at most 25 active students
-- matching a name or ID fragment. Requires at least 2 characters.
create function public.search_students(p_query text, p_limit integer default 15)
returns table (student_code text, first_name text, last_name text, class_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_pattern text;
begin
  perform private.require_role(array['checkin', 'supervisor', 'admin']::public.staff_role[]);

  if length(v_q) < 2 then
    return;
  end if;
  -- Escape LIKE wildcards in user input.
  v_pattern := '%' || replace(replace(replace(lower(left(v_q, 50)), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select s.student_code, s.first_name, s.last_name, s.class_name
  from public.students s
  where s.active
    and (
      lower(s.student_code) like v_pattern
      or lower(s.first_name || ' ' || s.last_name) like v_pattern
      or lower(s.last_name || ' ' || s.first_name) like v_pattern
      or lower(s.last_name || ', ' || s.first_name) like v_pattern
    )
  order by s.last_name, s.first_name
  limit least(greatest(coalesce(p_limit, 15), 1), 25);
end;
$$;

-- Add a record after the fact (e.g. a student was served but not scanned).
create function public.add_meal_record(
  p_student_code text,
  p_meal_period text,
  p_service_date date,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_student_id uuid;
  v_id uuid;
begin
  perform private.require_role(array['supervisor', 'admin']::public.staff_role[]);
  v_reason := private.require_reason(p_reason);

  if p_service_date is null or p_service_date > private.school_today() then
    raise exception 'Service date cannot be in the future.' using errcode = '22023';
  end if;

  select id into v_student_id from public.students
  where student_code = upper(btrim(coalesce(p_student_code, ''), E' \t\r\n'));
  if v_student_id is null then
    raise exception 'No student with that ID.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.meal_periods where code = p_meal_period) then
    raise exception 'Unknown meal period.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', v_reason, true);

  begin
    insert into public.meal_records (student_id, meal_period, service_date, method, recorded_by)
    values (v_student_id, p_meal_period, p_service_date, 'admin', auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This student already has a record for that meal period and date.'
      using errcode = '23505';
  end;

  return v_id;
end;
$$;

-- Correct an existing record: change its meal period or date, void it, or
-- restore a voided record. A reason is always required and is audited.
create function public.correct_meal_record(
  p_record_id uuid,
  p_reason text,
  p_meal_period text default null,
  p_service_date date default null,
  p_voided boolean default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_record public.meal_records%rowtype;
begin
  perform private.require_role(array['supervisor', 'admin']::public.staff_role[]);
  v_reason := private.require_reason(p_reason);

  select * into v_record from public.meal_records where id = p_record_id for update;
  if not found then
    raise exception 'Record not found.' using errcode = '22023';
  end if;

  if p_service_date is not null and p_service_date > private.school_today() then
    raise exception 'Service date cannot be in the future.' using errcode = '22023';
  end if;

  if p_meal_period is not null
     and not exists (select 1 from public.meal_periods where code = p_meal_period) then
    raise exception 'Unknown meal period.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', v_reason, true);

  begin
    update public.meal_records
    set
      meal_period = coalesce(p_meal_period, meal_period),
      service_date = coalesce(p_service_date, service_date),
      voided = coalesce(p_voided, voided),
      void_reason = case
        when p_voided is true then v_reason
        when p_voided is false then null
        else void_reason end,
      voided_at = case
        when p_voided is true and not v_record.voided then now()
        when p_voided is false then null
        else voided_at end,
      voided_by = case
        when p_voided is true and not v_record.voided then auth.uid()
        when p_voided is false then null
        else voided_by end
    where id = p_record_id;
  exception when unique_violation then
    raise exception 'This student already has a record for that meal period and date.'
      using errcode = '23505';
  end;
end;
$$;

-- Bulk roster import (admin). Upserts by student_code. Accepts a JSON array of
-- {student_code, first_name, last_name, class_name, active?}. All-or-nothing:
-- any invalid row aborts the whole batch.
create function public.import_students(p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_inserted integer;
  v_updated integer;
begin
  perform private.require_role(array['admin']::public.staff_role[]);

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a JSON array of students.' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total > 5000 then
    raise exception 'Import at most 5000 students per batch.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Roster import', true);

  with input as (
    select
      upper(btrim(r ->> 'student_code', E' \t\r\n')) as student_code,
      btrim(r ->> 'first_name') as first_name,
      btrim(r ->> 'last_name') as last_name,
      btrim(coalesce(r ->> 'class_name', '')) as class_name,
      coalesce((r ->> 'active')::boolean, true) as active
    from jsonb_array_elements(p_rows) r
  ),
  upserted as (
    insert into public.students as s (student_code, first_name, last_name, class_name, active)
    select student_code, first_name, last_name, class_name, active from input
    on conflict (student_code) do update
      set first_name = excluded.first_name,
          last_name = excluded.last_name,
          class_name = excluded.class_name,
          active = excluded.active
      where (s.first_name, s.last_name, s.class_name, s.active)
        is distinct from (excluded.first_name, excluded.last_name, excluded.class_name, excluded.active)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
  into v_inserted, v_updated
  from upserted;

  return jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_total - v_inserted - v_updated
  );
end;
$$;

-- Today's date in the school's time zone (for the dashboard default filter).
create function public.school_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select private.school_today()
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
-- Supabase grants broad table privileges to anon/authenticated by default and
-- relies on RLS. We additionally remove everything from anon, and remove
-- direct write privileges where all writes must go through functions.
revoke all on all tables in schema public from anon;
revoke all on public.meal_record_details from anon;
revoke insert, update, delete, truncate on public.meal_records from authenticated;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
revoke delete, truncate on public.students, public.meal_periods, public.app_settings,
  public.staff_profiles from authenticated;
revoke insert on public.staff_profiles, public.app_settings from authenticated;

-- Functions are executable by PUBLIC by default in Postgres. Lock them down.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function
  public.check_in(text, text, public.check_in_method),
  public.search_students(text, integer),
  public.add_meal_record(text, text, date, text),
  public.correct_meal_record(uuid, text, text, date, boolean),
  public.import_students(jsonb),
  public.school_today()
to authenticated;

grant execute on function
  private.current_staff_role(),
  private.has_role(public.staff_role[])
to authenticated;

-- -----------------------------------------------------------------------------
-- Default configuration rows (not student data)
-- -----------------------------------------------------------------------------
insert into public.app_settings (id) values (true);

-- SCHOOL-SPECIFIC: adjust codes, labels and times to the school's schedule.
insert into public.meal_periods (code, label, starts_at, ends_at, sort_order) values
  ('breakfast', 'Breakfast', '06:30', '09:30', 10),
  ('lunch', 'Lunch', '11:00', '14:00', 20),
  ('snack', 'After-school snack', '14:30', '17:00', 30);
