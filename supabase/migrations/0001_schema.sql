-- Дневник питания Виктора: схема хранения.
--
-- Точка входа данных — Claude через Supabase MCP (service_role).
-- Админка читает данные только на сервере, тоже под service_role.
-- Поэтому RLS включён везде и политик нет: anon и authenticated не видят ничего.

-- ---------------------------------------------------------------- справочные

create type public.meal as enum ('Завтрак', 'Обед', 'Перекус', 'Ужин');

-- ------------------------------------------------------------------- нормы

create table public.settings (
  id                 smallint primary key default 1 check (id = 1),
  calories_target    integer       not null default 1900,
  calories_tolerance integer       not null default 100,
  protein_target     numeric(6, 1),
  fat_target         numeric(6, 1),
  carbs_target       numeric(6, 1),
  fiber_target       numeric(6, 1),
  sugar_max          numeric(6, 1),
  salt_max           numeric(6, 1),
  sat_fat_max        numeric(6, 1),
  weight_start       numeric(5, 1),
  weight_goal        numeric(5, 1),
  steps_target       integer       not null default 8000,
  rules              text,
  updated_at         timestamptz   not null default now()
);

comment on table public.settings is 'Единственная строка с нормами. Заменяет «Система питания.md».';
comment on column public.settings.calories_tolerance is 'Полуширина коридора калорий: день в норме, если |калории - цель| <= допуск.';
comment on column public.settings.rules is 'Правила питания в markdown — то, что раньше лежало в «Система питания.md».';

-- -------------------------------------------------------------------- дни

create table public.days (
  d          date primary key,
  calories   integer,
  protein    numeric(6, 1),
  fat        numeric(6, 1),
  carbs      numeric(6, 1),
  fiber      numeric(6, 1),
  sugar      numeric(6, 1),
  salt       numeric(6, 1),
  sat_fat    numeric(6, 1),
  weight     numeric(5, 1) check (weight between 50 and 250),
  steps      integer check (steps between 0 and 60000),
  flags      text[]      not null default '{}',
  note       text,
  diary      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.days is 'Итоги дня. Заменяет «Данные питания.csv».';
comment on column public.days.weight is 'Вес, введённый вручную. Пусто — берётся из weight_log, см. v_days.';
comment on column public.days.steps is 'Шаги, введённые вручную. Пусто — берутся из steps_log, см. v_days.';
comment on column public.days.diary is 'Запись дня в markdown. Заменяет блок из «Дневник питания.md».';

-- ------------------------------------------------------------------ блюда

create table public.dishes (
  id       bigint generated always as identity primary key,
  d        date        not null references public.days (d) on delete cascade,
  meal     public.meal not null,
  pos      integer     not null default 0,
  dish     text        not null,
  product  text        not null,
  calories integer,
  protein  numeric(6, 1),
  fat      numeric(6, 1),
  carbs    numeric(6, 1)
);

comment on table public.dishes is 'Одна строка — одно блюдо. Заменяет «Блюда.csv».';
comment on column public.dishes.dish is 'Как сказал Виктор: с брендом и порцией.';
comment on column public.dishes.product is 'Нормализованный ключ для топа: родовое название без бренда, веса и приготовления.';

create index dishes_d_idx on public.dishes (d);
create index dishes_product_idx on public.dishes (product);

-- ----------------------------------------------------- продукты, словарь ключей

create table public.products (
  name       text primary key,
  aliases    text[]      not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.products is
  'Словарь нормализованных ключей. Пополняется триггером при записи блюд, чтобы «Сыр» и «Сыр Село Зелёное» не разошлись в две строки топа.';

create or replace function public.remember_product() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.products (name) values (new.product) on conflict (name) do nothing;
  return new;
end;
$$;

create trigger dishes_remember_product
  after insert or update of product on public.dishes
  for each row execute function public.remember_product();

-- ------------------------------------------------- вес и шаги из Apple Health

create table public.weight_log (
  d           date primary key,
  kg          numeric(5, 1) not null check (kg between 50 and 250),
  source      text          not null default 'health',
  recorded_at timestamptz   not null default now()
);

create table public.steps_log (
  d           date primary key,
  steps       integer     not null check (steps between 100 and 60000),
  source      text        not null default 'health',
  recorded_at timestamptz not null default now()
);

comment on table public.weight_log is 'Односторонний вход из Apple Health. Дата — ключ, последняя запись побеждает.';
comment on table public.steps_log is 'Односторонний вход из Apple Health. Дата — ключ, последняя запись побеждает.';

-- ------------------------------------------------------------ недельные разборы

create table public.weekly_reports (
  week_start date primary key,
  body       text        not null,
  created_at timestamptz not null default now()
);

comment on table public.weekly_reports is 'Недельные разборы в markdown. Заменяет «Отчёты/Неделя YYYY-MM-DD.md».';

-- ----------------------------------------------------------------------- RLS

alter table public.settings       enable row level security;
alter table public.days           enable row level security;
alter table public.dishes         enable row level security;
alter table public.products       enable row level security;
alter table public.weight_log     enable row level security;
alter table public.steps_log      enable row level security;
alter table public.weekly_reports enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- ------------------------------------------------------------------- триггеры

create or replace function public.touch_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger days_touch     before update on public.days     for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();
