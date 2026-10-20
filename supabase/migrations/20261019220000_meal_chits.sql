-- =============================================================================
-- Meal chits
--
-- Students hand in a coloured chit for each meal. The colour depends on the
-- feeding plan and the meal:
--   * Once a day:   one meal, Lunch OR Supper, blue chit
--   * Twice a day:  Lunch (pinkish-red chit) and Supper (yellow chit)
--   * Thrice a day: Breakfast, Lunch and Supper, blue chit at every meal
-- The check-in screen shows which chit to collect. Admins can change colours on
-- the Feeding plans page. Existing meal records are not changed.
-- =============================================================================

alter table public.feeding_plan_periods
  add column chit_color text
  check (chit_color in ('blue', 'pink', 'yellow', 'green', 'orange', 'purple', 'white'));

comment on column public.feeding_plan_periods.chit_color is
  'Colour of the meal chit for this plan and meal period (null = no chit). pink = pinkish red.';

-- Plans as used at Valley View University.
select set_config('app.audit_reason', 'Meal chits and plan periods set', true);

delete from public.feeding_plan_periods
where (plan_code, meal_period) in (('once', 'breakfast'), ('twice', 'breakfast'));

insert into public.feeding_plan_periods (plan_code, meal_period, chit_color) values
  ('once', 'lunch', 'blue'),
  ('once', 'supper', 'blue'),
  ('twice', 'lunch', 'pink'),
  ('twice', 'supper', 'yellow'),
  ('thrice', 'breakfast', 'blue'),
  ('thrice', 'lunch', 'blue'),
  ('thrice', 'supper', 'blue')
on conflict (plan_code, meal_period) do update set chit_color = excluded.chit_color;

update public.feeding_plans set meals_per_day = 1 where code = 'once' and meals_per_day <> 1;
update public.feeding_plans set meals_per_day = 2 where code = 'twice' and meals_per_day <> 2;
update public.feeding_plans set meals_per_day = 3 where code = 'thrice' and meals_per_day <> 3;

-- set_feeding_plan gains the chit colour for each meal period.
drop function public.set_feeding_plan(text, text, integer, text[]);

create function public.set_feeding_plan(
  p_code text,
  p_label text,
  p_meals_per_day integer,
  p_meal_periods text[],
  p_chit_colors jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_periods text[] := array(select distinct unnest(coalesce(p_meal_periods, '{}')));
  v_chits jsonb := coalesce(p_chit_colors, '{}'::jsonb);
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
  if jsonb_typeof(v_chits) <> 'object' then
    raise exception 'Chit colours must be an object of meal period to colour.' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason', 'Feeding plan updated', true);

  update public.feeding_plans
  set label = btrim(p_label), meals_per_day = p_meals_per_day
  where code = p_code
    and (label, meals_per_day) is distinct from (btrim(p_label), p_meals_per_day);

  delete from public.feeding_plan_periods
  where plan_code = p_code and meal_period <> all (v_periods);

  -- An unknown colour fails the chit_color check constraint.
  insert into public.feeding_plan_periods as fpp (plan_code, meal_period, chit_color)
  select p_code, p, nullif(v_chits ->> p, '') from unnest(v_periods) p
  on conflict (plan_code, meal_period) do update
    set chit_color = excluded.chit_color
    where fpp.chit_color is distinct from excluded.chit_color;
end;
$$;

revoke execute on function public.set_feeding_plan(text, text, integer, text[], jsonb) from public, anon;
grant execute on function public.set_feeding_plan(text, text, integer, text[], jsonb) to authenticated;
