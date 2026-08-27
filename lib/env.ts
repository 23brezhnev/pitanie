/** Переменные окружения. Падаем на старте, а не в середине запроса. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Не задана переменная окружения ${name}. Локально — в .env.local, на Vercel — в настройках проекта.`,
    );
  }
  return value;
}

export const SUPABASE_URL = () => required('SUPABASE_URL');
export const SUPABASE_SERVICE_ROLE_KEY = () => required('SUPABASE_SERVICE_ROLE_KEY');
export const ADMIN_PASSWORD = () => required('ADMIN_PASSWORD');
export const SESSION_SECRET = () => required('SESSION_SECRET');
