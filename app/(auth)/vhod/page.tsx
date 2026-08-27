import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ADMIN_PASSWORD, SESSION_SECRET } from '@/lib/env';
import { SESSION_COOKIE, issueSession, passwordMatches } from '@/lib/session';

export const metadata = { title: 'Вход — дневник питания' };

/** Возвращаем только на внутренний путь: «//зло.рф» — тоже валидный URL для браузера. */
function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

async function signIn(formData: FormData) {
  'use server';

  const next = safeNext(String(formData.get('dalee') ?? ''));
  const password = String(formData.get('parol') ?? '');

  if (!passwordMatches(password, ADMIN_PASSWORD())) {
    redirect(`/vhod?oshibka=1&dalee=${encodeURIComponent(next)}`);
  }

  const session = await issueSession(SESSION_SECRET());
  (await cookies()).set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: session.maxAge,
  });

  redirect(next);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ dalee?: string; oshibka?: string }>;
}) {
  const params = await searchParams;

  return (
    <main
      className="shell"
      style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', paddingTop: 24 }}
    >
      <form
        action={signIn}
        className="card"
        style={{ width: 'min(360px, 100%)', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div>
          <h1 style={{ fontSize: 20 }}>Дневник питания</h1>
          <p className="form-note" style={{ marginTop: 4 }}>
            Личный сервис. Введи пароль, чтобы посмотреть аналитику.
          </p>
        </div>

        <input type="hidden" name="dalee" value={safeNext(params.dalee)} />

        <div className="field">
          <label htmlFor="parol">Пароль</label>
          <input id="parol" name="parol" type="password" autoFocus autoComplete="current-password" />
        </div>

        {params.oshibka && <p className="error">Пароль не подошёл. Попробуй ещё раз.</p>}

        <button type="submit" className="button button-primary">
          Войти
        </button>
      </form>
    </main>
  );
}
