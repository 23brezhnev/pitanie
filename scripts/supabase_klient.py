"""Общий кусок для скриптов: запрос в Supabase и внятная ошибка про сертификаты."""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request

CERT_HELP = """
Python не смог проверить сертификат Supabase.

Это не проблема с ключом или сетью: сборка Python с python.org идёт со своей
связкой корневых сертификатов и не читает системную связку ключей macOS.

Лечится один раз:
  python3 -m pip install --user --upgrade certifi

Либо запусти «Install Certificates.command» из папки Программы → Python 3.x.
""".strip()


def ssl_context() -> ssl.SSLContext:
    """
    Контекст с проверкой сертификата.

    certifi, если он есть: на маке связка от python.org часто пустая, и тогда
    системный контекст не проверит ничего. Проверку не отключаем никогда —
    ключ service_role уходит в этот запрос.
    """
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key
        self.context = ssl_context()

    def call(self, path: str, payload: dict, method: str = "POST", prefer: str = "") -> object:
        request = urllib.request.Request(
            f"{self.url}/rest/v1/{path}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method=method,
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Prefer": f"return=minimal,{prefer}" if prefer else "return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60, context=self.context) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body.strip() else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")
            raise SystemExit(f"Supabase ответил {error.code} на {path}:\n{detail}") from error
        except urllib.error.URLError as error:
            if isinstance(error.reason, ssl.SSLError):
                raise SystemExit(CERT_HELP) from error
            raise SystemExit(f"Не достучались до Supabase: {error.reason}") from error

    def rpc(self, name: str, payload: dict) -> object:
        return self.call(f"rpc/{name}", payload)
