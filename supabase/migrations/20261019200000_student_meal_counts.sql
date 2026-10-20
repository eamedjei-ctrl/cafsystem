-- =============================================================================
-- Times fed per student
--
-- One row per student with the number of meals they were served (voided
-- records excluded) between two school dates. Lists every active student,
-- including those fed zero times, plus any inactive student who was fed in the
-- range. Security invoker: row-level security on students and meal_records
-- limits it to supervisors and admins, exactly like the Meal records page.
-- =============================================================================

create function public.student_meal_counts(
  p_from date,
  p_to date,
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with fed as (
    select r.student_id, count(*)::integer as n
    from public.meal_records r
    where not r.voided and r.service_date between p_from and p_to
    group by r.student_id
  ),
  -- Every word of the search must match the student ID, first or last name.
  terms as (
    select replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as t
    from regexp_split_to_table(btrim(coalesce(p_search, '')), '\s+') as t
    where t <> ''
  ),
  matched as (
    select s.student_code, s.first_name, s.last_name, coalesce(f.n, 0) as times_fed
    from public.students s
    left join fed f on f.student_id = s.id
    where (s.active or f.n is not null)
      and not exists (
        select 1 from terms
        where not (s.student_code ilike '%' || terms.t || '%'
                or s.first_name ilike '%' || terms.t || '%'
                or s.last_name ilike '%' || terms.t || '%')
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(m) order by m.last_name, m.first_name, m.student_code)
       from (select * from matched
             order by last_name, first_name, student_code
             limit least(greatest(coalesce(p_limit, 50), 1), 1000)
             offset greatest(coalesce(p_offset, 0), 0)) m),
      '[]'::jsonb)
  )
$$;

revoke execute on function public.student_meal_counts(date, date, text, integer, integer) from public, anon;
grant execute on function public.student_meal_counts(date, date, text, integer, integer) to authenticated;
