-- Питание из Yazio: два года до перехода на Claude.
--
-- Дни помечаем источником. Yazio вёлся неровно: там, где внесён только
-- завтрак, итог выйдет заниженным, а отличить брошенный день от честного
-- разгрузочного по самим данным нельзя. Метка позволяет исключить такие дни
-- из средних, когда это понадобится, вместо того чтобы гадать задним числом.

alter table public.days
  add column source text not null default 'claude';

comment on column public.days.source is
  'Кто записал день: claude — разбор переписки, yazio — импорт из Apple Health, csv — перенос старых файлов.';

create index days_source_idx on public.days (source);

create or replace function public.log_food_day(p jsonb) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  n integer := 0;
  v_date date;
  e jsonb;
begin
  for e in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb))
  loop
    v_date := (e ->> 'd')::date;
    continue when v_date is null;

    insert into public.days (d, source, calories, protein, fat, carbs, fiber, sugar, salt, sat_fat)
    values (
      v_date,
      coalesce(e ->> 'source', 'yazio'),
      (e ->> 'calories')::integer,
      (e ->> 'protein')::numeric,
      (e ->> 'fat')::numeric,
      (e ->> 'carbs')::numeric,
      (e ->> 'fiber')::numeric,
      (e ->> 'sugar')::numeric,
      (e ->> 'salt')::numeric,
      (e ->> 'sat_fat')::numeric
    )
    on conflict (d) do update
      set calories = excluded.calories,
          protein  = excluded.protein,
          fat      = excluded.fat,
          carbs    = excluded.carbs,
          fiber    = excluded.fiber,
          sugar    = excluded.sugar,
          salt     = excluded.salt,
          sat_fat  = excluded.sat_fat,
          source   = excluded.source
      -- Записи Claude не трогаем: они точнее и сделаны вручную.
      where public.days.source <> 'claude';

    n := n + 1;
  end loop;

  return n;
end;
$$;

comment on function public.log_food_day is
  'Заливка дней питания из внешнего трекера. Дни, записанные Claude, не перезаписываются.';

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

grant execute on function public.push_health(text, jsonb, jsonb) to anon;
grant execute on function public.push_health_day(text, text, text, text) to anon;
