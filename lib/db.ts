import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from './env';

/**
 * Клиент Supabase с service_role.
 *
 * На всех таблицах включён RLS и нет ни одной политики, поэтому anon-ключ
 * не увидит ничего. Читает и пишет только сервер — ключ не должен попасть
 * в браузер, значит этот модуль нельзя импортировать в клиентские компоненты.
 */
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL(), SUPABASE_SERVICE_ROLE_KEY(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
