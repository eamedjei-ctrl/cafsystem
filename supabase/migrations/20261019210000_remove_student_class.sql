-- =============================================================================
-- Remove student class
--
-- The school does not use classes, so students.class_name is dropped. The
-- records view, check-in, manual lookup and roster import are recreated without
-- it (bodies otherwise unchanged from 20261019120000_feeding_plans.sql).
-- =============================================================================

drop view public.meal_record_details;
drop function public.search_students(text, integer);

-- Normalisation trigger no longer touches class_name.
create or replace function private.normalize_student()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.student_code := upper(btrim(new.student_code, E' \t\r\n'));
  new.first_name := btrim(new.first_name);
  new.last_name := btrim(new.last_name);
  return new;
end;
$$;

drop index public.students_class_idx;
alter table public.students drop column class_name;

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
  r.recorded_by,
  coalesce(nullif(sp.full_name, ''), sp.email) as recorded_by_name,
  r.plan_code,
  fp.label as plan_label
from public.meal_records r
join public.students s on s.id = r.student_id
join public.meal_periods mp on mp.code = r.meal_period
left join public.staff_profiles sp on sp.id = r.recorded_by
left join public.feeding_plans fp on fp.code = r.plan_code;

revoke all on public.meal_record_details from anon;
grant select on public.meal_record_details to authenticated;

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

create function public.search_students(p_query text, p_limit integer default 15)
returns table (student_code text, first_name text, last_name text, plan_label text)
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
  select s.student_code, s.first_name, s.last_name, fp.label
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
      coalesce((r ->> 'active')::boolean, true) as active,
      nullif(lower(btrim(coalesce(r ->> 'plan_code', ''))), '') as plan_code
    from jsonb_array_elements(p_rows) r
  ),
  upserted as (
    insert into public.students as s (student_code, first_name, last_name, active, plan_code)
    select student_code, first_name, last_name, active, plan_code from input
    on conflict (student_code) do update
      set first_name = excluded.first_name,
          last_name = excluded.last_name,
          active = excluded.active,
          plan_code = case when v_has_plan then excluded.plan_code else s.plan_code end
      where (s.first_name, s.last_name, s.active,
             case when v_has_plan then s.plan_code else null end)
        is distinct from
            (excluded.first_name, excluded.last_name, excluded.active,
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

revoke execute on function public.search_students(text, integer) from public, anon;
grant execute on function public.search_students(text, integer) to authenticated;
