-- Закрываем функции от публичного ключа.
--
-- Postgres выдаёт EXECUTE на каждую новую функцию роли PUBLIC, а anon и
-- authenticated наследуют это право. `revoke ... from anon` его не снимает —
-- снимать нужно у PUBLIC. Без этого upsert_day и replace_dishes вызывались
-- по публичному ключу через /rest/v1/rpc, то есть кто угодно с anon-ключом
-- мог переписать любой день.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to service_role, postgres', fn.signature);
  end loop;
end;
$$;

-- То же для будущих функций, чтобы дыра не вернулась со следующей миграцией.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
