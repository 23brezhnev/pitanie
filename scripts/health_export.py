#!/usr/bin/env python3
"""
Разбор выгрузки Apple Health.

Health → аватарка → Export All Health Data → export.zip. Скармливать можно
сам zip, распаковывать не обязательно.

    # что вообще лежит в выгрузке
    python3 scripts/health_export.py ~/Downloads/export.zip

    # заливка веса и шагов
    export SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    python3 scripts/health_export.py ~/Downloads/export.zip --zalit

Файл на сотни мегабайт — читаем потоком, целиком в память не поднимаем.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_klient import Supabase  # noqa: E402

STEPS = "HKQuantityTypeIdentifierStepCount"
WEIGHT = "HKQuantityTypeIdentifierBodyMass"

# Что стоит показать по-русски в обзоре. Остальное печатается как есть.
ZNAKOMYE = {
    STEPS: "Шаги",
    WEIGHT: "Масса тела",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "Активная энергия",
    "HKQuantityTypeIdentifierBasalEnergyBurned": "Энергия покоя",
    "HKQuantityTypeIdentifierDistanceWalkingRunning": "Дистанция",
    "HKQuantityTypeIdentifierBodyMassIndex": "Индекс массы тела",
    "HKQuantityTypeIdentifierBodyFatPercentage": "Процент жира",
    "HKQuantityTypeIdentifierLeanBodyMass": "Тощая масса",
    "HKQuantityTypeIdentifierHeartRate": "Пульс",
    "HKQuantityTypeIdentifierRestingHeartRate": "Пульс покоя",
    "HKQuantityTypeIdentifierDietaryEnergyConsumed": "Съеденные калории",
    "HKQuantityTypeIdentifierDietaryProtein": "Белок",
    "HKQuantityTypeIdentifierDietaryFatTotal": "Жиры",
    "HKQuantityTypeIdentifierDietaryCarbohydrates": "Углеводы",
    "HKQuantityTypeIdentifierDietaryFiber": "Клетчатка",
    "HKQuantityTypeIdentifierDietarySugar": "Сахар",
    "HKQuantityTypeIdentifierDietarySodium": "Натрий",
    "HKQuantityTypeIdentifierDietaryWater": "Вода",
    "HKCategoryTypeIdentifierSleepAnalysis": "Сон",
    "HKQuantityTypeIdentifierAppleExerciseTime": "Минуты тренировок",
    "HKQuantityTypeIdentifierAppleStandTime": "Время стоя",
    "HKQuantityTypeIdentifierVO2Max": "МПК",
}


def otkryt(path: Path):
    """Отдаёт поток с export.xml. Принимает zip, папку выгрузки или сам xml."""
    if path.is_dir():
        for candidate in (path / "export.xml", path / "apple_health_export" / "export.xml"):
            if candidate.exists():
                return candidate.open("rb")
        raise SystemExit(f"В папке {path} нет export.xml")

    if path.suffix.lower() == ".zip":
        archive = zipfile.ZipFile(path)
        names = [n for n in archive.namelist() if n.endswith("export.xml")]
        if not names:
            raise SystemExit("В архиве нет export.xml — это точно выгрузка Health?")
        # Иногда рядом лежит export_cda.xml, он нам не нужен.
        names.sort(key=len)
        return archive.open(names[0])

    return path.open("rb")


def mestnaya_data(raw: str) -> str | None:
    """
    «2026-08-27 08:12:03 +0300» → «2026-08-27».

    В строке уже местное время, поэтому дату берём как записано: смещение
    нужно только чтобы strptime не спотыкался.
    """
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S %z").date().isoformat()
    except ValueError:
        match = re.match(r"(\d{4}-\d{2}-\d{2})", raw)
        return match.group(1) if match else None


def chislo(raw: str | None) -> float | None:
    try:
        return float(raw) if raw not in (None, "") else None
    except ValueError:
        return None


def prochitat(path: Path, s: str | None, po: str | None):
    """
    Один проход по файлу. Возвращает обзор по типам и подготовленные вес с шагами.

    Шаги суммируем отдельно по каждому источнику, а потом за день берём
    наибольшую сумму. Айфон и часы пишут одни и те же шаги параллельно, и
    простое суммирование задваивает их почти вдвое.
    """
    obzor: dict[str, dict] = defaultdict(
        lambda: {"count": 0, "min": None, "max": None, "istochniki": set(), "unit": None}
    )
    shagi: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    ves: dict[str, tuple[str, float]] = {}
    trenirovok = 0
    svodok = 0

    with otkryt(path) as stream:
        for event, element in ElementTree.iterparse(stream, events=("end",)):
            tag = element.tag

            if tag == "Workout":
                trenirovok += 1
            elif tag == "ActivitySummary":
                svodok += 1
            elif tag == "Record":
                kind = element.get("type") or "?"
                den = mestnaya_data(element.get("startDate") or "")
                istochnik = element.get("sourceName") or "?"

                info = obzor[kind]
                info["count"] += 1
                info["unit"] = info["unit"] or element.get("unit")
                if len(info["istochniki"]) < 8:
                    info["istochniki"].add(istochnik)
                if den:
                    info["min"] = den if info["min"] is None else min(info["min"], den)
                    info["max"] = den if info["max"] is None else max(info["max"], den)

                if den and (s is None or den >= s) and (po is None or den <= po):
                    value = chislo(element.get("value"))
                    if value is not None:
                        if kind == STEPS:
                            shagi[den][istochnik] += value
                        elif kind == WEIGHT:
                            nachalo = element.get("startDate") or ""
                            if den not in ves or nachalo > ves[den][0]:
                                ves[den] = (nachalo, value)

            element.clear()

    return obzor, shagi, ves, trenirovok, svodok


def svesti_shagi(shagi: dict[str, dict[str, float]]) -> dict[str, int]:
    return {den: int(round(max(po_istochnikam.values()))) for den, po_istochnikam in shagi.items()
            if po_istochnikam}


def main() -> int:
    parser = argparse.ArgumentParser(description="Разбор выгрузки Apple Health")
    parser.add_argument("path", help="export.zip, папка выгрузки или export.xml")
    parser.add_argument("--zalit", action="store_true", help="Записать вес и шаги в базу")
    parser.add_argument("--s", help="Начало периода, ГГГГ-ММ-ДД")
    parser.add_argument("--po", help="Конец периода, ГГГГ-ММ-ДД")
    args = parser.parse_args()

    path = Path(os.path.expanduser(args.path))
    if not path.exists():
        print(f"Не нашёл: {path}", file=sys.stderr)
        return 1

    print("Читаю выгрузку, это может занять минуту…\n")
    obzor, shagi_syrye, ves, trenirovok, svodok = prochitat(path, args.s, args.po)

    shagi = svesti_shagi(shagi_syrye)

    # ------------------------------------------------------------------ обзор
    print(f"{'Что':<26} {'Записей':>9}  {'Ед.':<10} {'Период':<25} Источники")
    print("-" * 100)
    for kind, info in sorted(obzor.items(), key=lambda kv: -kv[1]["count"]):
        nazvanie = ZNAKOMYE.get(kind, kind.replace("HKQuantityTypeIdentifier", "")
                                          .replace("HKCategoryTypeIdentifier", ""))
        period = f"{info['min']} — {info['max']}" if info["min"] else "—"
        istochniki = ", ".join(sorted(info["istochniki"]))
        edinica = info["unit"] or ""
        print(f"{nazvanie[:25]:<26} {info['count']:>9}  {edinica[:9]:<10} {period:<25} {istochniki}")

    print()
    if trenirovok:
        print(f"Тренировок: {trenirovok}")
    if svodok:
        print(f"Сводок активности: {svodok}")

    # --------------------------------------------------------------- к заливке
    print(f"\nК заливке за выбранный период:")
    print(f"  шаги — {len(shagi)} дн." + (f", {min(shagi)} — {max(shagi)}" if shagi else ""))
    print(f"  вес  — {len(ves)} дн." + (f", {min(ves)} — {max(ves)}" if ves else ""))

    zadvoenie = [d for d, po_ist in shagi_syrye.items() if len(po_ist) > 1]
    if zadvoenie:
        print(f"\n  Шаги пишут несколько источников ({len(zadvoenie)} дн.).")
        print("  За день беру наибольшую сумму по одному источнику, а не сумму всех:")
        print("  айфон и часы считают одни и те же шаги, сложение их задваивает.")

    if shagi:
        primer = sorted(shagi)[-5:]
        print("\n  Последние дни по шагам:")
        for den in primer:
            po_ist = ", ".join(f"{k}: {int(v)}" for k, v in sorted(shagi_syrye[den].items()))
            print(f"    {den}  {shagi[den]:>6}   ({po_ist})")

    if ves:
        print("\n  Последние взвешивания:")
        for den in sorted(ves)[-5:]:
            print(f"    {den}  {ves[den][1]:.1f} кг")

    if not args.zalit:
        print("\nНичего не записано. Для заливки добавь --zalit")
        return 0

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not (url and key):
        print("\nЗадай SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    api = Supabase(url, key)

    # Пачками, чтобы не упереться в размер запроса на длинной истории.
    def pachkami(items: list, razmer: int = 400):
        for i in range(0, len(items), razmer):
            yield items[i:i + razmer]

    if ves:
        for pachka in pachkami([{"d": d, "kg": round(v, 1), "source": "health-export"}
                                for d, (_, v) in sorted(ves.items())]):
            api.rpc("log_weight", {"p": pachka})

    if shagi:
        for pachka in pachkami([{"d": d, "steps": v, "source": "health-export"}
                                for d, v in sorted(shagi.items())]):
            api.rpc("log_steps", {"p": pachka})

    print("\nГотово. Значения вне диапазона (вес 50–250 кг, шаги 100–60000) база отсеяла молча.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
