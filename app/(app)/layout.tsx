import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Nav } from '@/components/Nav';
import { SESSION_SECRET } from '@/lib/env';
import { SESSION_COOKIE, isSessionValid } from '@/lib/session';

/**
 * Вторая проверка сессии, рядом с той же в middleware.
 *
 * Дублирование намеренное. В Next.js уже была дыра (CVE-2025-29927), где
 * middleware обходился одним заголовком — и приложение, у которого вся защита
 * висит на нём одном, отдавало данные кому угодно. Проверка здесь стоит
 * дёшево и переживёт следующую такую находку.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isSessionValid(session, SESSION_SECRET()))) {
    redirect('/vhod');
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            Дневник питания
          </Link>
          <Nav />
          <div className="topbar-tail">
            <form action="/api/vyhod" method="post">
              <button type="submit" className="button" style={{ padding: '4px 10px', fontSize: 13 }}>
                Выйти
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="shell">{children}</main>
    </>
  );
}
