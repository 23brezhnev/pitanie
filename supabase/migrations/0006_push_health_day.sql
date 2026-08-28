-- Плоский вход для «Быстрых команд» на айфоне.
--
-- push_health принимает массивы — в редакторе JSON на телефоне их собирать
-- мучительно. Здесь всё приходит строками, как их и отдаёт Shortcuts: пустое
-- или нечисловое значение пропускается, а не роняет запрос. Дата по умолчанию
-- — сегодня по Москве, чтобы команде не требовалось отдельное действие
-- форматирования даты.

create or replace function public.push_health_day(
  p_secret text,
  p_kg     text default null,
  p_steps  text default null,
  p_date   text default null
) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_device text;
  v_date   date;
  v_kg     numeric;
  v_steps  integer;
  v_wrote_weight integer := 0;
  v_wrote_steps  integer := 0;
begin
  select name into v_device
  from public.device_keys
  where secret_sha256 = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex');

  if v_device is null then
    raise exception 'нет доступа' using errcode = '28000';
  end if;

  begin
    v_date := nullif(trim(coalesce(p_date, '')), '')::date;
  exception when others then
    v_date := null;
  end;
  v_date := coalesce(v_date, (now() at time zone 'Europe/Moscow')::date);

  -- Shortcuts может прислать «113,4», пустую строку или мусор — не спорим.
  begin
    v_kg := nullif(replace(trim(coalesce(p_kg, '')), ',', '.'), '')::numeric;
  exception when others then
    v_kg := null;
  end;

  begin
    v_steps := round(nullif(replace(trim(coalesce(p_steps, '')), ',', '.'), '')::numeric);
  exception when others then
    v_steps := null;
  end;

  if v_kg is not null then
    v_wrote_weight := public.log_weight(
      jsonb_build_array(jsonb_build_object('d', v_date, 'kg', v_kg, 'source', 'iphone'))
    );
  end if;

  if v_steps is not null then
    v_wrote_steps := public.log_steps(
      jsonb_build_array(jsonb_build_object('d', v_date, 'steps', v_steps, 'source', 'iphone'))
    );
  end if;

  update public.device_keys set last_used_at = now() where name = v_device;

  return jsonb_build_object('дата', v_date, 'вес', v_wrote_weight, 'шаги', v_wrote_steps);
end;
$$;

comment on function public.push_health_day is
  'Плоский вход для «Быстрых команд» на айфоне: секрет и два значения строками. Дата по умолчанию — сегодня по Москве. Нечисловое и пустое пропускается молча.';

revoke all on function public.push_health_day(text, text, text, text) from public;
grant execute on function public.push_health_day(text, text, text, text) to anon, service_role;
