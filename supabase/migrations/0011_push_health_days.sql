-- Догон пропущенных дней.
--
-- push_health_day умеет ровно один день. Телефон шлёт его в 23:00, и любая
-- ночь, когда команда не запустилась — разряженная батарея, режим экономии,
-- выключенный телефон, — теряется навсегда: следующий запуск про вчера уже
-- не вспомнит.
--
-- push_health_days принимает пачку дней сразу. Команда шлёт последнюю неделю,
-- записи идут upsert'ом по дате, поэтому повтор безвреден: тот же день просто
-- перезапишется тем же числом. Пропуск затягивается сам на первом же удачном
-- запуске.
--
-- Формат — по строке на день, «дата=значение»:
--
--     2026-09-04=8100
--     2026-09-05=6212
--     2026-09-06=3417
--
-- Так его удобно собрать в Shortcuts: цикл по датам и «Combine Text with New
-- Lines». Разделителем строк считаем перевод строки и точку с запятой, но не
-- запятую — она нужна весу («113,4»).

-- Разбор текстового блока в [{"d": дата, "v": число}].
--
-- Мусор пропускаем молча, как и в push_health_day: телефон в три часа ночи
-- некому переспросить, и лучше записать три дня из пяти, чем упасть на всех.
create or replace function public.razobrat_dni(p_text text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out    jsonb := '[]'::jsonb;
  v_stroka text;
  v_hvost  text;
  v_data   date;
  v_znach  numeric;
  v_vsego  integer := 0;
begin
  if p_text is null or btrim(p_text) = '' then
    return v_out;
  end if;

  foreach v_stroka in array regexp_split_to_array(p_text, '[\r\n;]+')
  loop
    -- Больше двух месяцев за раз слать неоткуда: это не импорт истории.
    exit when v_vsego >= 62;

    v_data := null;
    v_znach := null;

    -- Дата вида 2026-13-45 разберётся регуляркой, но не приведётся к date,
    -- поэтому кладём оба разбора под один exception и теряем всю строку.
    begin
      v_data := substring(v_stroka from '(\d{4}-\d{2}-\d{2})')::date;

      -- Знак равенства должен идти сразу за датой. Строгость тут нарочная:
      -- иначе «2026-09-04 23:00=8100» прочиталось бы как число 23008100.
      v_hvost := substring(v_stroka from '\d{4}-\d{2}-\d{2}\s*[=:]\s*(.*)$');

      -- Shortcuts форматирует число по локали и вставляет в тысячи пробел
      -- или неразрывный пробел: «8 100». Выбрасываем всё, кроме цифр и
      -- десятичного знака, — иначе из 8100 шагов получится 8.
      v_znach := nullif(
        replace(regexp_replace(coalesce(v_hvost, ''), '[^0-9.,]', '', 'g'), ',', '.'),
        ''
      )::numeric;
    exception when others then
      v_data := null;
    end;

    if v_data is not null and v_znach is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('d', v_data, 'v', v_znach));
      v_vsego := v_vsego + 1;
    end if;
  end loop;

  return v_out;
end;
$$;

comment on function public.razobrat_dni(text) is
  'Разбирает блок строк «2026-09-04=8100» в [{"d":дата,"v":число}]. Нечитаемые строки пропускает.';

create or replace function public.push_health_days(
  p_secret text,
  p_steps  text default null,
  p_weight text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device  text;
  v_steps   jsonb;
  v_weight  jsonb;
  v_n_steps integer := 0;
  v_n_kg    integer := 0;
begin
  select name into v_device
  from public.device_keys
  where secret_sha256 = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex');

  if v_device is null then
    raise exception 'нет доступа' using errcode = '28000';
  end if;

  -- log_steps приводит значение к integer, дробное число там упадёт.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'd', e ->> 'd',
             'steps', round((e ->> 'v')::numeric),
             'source', 'iphone'
           )), '[]'::jsonb)
    into v_steps
  from jsonb_array_elements(public.razobrat_dni(p_steps)) e;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'd', e ->> 'd',
             'kg', (e ->> 'v')::numeric,
             'source', 'iphone'
           )), '[]'::jsonb)
    into v_weight
  from jsonb_array_elements(public.razobrat_dni(p_weight)) e;

  if jsonb_array_length(v_steps) > 0 then
    v_n_steps := public.log_steps(v_steps);
  end if;

  if jsonb_array_length(v_weight) > 0 then
    v_n_kg := public.log_weight(v_weight);
  end if;

  update public.device_keys set last_used_at = now() where name = v_device;

  -- Короткий ответ: он уходит в уведомление «Notify When Run» на телефоне,
  -- и с него должно быть видно, что ночь не пропала.
  return jsonb_build_object(
    'шаги', v_n_steps,
    'вес', v_n_kg,
    'разобрано', jsonb_array_length(v_steps) + jsonb_array_length(v_weight)
  );
end;
$$;

comment on function public.push_health_days(text, text, text) is
  'Пачка дней с телефона. Догоняет ночи, когда автоматизация не сработала.';

-- Права как у push_health_day: телефон ходит с публичным ключом, поэтому
-- дверь для anon открыта намеренно — её стережёт секрет из device_keys.
revoke all on function public.razobrat_dni(text) from public, anon, authenticated;
grant execute on function public.razobrat_dni(text) to postgres, service_role;

revoke all on function public.push_health_days(text, text, text) from public, anon, authenticated;
grant execute on function public.push_health_days(text, text, text) to postgres, service_role, anon;
