-- Измеренный расход и состав тела из Apple Health.
--
-- В выгрузке нашлись активная энергия и энергия покоя за все годы, включая
-- дни без часов: айфон считает их сам. Это ближе к измерению, чем формула от
-- веса и шагов. Формула остаётся запасным вариантом — за дни без данных и на
-- случай, если оценка Apple окажется смещённой.

create table public.energy_log (
  d           date primary key,
  active      numeric(7, 1) check (active between 0 and 5000),
  basal       numeric(7, 1) check (basal between 500 and 5000),
  source      text          not null default 'health-export',
  recorded_at timestamptz   not null default now()
);

create table public.body_log (
  d           date primary key,
  fat_percent numeric(4, 1) check (fat_percent between 3 and 70),
  lean_mass   numeric(5, 1) check (lean_mass between 20 and 150),
  source      text          not null default 'health-export',
  recorded_at timestamptz   not null default now()
);

comment on table public.energy_log is
  'Расход из Apple Health: активная энергия и энергия покоя за день. Сумма — измеренный расход.';
comment on table public.body_log is
  'Состав тела с умных весов. При снижении веса важнее самого веса: показывает, уходит жир или мышцы.';

alter table public.energy_log enable row level security;
alter table public.body_log   enable row level security;
revoke all on public.energy_log, public.body_log from public, anon, authenticated;

create or replace function public.log_energy(p jsonb) returns integer
  language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.energy_log (d, active, basal, source)
  select (e ->> 'd')::date,
         (e ->> 'active')::numeric,
         (e ->> 'basal')::numeric,
         coalesce(e ->> 'source', 'health-export')
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e
  -- Скобки обязательны: «and» связывает крепче «or», и без них строка с
  -- негодной активной энергией проскакивает, если базовая в норме.
  where ((e ->> 'active') is null or (e ->> 'active')::numeric between 0 and 5000)
    and ((e ->> 'basal')  is null or (e ->> 'basal')::numeric  between 500 and 5000)
    and ((e ->> 'active') is not null or (e ->> 'basal') is not null)
  on conflict (d) do update
    set active = coalesce(excluded.active, public.energy_log.active),
        basal  = coalesce(excluded.basal,  public.energy_log.basal),
        source = excluded.source, recorded_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.log_body(p jsonb) returns integer
  language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.body_log (d, fat_percent, lean_mass, source)
  select (e ->> 'd')::date,
         (e ->> 'fat_percent')::numeric,
         (e ->> 'lean_mass')::numeric,
         coalesce(e ->> 'source', 'health-export')
  from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e
  on conflict (d) do update
    set fat_percent = coalesce(excluded.fat_percent, public.body_log.fat_percent),
        lean_mass   = coalesce(excluded.lean_mass,   public.body_log.lean_mass),
        source = excluded.source, recorded_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

alter table public.settings
  add column prefer_measured_expenditure boolean not null default true;

comment on column public.settings.prefer_measured_expenditure is
  'true — расход берётся из Apple Health, где он есть, иначе формула. false — всегда формула.';

-- Новые функции создаются с execute у PUBLIC; отзываем и выдаём явно.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to service_role, postgres', fn.signature);
  end loop;
end;
$$;

-- Дверь для телефона остаётся открытой.
grant execute on function public.push_health(text, jsonb, jsonb) to anon;
grant execute on function public.push_health_day(text, text, text, text) to anon;
