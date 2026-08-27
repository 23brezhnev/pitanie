/**
 * Сессия админки: один пароль, подписанная кука.
 *
 * Пользователь ровно один, поэтому полноценная авторизация тут лишняя.
 * Кука хранит только срок жизни и подпись — ни пароля, ни личных данных.
 * Web Crypto, чтобы код работал и в middleware (Edge), и в маршрутах (Node).
 */

export const SESSION_COOKIE = 'pitanie_session';
const TTL_DAYS = 30;

const encoder = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sign(payload: string, secret: string): Promise<string> {
  return toHex(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload)));
}

/** Сравнение без утечки времени: длина строк тут не секрет, а содержимое — да. */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueSession(secret: string): Promise<{ value: string; maxAge: number }> {
  const maxAge = TTL_DAYS * 24 * 60 * 60;
  const expires = Date.now() + maxAge * 1000;
  const payload = String(expires);
  return { value: `${payload}.${await sign(payload, secret)}`, maxAge };
}

export async function isSessionValid(value: string | undefined, secret: string): Promise<boolean> {
  if (!value) return false;

  const separator = value.lastIndexOf('.');
  if (separator < 1) return false;

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  const expires = Number(payload);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  return equalConstantTime(signature, await sign(payload, secret));
}

export function passwordMatches(given: string, expected: string): boolean {
  return equalConstantTime(given, expected);
}
