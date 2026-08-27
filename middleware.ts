import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, isSessionValid } from '@/lib/session';

const PUBLIC_PATHS = ['/vhod'];

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return new NextResponse('Не задана переменная окружения SESSION_SECRET', { status: 500 });
  }

  if (await isSessionValid(request.cookies.get(SESSION_COOKIE)?.value, secret)) {
    return NextResponse.next();
  }

  const login = request.nextUrl.clone();
  login.pathname = '/vhod';
  login.search = '';
  // Куда вернуть после входа. Только внутренний путь — открытый редирект тут не нужен.
  login.searchParams.set('dalee', `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
