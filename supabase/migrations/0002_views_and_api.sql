-- Витрины для админки и функции, которыми пишет Claude.

-- ---------------------------------------------------------------- вспомогательное

create or replace function public.jsonb_text_array(j jsonb) returns text[]
  language sql immutable set search_path = '' as $$
  select case
    when j is null or jsonb_typeof(j) = 'null' then '{}'::text[]
    else coalesce(array(select jsonb_array_elements_text(j)), '{}'::text[])
  end;
$$;

-- ------------------------------------------------------------------- витрины

-- День со сведёнными весом и шагами: введённое вручную побеждает Apple Health.
create or replace view public.v_days with (security_invoker = true) as
with resolved as (
  select
    d.d,
    d.calories, d.protein, d.fat, d.carbs, d.fiber, d.sugar, d.salt, d.sat_fat,
    coalesce(d.weight, w.kg)   as weight,
    coalesce(d.steps,  s.steps) as steps,
    d.weight is not null        as weight_manual,
    d.steps  is not null        as steps_manual,
    d.flags, d.note, d.diary, d.updated_at
  from public.days d
    left join public.weight_log w on w.d = d.d
    left join public.steps_log  s on s.d = d.d
)
select
  r.*,
  t.calories_target,
  t.steps_target,
  r.calories - t.calories_target as calories_delta,
  case
    when r.calories is null then null
    else abs(r.calories - t.calories_target) <= t.calories_tolerance
  end as in_corridor,
  round(avg(r.calories) over w7)      as calories_ma7,
  round(avg(r.weight)   over w7, 2)   as weight_ma7,
  round(avg(r.steps)    over w7)      as steps_ma7
from resolved r
  left join public.settings t on t.id = 1
window w7 as (order by r.d range between interval '6 days' preceding and current row);

comment on view public.v_days is 'Основная витрина дней: нормы подставлены, вес и шаги сведены, скользящие средние за 7 дней посчитаны.';

-- Итоги дня, посчитанные по блюдам. Могут слегка расходиться с days — это норма.
create or replace view public.v_dish_totals with (security_invoker = true) as
select
  d              as d,
  count(*)       as dishes,
  sum(calories)  as calories,
  sum(protein)   as protein,
  sum(fat)       as fat,
  sum(carbs)     as carbs
from public.dishes
group by d;

-- Разбивка калорий дня по приёмам пищи.
create or replace view public.v_meal_split with (security_invoker = true) as
select d, meal, sum(calories) as calories, count(*) as dishes
from public.dishes
group by d, meal;

-- Недели: понедельник — начало.
create or replace view public.v_weeks with (security_invoker = true) as
with base as (
  select
    date_trunc('week', d)::date               as week_start,
    count(*)                                  as days_logged,
    round(avg(calories))                      as avg_calories,
    round(avg(protein), 1)                    as avg_protein,
    round(avg(fat), 1)                        as avg_fat,
    round(avg(carbs), 1)                      as avg_carbs,
    round(avg(fiber), 1)                      as avg_fiber,
    round(avg(steps))                         as avg_steps,
    round(avg(weight), 2)                     as avg_weight,
    count(*) filter (where in_corridor)       as days_in_corridor,
    count(*) filter (where flags <> '{}')     as days_flagged
  from public.v_days
  group by 1
)
select
  b.*,
  round(b.avg_weight - lag(b.avg_weight) over (order by b.week_start), 2) as weight_change
from base b;

comment on view public.v_weeks is 'Недельные агрегаты. weight_change — средний вес недели минус средний вес предыдущей.';

-- ------------------------------------------------------------ топ продуктов

create or replace function public.top_products(
  p_from  date default null,
  p_to    date default null,
  p_limit integer default 20
) returns table (
  product   text,
  portions  bigint,
  calories  bigint,
  protein   numeric,
  fat       numeric,
  carbs     numeric,
  last_seen date
)
  language sql stable set search_path = '' as $$
  select
    x.product,
    count(*)          as portions,
    sum(x.calories)   as calories,
    sum(x.protein)    as protein,
    sum(x.fat)        as fat,
    sum(x.carbs)      as carbs,
    max(x.d)          as last_seen
  from public.dishes x
  where (p_from is null or x.d >= p_from)
    and (p_to   is null or x.d <= p_to)
  group by x.product
  order by sum(x.calories) desc nulls last
  limit greatest(p_limit, 1);
$$;

comment on function public.top_products is 'Топ нормализованных продуктов за период по сумме калорий.';

-- --------------------------------------------------------- запись: дни и блюда

create or replace function public.upsert_day(p jsonb) returns public.days
  language plpgsql security definer set search_path = '' as $$
declare
  v_date date := (p ->> 'd')::date;
  r      public.days;
begin
  if v_date is null then
    raise exception 'upsert_day: нет даты в поле d';
  end if;

  insert into public.days (d) values (v_date) on conflict (d) do nothing;

  update public.days as t set
    calories = case when p ? 'calories' then (p ->> 'calories')::integer else t.calories end,
    protein  = case when p ? 'protein'  then (p ->> 'protein')::numeric  else t.protein  end,
    fat      = case when p ? 'fat'      then (p ->> 'fat')::numeric      else t.fat      end,
    carbs    = case when p ? 'carbs'    then (p ->> 'carbs')::numeric    else t.carbs    end,
    fiber    = case when p ? 'fiber'    then (p ->> 'fiber')::numeric    else t.fiber    end,
    sugar    = case when p ? 'sugar'    then (p ->> 'sugar')::numeric    else t.sugar    end,
    salt     = case when p ? 'salt'     then (p ->> 'salt')::numeric     else t.salt     end,
    sat_fat  = case when p ? 'sat_fat'  then (p ->> 'sat_fat')::numeric  else t.sat_fat  end,
    weight   = case when p ? 'weight'   then (p ->> 'weight')::numeric   else t.weight   end,
    steps    = case when p ? 'steps'    then (p ->> 'steps')::integer    else t.steps    end,
    note     = case when p ? 'note'     then  p ->> 'note'               else t.note     end,
    diary    = case when p ? 'diary'    then  p ->> 'diary'              else t.diary    end,
    flags    = case when p ? 'flags'    then public.jsonb_text_array(p -> 'flags') else t.flags end
  where t.d = v_date
  returning t.* into r;

  return r;
end;
$$;

comment on function public.upsert_day is
  'Создаёт или обновляет день. Пишутся только переданные ключи, остальные поля остаются как были.';

create or replace function public.replace_dishes(p_date date, p_dishes jsonb) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  insert into public.days (d) values (p_date) on conflict (d) do nothing;
  delete from public.dishes where d = p_date;

  insert into public.dishes (d, meal, pos, dish, product, calories, protein, fat, carbs)
  select
    p_date,
    (e ->> 'meal')::public.meal,
    coalesce((e ->> 'pos')::integer, ord::integer),
    e ->> 'dish',
    e ->> 'product',
    (e ->> 'calories')::integer,
    (e ->> 'protein')::numeric,
    (e ->> 'fat')::numeric,
    (e ->> 'carbs')::numeric
  from jsonb_array_elements(coalesce(p_dishes, '[]'::jsonb)) with ordinality as t (e, ord);

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.replace_dishes is
  'Полностью заменяет блюда за дату: старые строки удаляются, новые пишутся из массива.';

-- --------------------------------------------------- запись: вес и шаги из Health

create or replace function public.log_weight(p jsonb) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  insert into public.weight_log (d, kg, source)
  select (e ->> 'd')::date, (e ->> 'kg')::numeric, coalesce(e ->> 'source', 'health')
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e
  where (e ->> 'kg')::numeric between 50 and 250
  on conflict (d) do update
    set kg = excluded.kg, source = excluded.source, recorded_at = now();

  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.log_steps(p jsonb) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  insert into public.steps_log (d, steps, source)
  select (e ->> 'd')::date, (e ->> 'steps')::integer, coalesce(e ->> 'source', 'health')
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e
  where (e ->> 'steps')::integer between 100 and 60000
  on conflict (d) do update
    set steps = excluded.steps, source = excluded.source, recorded_at = now();

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.log_weight is 'Пакетная заливка веса из Apple Health. Значения вне 50–250 кг отбрасываются молча.';
comment on function public.log_steps  is 'Пакетная заливка шагов из Apple Health. Значения вне 100–60000 отбрасываются молча.';

-- ------------------------------------------------------------------ чтение дня

create or replace function public.day_card(p_date date) returns jsonb
  language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'day',    (select to_jsonb(v) from public.v_days v where v.d = p_date),
    'dishes', coalesce((
                select jsonb_agg(to_jsonb(x) order by x.meal, x.pos)
                from public.dishes x where x.d = p_date
              ), '[]'::jsonb),
    'norms',  (select to_jsonb(s) from public.settings s where s.id = 1)
  );
$$;

comment on function public.day_card is 'Весь день одним запросом: итоги, блюда, нормы.';

revoke all on all functions in schema public from anon, authenticated;
