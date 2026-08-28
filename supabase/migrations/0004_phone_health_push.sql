-- Узкая дверь для айфона: «Быстрые команды» пишут вес и шаги напрямую,
-- минуя Вес.csv и Шаги.csv.
--
-- Ключ service_role на телефон класть нельзя: он даёт полный доступ ко всей
-- базе, а «Быстрая команда» синхронизируется через iCloud и делится одной
-- ссылкой. Поэтому телефон ходит под публичным ключом и предъявляет
-- собственный секрет, а функция умеет ровно две вещи — дописать вес и шаги.
-- Утечёт секрет — максимум запишут чужие цифры веса; ни прочитать, ни
-- удалить ничего нельзя.

create table public.device_keys (
  name          text primary key,
  secret_sha256 text        not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

comment on table public.device_keys is
  'Секреты устройств, которые пишут в базу напрямую. Хранится только хеш — сам секрет живёт в «Быстрых командах» на телефоне.';

alter table public.device_keys enable row level security;
revoke all on public.device_keys from public, anon, authenticated;

create or replace function public.push_health(
  p_secret text,
  p_weight jsonb default null,
  p_steps  jsonb default null
) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_device text;
  v_weight integer := 0;
  v_steps  integer := 0;
begin
  select name into v_device
  from public.device_keys
  where secret_sha256 = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex');

  if v_device is null then
    -- Одно сообщение и на неверный секрет, и на пустой: наружу не сообщаем,
    -- что именно не так.
    raise exception 'нет доступа' using errcode = '28000';
  end if;

  if p_weight is not null and jsonb_typeof(p_weight) = 'array' then
    v_weight := public.log_weight(p_weight);
  end if;

  if p_steps is not null and jsonb_typeof(p_steps) = 'array' then
    v_steps := public.log_steps(p_steps);
  end if;

  update public.device_keys set last_used_at = now() where name = v_device;

  return jsonb_build_object('вес', v_weight, 'шаги', v_steps);
end;
$$;

comment on function public.push_health is
  'Единственная функция, доступная по публичному ключу. Проверяет секрет устройства и пишет только вес и шаги. Значения вне диапазона отсеивают log_weight и log_steps.';

-- Намеренно открыта для anon: это и есть дверь для телефона, её сторожит
-- секрет внутри. Линтер Supabase помечает такие функции предупреждением —
-- здесь это ожидаемо, а не недосмотр.
revoke all on function public.push_health(text, jsonb, jsonb) from public;
grant execute on function public.push_health(text, jsonb, jsonb) to anon, service_role;
