-- Расход и баланс дня как наблюдательный слой.
--
-- В правилах Виктора записано: норму калорий под шаги не пересчитывать.
-- Это правило остаётся — calories_target и in_corridor к расходу не привязаны.
-- Расход нужен, чтобы объяснять движение веса, а не чтобы двигать норму.
--
-- Обе константы взяты из его же «Система питания.md»: коэффициент 1.35 при
-- 5000 шагов и «рост с 5000 до 8000 шагов даёт примерно 250 ккал» — отсюда
-- 250 / 3000 = 0.0833 ккал за шаг.

alter table public.settings
  add column height_cm       numeric(5, 1) not null default 185,
  add column age_years       integer       not null default 30,
  add column activity_factor numeric(4, 2) not null default 1.35,
  add column baseline_steps  integer       not null default 5000,
  add column kcal_per_step   numeric(6, 4) not null default 0.0833;

comment on column public.settings.activity_factor is
  'Коэффициент активности при baseline_steps шагах. 1.35 — из расчёта в «Система питания.md».';
comment on column public.settings.kcal_per_step is
  'Прибавка расхода за шаг сверх baseline_steps. 0.0833 — из правила «3000 шагов ≈ 250 ккал».';

drop view if exists public.v_weeks;
drop view if exists public.v_days;

create view public.v_days with (security_invoker = true) as
with resolved as (
  select
    d.d,
    d.calories, d.protein, d.fat, d.carbs, d.fiber, d.sugar, d.salt, d.sat_fat,
    coalesce(d.weight, w.kg)    as weight,
    coalesce(d.steps,  s.steps) as steps,
    d.weight is not null        as weight_manual,
    d.steps  is not null        as steps_manual,
    d.flags, d.note, d.diary, d.updated_at
  from public.days d
    left join public.weight_log w on w.d = d.d
    left join public.steps_log  s on s.d = d.d
),
-- Вес известен не каждый день: взвешивание 1–2 раза в неделю. Для основного
-- обмена тянем последний известный вперёд, до следующего взвешивания.
carried as (
  select r.*, count(r.weight) over (order by r.d) as weight_run
  from resolved r
),
filled as (
  select
    c.*,
    first_value(c.weight) over (partition by c.weight_run order by c.d) as weight_locf
  from carried c
),
computed as (
  select
    f.*,
    t.calories_target,
    t.steps_target,
    -- Миффлин — Сан Жеор, мужчина. Вес берём последний известный, не средний:
    -- основной обмен меняется вместе с ним.
    case
      when coalesce(f.weight_locf, t.weight_start) is null then null
      else round(
        10 * coalesce(f.weight_locf, t.weight_start)
        + 6.25 * t.height_cm
        - 5 * t.age_years
        + 5
      )
    end as bmr,
    t.activity_factor, t.baseline_steps, t.kcal_per_step
  from filled f
    left join public.settings t on t.id = 1
)
select
  c.d,
  c.calories, c.protein, c.fat, c.carbs, c.fiber, c.sugar, c.salt, c.sat_fat,
  c.weight, c.steps, c.weight_manual, c.steps_manual,
  c.flags, c.note, c.diary, c.updated_at,
  c.calories_target,
  c.steps_target,
  c.calories - c.calories_target as calories_delta,
  case
    when c.calories is null then null
    else abs(c.calories - c.calories_target) <= (select calories_tolerance from public.settings where id = 1)
  end as in_corridor,
  round(avg(c.calories) over w7)    as calories_ma7,
  round(avg(c.weight)   over w7, 2) as weight_ma7,
  round(avg(c.steps)    over w7)    as steps_ma7,
  c.bmr,
  -- Шагов за день нет — расход не выдумываем.
  case
    when c.bmr is null or c.steps is null then null
    else round(c.bmr * c.activity_factor + (c.steps - c.baseline_steps) * c.kcal_per_step)
  end as expenditure,
  case
    when c.bmr is null or c.steps is null or c.calories is null then null
    else round(c.calories - (c.bmr * c.activity_factor + (c.steps - c.baseline_steps) * c.kcal_per_step))
  end as balance
from computed c
window w7 as (order by c.d range between interval '6 days' preceding and current row);

comment on view public.v_days is
  'Основная витрина дней. Нормы подставлены, вес и шаги сведены, средние за 7 дней посчитаны. expenditure и balance — наблюдательный слой: на in_corridor и норму они не влияют.';
comment on column public.v_days.expenditure is
  'Оценка расхода: основной обмен × коэффициент активности + прибавка за шаги сверх базовых. Пусто, если за день нет шагов.';
comment on column public.v_days.balance is
  'Съедено минус потрачено. Минус — дефицит, плюс — профицит.';

create view public.v_weeks with (security_invoker = true) as
with base as (
  select
    date_trunc('week', d)::date           as week_start,
    count(*)                              as days_logged,
    round(avg(calories))                  as avg_calories,
    round(avg(protein), 1)                as avg_protein,
    round(avg(fat), 1)                    as avg_fat,
    round(avg(carbs), 1)                  as avg_carbs,
    round(avg(fiber), 1)                  as avg_fiber,
    round(avg(steps))                     as avg_steps,
    round(avg(weight), 2)                 as avg_weight,
    count(*) filter (where in_corridor)   as days_in_corridor,
    count(*) filter (where flags <> '{}') as days_flagged,
    round(avg(expenditure))               as avg_expenditure,
    round(avg(balance))                   as avg_balance,
    sum(balance)                          as total_balance
  from public.v_days
  group by 1
)
select b.*,
  round(b.avg_weight - lag(b.avg_weight) over (order by b.week_start), 2) as weight_change
from base b;

comment on view public.v_weeks is
  'Недельные агрегаты. weight_change — средний вес недели минус средний вес предыдущей. total_balance — сумма баланса за неделю по дням, где известны шаги.';

revoke all on public.v_days, public.v_weeks from public, anon, authenticated;
