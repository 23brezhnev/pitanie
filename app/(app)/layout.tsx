import Link from 'next/link';

import { Nav } from '@/components/Nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
