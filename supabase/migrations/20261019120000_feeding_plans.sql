-- =============================================================================
-- Feeding plans ("sections"): students are fed once, twice or thrice a day.
--
--   * Each plan says how many meals a student may have per day and which meal
--     periods it covers. Admins can change both (set_feeding_plan).
--   * check_in now refuses a meal period the student's plan does not cover, or
--     a meal beyond the plan's daily limit, with a clear status.
--   * Students with no plan (plan_code null) are not restricted, so existing
--     rosters keep working until plans are assigned.
--   * Each meal record keeps the plan the student was on when served, so
--     reports stay correct if a student later changes plan.
--
-- Additive and safe to run on a database that already has data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.feeding_plans (
  code text primary key check (code ~ '^[a-z0-9_]{1,30}$'),
  label text not null check (length(btrim(label)) between 1 and 50),
  meals_per_day integer not null check (meals_per_day between 1 and 5),
  sort_order integer not null default 0
);

create table public.feeding_plan_periods (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null references public.feeding_plans (code) on update cascade on delete cascade,
  meal_period text not null references public.meal_periods (code) on update cascade on delete cascade,
  unique (plan_code, meal_period)
);

alter table public.students
  add column plan_code text references public.feeding_plans (code) on update cascade;
create index students_plan_idx on public.students (plan_code);

alter table public.meal_records
  add column plan_code text references public.feeding_plans (code) on update cascade;
create index meal_records_plan_idx on public.meal_records (plan_code, service_date);

-- -----------------------------------------------------------------------------
-- Audit, RLS, privileges
-- -----------------------------------------------------------------------------
create trigger audit_feeding_plans after insert or update or delete on public.feeding_plans
  for each row execute function private.write_audit_log();
create trigger audit_feeding_plan_periods after insert or update or delete on public.feeding_plan_periods
  for each row execute function private.write_audit_log();

alter table public.feeding_plans enable row level security;
alter table public.feeding_plan_periods enable row level security;

-- Any active staff can read plans (the tablet shows them). Changes go through
-- set_feeding_plan (admin only), so there are no write policies.
create policy "staff read feeding plans" on public.feeding_plans
  for select to authenticated
  using ((select private.current_staff_role()) is not null);
create policy "staff read feeding plan periods" on public.feeding_plan_periods
  for select to authenticated
  using ((select private.current_staff_role()) is not null);

revoke all on public.feeding_plans, public.feeding_plan_periods from anon;
revoke insert, update, delete, truncate on public.feeding_plans, public.feeding_plan_periods from authenticated;

-- -----------------------------------------------------------------------------
-- Default plans and a supper period for the third meal
-- SCHOOL-SPECIFIC: adjust in the app (Feeding plans page) or here.
-- -----------------------------------------------------------------------------
insert into public.meal_periods (code, label, starts_at, ends_at, sort_order)
values ('supper', 'Supper', '17:30', '19:30', 40)
on conflict (code) do nothing;

-- The after-school snack is replaced by supper on fresh installs. If it has
-- already been used, leave it alone.
update public.meal_periods set active = false
where code = 'snack' and not exists (select 1 from public.meal_records where meal_period = 'snack');

insert into public.feeding_plans (code, label, meals_per_day, sort_order) values
  ('once', 'Once a day', 1, 10),
  ('twice', 'Twice a day', 2, 20),
  ('thrice', 'Thrice a day', 3, 30)
on conflict (code) do nothing;

insert into public.feeding_plan_periods (plan_code, meal_period) values
  ('once', 'lunch'),
  ('twice', 'breakfast'),
  ('twice', 'lunch'),
  ('thrice', 'breakfast'),
  ('thrice', 'lunch'),
  ('thrice', 'supper')
on conflict (plan_code, meal_period) do nothing;

-- -----------------------------------------------------------------------------
-- Reporting view: add the plan the meal was served under (columns appended)
-- -----------------------------------------------------------------------------
create or replace view public.meal_record_details
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
  coalesce(nullif(sp.full_name, ''), sp.email) as recorded_by_name,
  r.plan_code,
  fp.label as plan_label
from public.meal_records r
join public.students s on s.id = r.student_id
join public.meal_periods mp on mp.code = r.meal_period
left join public.staff_profiles sp on sp.id = r.recorded_by
left join public.feeding_plans fp on fp.code = r.plan_code;

-- -----------------------------------------------------------------------------
-- check_in with feeding-plan rules
-- Statuses: ok | duplicate | not_on_plan | plan_limit_reached |
--           unknown_student | inactive_student | invalid_id | invalid_period
-- -----------------------------------------------------------------------------
create or replace function public.check_in(
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
  v_plan public.feeding_plans%rowtype;
  v_record public.meal_records%rowtype;
  v_student_json jsonb;
  v_served integer;
  v_meals_today integer;
  v_labels jsonb;
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

  -- Lock the student row so two tablets cannot both serve past the plan limit.
  select * into v_student from public.students where student_code = v_code for update;
  if not found then
    return jsonb_build_object('status', 'unknown_student', 'student_code', v_code);
  end if;

  if v_student.plan_code is not null then
    select * into v_plan from public.feeding_plans where code = v_student.plan_code;
  end if;

  v_student_json := jsonb_build_object(
    'student_code', v_student.student_code,
    'first_name', v_student.first_name,
    'last_name', v_student.last_name,
    'class_name', v_student.class_name,
    'plan_code', v_plan.code,
    'plan_label', v_plan.label
  );

  if not v_student.active then
    return jsonb_build_object('status', 'inactive_student', 'student', v_student_json);
  end if;

  v_today := private.school_today();

  -- Already served this period? That is the most specific explanation.
  select * into v_record
  from public.meal_records
  where student_id = v_student.id and meal_period = v_period.code
    and service_date = v_today and not voided;
  if found then
    select count(*) into v_served from public.meal_records
    where service_date = v_today and meal_period = v_period.code and not voided;
    return jsonb_build_object(
      'status', 'duplicate',
      'student', v_student_json,
      'meal_period', v_period.code,
      'meal_period_label', v_period.label,
      'first_checked_in_at', v_record.checked_in_at,
      'served_count', v_served
    );
  end if;

  if v_plan.code is not null then
    if not exists (
      select 1 from public.feeding_plan_periods
      where plan_code = v_plan.code and meal_period = v_period.code
    ) then
      select coalesce(jsonb_agg(mp.label order by mp.sort_order), '[]'::jsonb) into v_labels
      from public.feeding_plan_periods fpp
      join public.meal_periods mp on mp.code = fpp.meal_period
      where fpp.plan_code = v_plan.code;
      return jsonb_build_object(
        'status', 'not_on_plan',
        'student', v_student_json,
        'meal_period', v_period.code,
        'meal_period_label', v_period.label,
        'allowed_periods', v_labels
      );
    end if;

    select count(*), coalesce(jsonb_agg(mp.label order by mp.sort_order), '[]'::jsonb)
    into v_meals_today, v_labels
    from public.meal_records r
    join public.meal_periods mp on mp.code = r.meal_period
    where r.student_id = v_student.id and r.service_date = v_today and not r.voided;

    if v_meals_today >= v_plan.meals_per_day then
      return jsonb_build_object(
        'status', 'plan_limit_reached',
        'student', v_student_json,
        'meal_period', v_period.code,
        'meal_period_label', v_period.label,
        'meals_today', v_meals_today,
        'meals_per_day', v_plan.meals_per_day,
        'meals_today_periods', v_labels
      );
    end if;
  end if;

  insert into public.meal_records (student_id, meal_period, service_date, method, recorded_by, plan_code)
  values (v_student.id, v_period.code, v_today, p_method, auth.uid(), v_plan.code)
  on conflict (student_id, meal_period, service_date) where (not voided) do nothing
  returning * into v_record;

  select count(*) into v_served from public.meal_records
  where service_date = v_today and meal_period = v_period.code and not voided;

  if v_record.id is null then
    -- Lost a race with another device (should not happen thanks to the lock).
    select * into v_record from public.meal_records
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

-- Manual lookup now also returns the student's plan (return type changes, so
-- the function is recreated).
drop function public.search_students(text, integer);
create function public.search_students(p_query text, p_limit integer default 15)
returns table (student_code text, first_name text, last_name text, class_name text, plan_label text)
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
  v_pattern := '%' || replace(replace(replace(lower(left(v_q, 50)), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select s.student_code, s.first_name, s.last_name, s.class_name, fp.label
  from public.students s
  left join public.feeding_plans fp on fp.code = s.plan_code
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

-- Supervisor corrections record the student's current plan. Plan rules are
-- NOT applied here: adding a record afterwards is a deliberate override.
create or replace function public.add_meal_record(
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
  v_student public.students%rowtype;
  v_id uuid;
begin
  perform private.require_role(array['supervisor', 'admin']::public.staff_role[]);
  v_reason := private.require_reason(p_reason);

  if p_service_date is null or p_service_date > private.school_today() then
    raise exception 'Service date cannot be in the future.' using errcode = '22023';
  end if;

  select * into v_student from public.students
  where student_code = upper(btrim(coalesce(p_student_code, ''), E' \t\r\n'));
  if not found then
    raise exception 'No student with that ID.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.meal_periods where code = p_meal_period) then
    raise exception 'Unknown meal period.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', v_reason, true);

  begin
    insert into public.meal_records (student_id, meal_period, service_date, method, recorded_by, plan_code)
    values (v_student.id, p_meal_period, p_service_date, 'admin', auth.uid(), v_student.plan_code)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This student already has a record for that meal period and date.'
      using errcode = '23505';
  end;

  return v_id;
end;
$$;

-- Roster import with an optional plan_code per row. Plans are only changed if
-- the batch includes a plan_code key, so importing an older CSV without a plan
-- column never wipes existing plans. An empty plan_code clears the plan.
create or replace function public.import_students(p_rows jsonb)
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
  v_has_plan boolean;
begin
  perform private.require_role(array['admin']::public.staff_role[]);

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a JSON array of students.' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total > 5000 then
    raise exception 'Import at most 5000 students per batch.' using errcode = '22023';
  end if;

  v_has_plan := exists (select 1 from jsonb_array_elements(p_rows) r where r ? 'plan_code');

  perform set_config('app.audit_reason', 'Roster import', true);

  with input as (
    select
      upper(btrim(r ->> 'student_code', E' \t\r\n')) as student_code,
      btrim(r ->> 'first_name') as first_name,
      btrim(r ->> 'last_name') as last_name,
      btrim(coalesce(r ->> 'class_name', '')) as class_name,
      coalesce((r ->> 'active')::boolean, true) as active,
      nullif(lower(btrim(coalesce(r ->> 'plan_code', ''))), '') as plan_code
    from jsonb_array_elements(p_rows) r
  ),
  upserted as (
    insert into public.students as s (student_code, first_name, last_name, class_name, active, plan_code)
    select student_code, first_name, last_name, class_name, active, plan_code from input
    on conflict (student_code) do update
      set first_name = excluded.first_name,
          last_name = excluded.last_name,
          class_name = excluded.class_name,
          active = excluded.active,
          plan_code = case when v_has_plan then excluded.plan_code else s.plan_code end
      where (s.first_name, s.last_name, s.class_name, s.active,
             case when v_has_plan then s.plan_code else null end)
        is distinct from
            (excluded.first_name, excluded.last_name, excluded.class_name, excluded.active,
             case when v_has_plan then excluded.plan_code else null end)
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

-- Admin: change a plan's name, daily meal limit and meal periods.
create function public.set_feeding_plan(
  p_code text,
  p_label text,
  p_meals_per_day integer,
  p_meal_periods text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_periods text[] := array(select distinct unnest(coalesce(p_meal_periods, '{}')));
begin
  perform private.require_role(array['admin']::public.staff_role[]);

  if not exists (select 1 from public.feeding_plans where code = p_code) then
    raise exception 'Unknown feeding plan.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_periods) p
    where not exists (select 1 from public.meal_periods mp where mp.code = p)
  ) then
    raise exception 'Unknown meal period.' using errcode = '22023';
  end if;
  if cardinality(v_periods) = 0 then
    raise exception 'Choose at least one meal period.' using errcode = '22023';
  end if;
  if p_meals_per_day is null or p_meals_per_day < 1 or p_meals_per_day > cardinality(v_periods) then
    raise exception 'Meals per day must be between 1 and the number of meal periods chosen (%).',
      cardinality(v_periods) using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Feeding plan updated', true);

  update public.feeding_plans
  set label = btrim(p_label), meals_per_day = p_meals_per_day
  where code = p_code
    and (label, meals_per_day) is distinct from (btrim(p_label), p_meals_per_day);

  delete from public.feeding_plan_periods
  where plan_code = p_code and meal_period <> all (v_periods);

  insert into public.feeding_plan_periods (plan_code, meal_period)
  select p_code, p from unnest(v_periods) p
  on conflict (plan_code, meal_period) do nothing;
end;
$$;

-- Per-plan totals for the dashboard: active students on each plan and meals
-- served per period in a date range. SECURITY INVOKER, so it only counts what
-- the caller is allowed to read (check-in staff see zeros).
create function public.feeding_plan_summary(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(t) - 'sort_order' order by t.sort_order), '[]'::jsonb)
  from (
    select
      p.code as plan_code,
      p.label as plan_label,
      p.meals_per_day,
      p.sort_order,
      (select count(*) from public.students s where s.plan_code = p.code and s.active) as enrolled,
      (select coalesce(jsonb_object_agg(x.meal_period, x.n), '{}'::jsonb)
       from (select r.meal_period, count(*) as n from public.meal_records r
             where r.plan_code = p.code and not r.voided
               and r.service_date between p_from and p_to
             group by r.meal_period) x) as served
    from public.feeding_plans p
    union all
    select
      null, 'No plan set', null, 2147483647,
      (select count(*) from public.students s where s.plan_code is null and s.active),
      (select coalesce(jsonb_object_agg(x.meal_period, x.n), '{}'::jsonb)
       from (select r.meal_period, count(*) as n from public.meal_records r
             where r.plan_code is null and not r.voided
               and r.service_date between p_from and p_to
             group by r.meal_period) x)
  ) t
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.check_in(text, text, public.check_in_method),
  public.search_students(text, integer),
  public.add_meal_record(text, text, date, text),
  public.import_students(jsonb),
  public.set_feeding_plan(text, text, integer, text[]),
  public.feeding_plan_summary(date, date)
to authenticated;
