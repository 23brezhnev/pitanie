#!/usr/bin/env python3
"""
Перенос дневника питания из файлов в Supabase.

Запускать на маке, где лежит папка «Здоровье и Медицина/Питание» — из этой
сессии до iCloud не дотянуться.

    export SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    python3 scripts/import_iz_csv.py "~/…/Здоровье и Медицина/Питание"

Сначала прогони с --repetitsiya: скрипт разберёт файлы и покажет, что нашёл,
но ничего не запишет.

Импорт идемпотентный: день перезаписывается целиком, блюда за дату заменяются.
Гонять повторно безопасно.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

# --------------------------------------------------------------------- разбор

# Имена колонок ищем по заголовку, а не по номеру: порядок в файлах менялся.
DAY_COLUMNS = {
    "calories": ("калории", "ккал"),
    "protein": ("белок", "белки"),
    "fat": ("жиры", "жир"),
    "carbs": ("углеводы", "углев"),
    "fiber": ("клетчатка", "клетч"),
    "sugar": ("сахар",),
    "salt": ("соль",),
    "sat_fat": ("насыщенные", "насыщ"),
    "weight": ("вес",),
    "steps": ("шаги",),
}

DISH_COLUMNS = {
    "meal": ("приём", "прием", "приём пищи"),
    "dish": ("блюдо",),
    "product": ("продукт",),
    "calories": ("ккал", "калории"),
    "protein": ("белок", "белки"),
    "fat": ("жиры", "жир"),
    "carbs": ("углеводы", "углев"),
}

MEALS = {"завтрак": "Завтрак", "обед": "Обед", "перекус": "Перекус", "ужин": "Ужин"}

MONTHS = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6,
    "июля": 7, "августа": 8, "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
}


def find_column(header: list[str], aliases: tuple[str, ...]) -> int | None:
    normalized = [h.strip().lower() for h in header]
    for alias in aliases:
        for i, name in enumerate(normalized):
            if name == alias:
                return i
    for alias in aliases:
        for i, name in enumerate(normalized):
            if name.startswith(alias):
                return i
    return None


def parse_date(raw: str) -> str | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d.%m.%y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    # «27 августа 2026»
    match = re.match(r"(\d{1,2})\s+([а-яё]+)\s+(\d{4})", raw.lower())
    if match and match.group(2) in MONTHS:
        return date(int(match.group(3)), MONTHS[match.group(2)], int(match.group(1))).isoformat()
    return None


def parse_number(raw: str | None) -> float | None:
    """«~1 840», «1840 ккал», «5,4» — всё это числа."""
    if raw is None:
        return None
    cleaned = re.sub(r"[^\d,.\-]", "", str(raw).replace(" ", "").replace(" ", ""))
    cleaned = cleaned.replace(",", ".")
    if cleaned in ("", "-", ".", "-."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_flags(raw: str | None) -> list[str]:
    if not raw or not raw.strip():
        return []
    parts = re.split(r"[;|/]", raw) if re.search(r"[;|/]", raw) else [raw]
    return [p.strip() for p in parts if p.strip()]


def read_csv(path: Path) -> tuple[list[str], list[list[str]]]:
    if not path.exists():
        return [], []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        rows = [row for row in csv.reader(handle, dialect) if any(cell.strip() for cell in row)]
    if not rows:
        return [], []
    return rows[0], rows[1:]


# ------------------------------------------------------------------- источники


def load_days(folder: Path) -> dict[str, dict]:
    header, rows = read_csv(folder / "Данные питания.csv")
    if not header:
        return {}

    date_index = find_column(header, ("дата",)) or 0
    columns = {key: find_column(header, aliases) for key, aliases in DAY_COLUMNS.items()}
    flags_index = find_column(header, ("флаги", "флаг"))
    note_index = find_column(header, ("заметка", "комментарий", "примечание"))

    days: dict[str, dict] = {}
    for row in rows:
        iso = parse_date(row[date_index] if date_index < len(row) else "")
        if not iso:
            continue

        payload: dict = {"d": iso}
        for key, index in columns.items():
            if index is None or index >= len(row):
                continue
            value = parse_number(row[index])
            if value is not None:
                payload[key] = int(value) if key in ("calories", "steps") else round(value, 1)

        if flags_index is not None and flags_index < len(row):
            payload["flags"] = parse_flags(row[flags_index])
        if note_index is not None and note_index < len(row):
            note = row[note_index].strip()
            if note:
                payload["note"] = note

        days[iso] = payload  # строка на дату есть — побеждает последняя
    return days


def load_dishes(folder: Path) -> dict[str, list[dict]]:
    header, rows = read_csv(folder / "Блюда.csv")
    if not header:
        return {}

    date_index = find_column(header, ("дата",)) or 0
    columns = {key: find_column(header, aliases) for key, aliases in DISH_COLUMNS.items()}

    by_date: dict[str, list[dict]] = {}
    for row in rows:
        iso = parse_date(row[date_index] if date_index < len(row) else "")
        if not iso:
            continue

        def cell(key: str) -> str:
            index = columns[key]
            return row[index].strip() if index is not None and index < len(row) else ""

        meal = MEALS.get(cell("meal").lower())
        dish = cell("dish")
        if not meal or not dish:
            continue

        item = {
            "meal": meal,
            "dish": dish,
            "product": cell("product") or dish,
            "pos": len(by_date.get(iso, [])),
        }
        for key in ("calories", "protein", "fat", "carbs"):
            value = parse_number(cell(key))
            if value is not None:
                item[key] = int(value) if key == "calories" else round(value, 1)

        by_date.setdefault(iso, []).append(item)
    return by_date


def load_health(path: Path, value_aliases: tuple[str, ...], key: str) -> list[dict]:
    header, rows = read_csv(path)
    if not header:
        return []

    date_index = find_column(header, ("дата", "date")) or 0
    value_index = find_column(header, value_aliases)
    if value_index is None:
        value_index = 1 if len(header) > 1 else 0

    latest: dict[str, float] = {}
    for row in rows:
        iso = parse_date(row[date_index] if date_index < len(row) else "")
        value = parse_number(row[value_index] if value_index < len(row) else "")
        if iso and value is not None:
            latest[iso] = value  # дубликаты — норма, побеждает последняя строка

    return [{"d": iso, key: round(value, 1) if key == "kg" else int(value)}
            for iso, value in sorted(latest.items())]


def load_diary(folder: Path) -> dict[str, str]:
    """
    Дневник — свободный markdown, поэтому разбор осторожный: режем по заголовкам,
    в которых есть дата, и всё до следующего такого заголовка считаем записью дня.
    Ничего не распозналось — молча пропускаем, дневник не критичен.
    """
    path = folder / "Дневник питания.md"
    if not path.exists():
        return {}

    text = path.read_text(encoding="utf-8")
    marker = text.find("<!-- НАЧАЛО ЗАПИСЕЙ -->")
    if marker != -1:
        text = text[marker + len("<!-- НАЧАЛО ЗАПИСЕЙ -->"):]

    entries: dict[str, str] = {}
    current: str | None = None
    buffer: list[str] = []

    for line in text.splitlines():
        heading = re.match(r"^#{1,4}\s+(.*)$", line)
        iso = parse_date(heading.group(1).strip()) if heading else None
        if iso:
            if current:
                entries[current] = "\n".join(buffer).strip()
            current, buffer = iso, []
        elif current:
            buffer.append(line)

    if current:
        entries[current] = "\n".join(buffer).strip()
    return {iso: body for iso, body in entries.items() if body}


def load_reports(folder: Path) -> list[dict]:
    reports = []
    for path in sorted((folder / "Отчёты").glob("*.md")) if (folder / "Отчёты").exists() else []:
        iso = parse_date(re.sub(r"^Неделя\s*", "", path.stem).strip())
        if iso:
            reports.append({"week_start": iso, "body": path.read_text(encoding="utf-8").strip()})
    return reports


# ------------------------------------------------------------------- запись


CERT_HELP = """
Python не смог проверить сертификат Supabase.

Это не проблема с ключом или сетью: сборка Python с python.org идёт со своей
связкой корневых сертификатов и не читает системную связку ключей macOS.
Пока связку не установили, любой https-запрос падает.

Лечится один раз, любым способом:

  1) Открыть Finder → Программы → папку «Python 3.x» и запустить
     «Install Certificates.command». Или из Терминала:
       open "/Applications/Python 3.9/Install Certificates.command"

  2) Либо поставить связку вручную:
       python3 -m pip install --upgrade certifi

После этого запусти импорт заново — записать он ничего не успел.
""".strip()


def ssl_context() -> "ssl.SSLContext":
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
    def __init__(self, url: str, key: str, dry_run: bool):
        self.url = url.rstrip("/")
        self.key = key
        self.dry_run = dry_run
        self.context = None if dry_run else ssl_context()

    def call(self, path: str, payload: dict, method: str = "POST", prefer: str = "") -> object:
        if self.dry_run:
            return None
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
            with urllib.request.urlopen(request, timeout=45, context=self.context) as response:
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Перенос дневника питания из CSV в Supabase")
    parser.add_argument("folder", help="Папка «Питание» с CSV-файлами")
    parser.add_argument("--repetitsiya", action="store_true",
                        help="Разобрать файлы и показать итог, ничего не записывая")
    parser.add_argument("--bez-dnevnika", action="store_true",
                        help="Не переносить тексты из «Дневник питания.md»")
    args = parser.parse_args()

    folder = Path(os.path.expanduser(args.folder))
    if not folder.is_dir():
        print(f"Папки нет: {folder}", file=sys.stderr)
        return 1

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not args.repetitsiya and not (url and key):
        print("Задай SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    days = load_days(folder)
    dishes = load_dishes(folder)
    weights = load_health(folder / "Вес.csv", ("вес", "кг", "weight"), "kg")
    steps = load_health(folder / "Шаги.csv", ("шаги", "steps"), "steps")
    diary = {} if args.bez_dnevnika else load_diary(folder)
    reports = load_reports(folder)

    rules_path = folder / "Система питания.md"
    rules = rules_path.read_text(encoding="utf-8").strip() if rules_path.exists() else None

    print(f"Дней:      {len(days)}")
    print(f"Блюд:      {sum(len(v) for v in dishes.values())} за {len(dishes)} дн.")
    print(f"Вес:       {len(weights)} записей")
    print(f"Шаги:      {len(steps)} записей")
    print(f"Дневник:   {len(diary)} записей" + ("" if diary or args.bez_dnevnika
                                                else "  (ни одной — проверь формат заголовков)"))
    print(f"Разборы:   {len(reports)}")
    print(f"Правила:   {'есть' if rules else 'нет'}")

    if args.repetitsiya:
        sample = sorted(days)[:3]
        if sample:
            print("\nПример разобранных дней:")
            for iso in sample:
                print(" ", json.dumps(days[iso], ensure_ascii=False))
        print("\nРепетиция: в базу ничего не записано.")
        return 0

    api = Supabase(url, key, dry_run=False)

    for iso in sorted(days):
        payload = dict(days[iso])
        if iso in diary:
            payload["diary"] = diary[iso]
        api.rpc("upsert_day", {"p": payload})

    # Дни, которые есть только в дневнике, тоже нужны — иначе запись потеряется.
    for iso in sorted(set(diary) - set(days)):
        api.rpc("upsert_day", {"p": {"d": iso, "diary": diary[iso]}})

    for iso in sorted(dishes):
        api.rpc("replace_dishes", {"p_date": iso, "p_dishes": dishes[iso]})

    if weights:
        api.rpc("log_weight", {"p": weights})
    if steps:
        api.rpc("log_steps", {"p": steps})

    for report in reports:
        api.call("weekly_reports?on_conflict=week_start", report,
                 prefer="resolution=merge-duplicates")

    if rules:
        api.call("settings?id=eq.1", {"rules": rules}, method="PATCH")

    print("\nГотово. Открой админку и проверь последние дни.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
