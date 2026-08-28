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
ACTIVE = "HKQuantityTypeIdentifierActiveEnergyBurned"
BASAL = "HKQuantityTypeIdentifierBasalEnergyBurned"
FAT = "HKQuantityTypeIdentifierBodyFatPercentage"
LEAN = "HKQuantityTypeIdentifierLeanBodyMass"

# Суммируем по источникам и берём наибольшую сумму, а не сложение всех.
# Шаги и энергию пишут параллельно айфон, часы и сторонние приложения —
# Yazio, Zepp, Fitsession. Сложить их значит завысить день в разы.
# Питание из Yazio: два года до перехода на Claude. Записи поштучные,
# по приёмам пищи, поэтому за день суммируются.
EDA = {
    "calories": "HKQuantityTypeIdentifierDietaryEnergyConsumed",
    "protein": "HKQuantityTypeIdentifierDietaryProtein",
    "fat": "HKQuantityTypeIdentifierDietaryFatTotal",
    "carbs": "HKQuantityTypeIdentifierDietaryCarbohydrates",
    "fiber": "HKQuantityTypeIdentifierDietaryFiber",
    "sugar": "HKQuantityTypeIdentifierDietarySugar",
    "sat_fat": "HKQuantityTypeIdentifierDietaryFatSaturated",
    "sodium": "HKQuantityTypeIdentifierDietarySodium",
}

PO_ISTOCHNIKAM = (STEPS, ACTIVE, BASAL) + tuple(EDA.values())

# Из нескольких замеров за день берём поздний.
POZDNIY = (WEIGHT, FAT, LEAN)

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
    summy: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(float))
    )
    pozdnie: dict[str, dict[str, tuple[str, float]]] = defaultdict(dict)
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
                        if kind in PO_ISTOCHNIKAM:
                            summy[kind][den][istochnik] += value
                        elif kind in POZDNIY:
                            nachalo = element.get("startDate") or ""
                            prezhnee = pozdnie[kind].get(den)
                            if prezhnee is None or nachalo > prezhnee[0]:
                                pozdnie[kind][den] = (nachalo, value)

            element.clear()

    return obzor, summy, pozdnie, trenirovok, svodok


def svesti(po_dnyam: dict[str, dict[str, float]]) -> dict[str, float]:
    """Наибольшая сумма по одному источнику за день."""
    return {den: max(po_ist.values()) for den, po_ist in po_dnyam.items() if po_ist}


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
    obzor, summy, pozdnie, trenirovok, svodok = prochitat(path, args.s, args.po)

    shagi = {d: int(round(v)) for d, v in svesti(summy[STEPS]).items()}
    eda_po_polyam = {pole: svesti(summy[kind]) for pole, kind in EDA.items()}
    aktivnaya = svesti(summy[ACTIVE])
    pokoya = svesti(summy[BASAL])
    ves = {d: v for d, (_, v) in pozdnie[WEIGHT].items()}
    zhir = {d: v for d, (_, v) in pozdnie[FAT].items()}
    toshchaya = {d: v for d, (_, v) in pozdnie[LEAN].items()}

    # Процент жира Health хранит долей: 0.312 — это 31,2%.
    zhir = {d: (v * 100 if v <= 1 else v) for d, v in zhir.items()}

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
    def stroka(nazvanie: str, dannye: dict) -> str:
        if not dannye:
            return f"  {nazvanie:<16} —"
        return f"  {nazvanie:<16} {len(dannye)} дн., {min(dannye)} — {max(dannye)}"

    energiya = {d: {"active": aktivnaya.get(d), "basal": pokoya.get(d)}
                for d in set(aktivnaya) | set(pokoya)}
    oba_polovinki = {d for d, v in energiya.items()
                     if v["active"] is not None and v["basal"] is not None}
    telo = {d: {"fat_percent": zhir.get(d), "lean_mass": toshchaya.get(d)}
            for d in set(zhir) | set(toshchaya)}

    print("\nК заливке за выбранный период:")
    print(stroka("шаги", shagi))
    print(stroka("вес", ves))
    print(stroka("расход", energiya))
    print(f"  {'из них полных':<16} {len(oba_polovinki)} дн. — есть и покой, и активность")
    # Натрий в миллиграммах, соль в граммах. 6 г соли ≈ 2400 мг натрия —
    # коэффициент из «Система питания.md».
    eda: dict[str, dict] = {}
    for den in eda_po_polyam["calories"]:
        zapis = {pole: eda_po_polyam[pole].get(den) for pole in
                 ("calories", "protein", "fat", "carbs", "fiber", "sugar", "sat_fat")}
        natriy = eda_po_polyam["sodium"].get(den)
        zapis["salt"] = round(natriy * 2.5 / 1000, 1) if natriy is not None else None
        eda[den] = zapis

    print(stroka("состав тела", telo))
    print(stroka("питание", eda))
    if eda:
        nepolnye = sum(1 for v in eda.values() if (v["calories"] or 0) < 1200)
        print(f"  {'из них скудных':<16} {nepolnye} дн. — меньше 1200 ккал, похоже на брошенные")

    zadvoenie = [d for d, po_ist in summy[STEPS].items() if len(po_ist) > 1]
    if zadvoenie:
        print(f"\n  Шаги пишут несколько источников ({len(zadvoenie)} дн.).")
        print("  За день беру наибольшую сумму по одному источнику, а не сумму всех:")
        print("  айфон, часы и сторонние приложения считают одно и то же.")

    if shagi:
        print("\n  Последние дни по шагам:")
        for den in sorted(shagi)[-5:]:
            po_ist = ", ".join(f"{k}: {int(v)}" for k, v in sorted(summy[STEPS][den].items()))
            rashod = energiya.get(den, {})
            hvost = ""
            if rashod.get("active") is not None and rashod.get("basal") is not None:
                hvost = f"   расход {int(rashod['basal'] + rashod['active'])} ккал"
            print(f"    {den}  {shagi[den]:>6}{hvost}   ({po_ist})")

    if ves:
        print("\n  Последние взвешивания:")
        for den in sorted(ves)[-5:]:
            dop = []
            if den in zhir:
                dop.append(f"жир {zhir[den]:.1f}%")
            if den in toshchaya:
                dop.append(f"тощая {toshchaya[den]:.1f} кг")
            print(f"    {den}  {ves[den]:.1f} кг" + (f"   ({', '.join(dop)})" if dop else ""))

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

    def zalit(nazvanie: str, funkciya: str, items: list) -> None:
        if not items:
            return
        for pachka in pachkami(items):
            api.rpc(funkciya, {"p": pachka})
        print(f"  {nazvanie}: {len(items)} дн.")

    print("\nЗаливаю:")
    zalit("вес", "log_weight",
          [{"d": d, "kg": round(v, 1), "source": "health-export"} for d, v in sorted(ves.items())])
    zalit("шаги", "log_steps",
          [{"d": d, "steps": v, "source": "health-export"} for d, v in sorted(shagi.items())])
    zalit("расход", "log_energy",
          [{"d": d, "active": round(v["active"], 1) if v["active"] is not None else None,
            "basal": round(v["basal"], 1) if v["basal"] is not None else None,
            "source": "health-export"}
           for d, v in sorted(energiya.items())])
    zalit("питание", "log_food_day",
          [{"d": d, "source": "yazio",
            **{k: (round(v, 1) if isinstance(v, float) else v)
               for k, v in sorted(zapis.items()) if v is not None},
            "calories": int(round(zapis["calories"])) if zapis["calories"] is not None else None}
           for d, zapis in sorted(eda.items())])
    zalit("состав тела", "log_body",
          [{"d": d, "fat_percent": round(v["fat_percent"], 1) if v["fat_percent"] is not None else None,
            "lean_mass": round(v["lean_mass"], 1) if v["lean_mass"] is not None else None,
            "source": "health-export"}
           for d, v in sorted(telo.items())])

    print("\nГотово. Значения вне диапазона база отсеяла молча.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
