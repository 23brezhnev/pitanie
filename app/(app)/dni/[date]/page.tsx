import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';

import { Card, Flags, NutrientMeter, StatTile } from '@/components/ui';
import { getDay, getDishes, getNeighbourDates, getSettings } from '@/lib/data';
import { fmt, longDate, weekday } from '@/lib/format';
import { MEALS, type Meal } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!ISO_DATE.test(date)) notFound();

  const [day, dishes, settings, neighbours] = await Promise.all([
    getDay(date),
    getDishes(date),
    getSettings(),
    getNeighbourDates(date),
  ]);

  if (!day) notFound();

  const byMeal = MEALS.map((meal) => ({
    meal,
    items: dishes.filter((dish) => dish.meal === meal),
  })).filter((group) => group.items.length > 0);

  const dishCalories = dishes.reduce((sum, dish) => sum + (dish.calories ?? 0), 0);
  const drift = day.calories !== null && dishes.length > 0 ? day.calories - dishCalories : null;

  // Небольшое расхождение итога дня и суммы по блюдам — норма, крупное стоит перепроверить.
  const driftText =
    dishes.length === 0
      ? undefined
      : drift === null
        ? `По блюдам — ${fmt(dishCalories)} ккал`
        : Math.abs(drift) <= 50
          ? `По блюдам — ${fmt(dishCalories)} ккал, это сходится с итогом дня`
          : `По блюдам — ${fmt(dishCalories)} ккал, итог дня ${drift > 0 ? 'выше' : 'ниже'} на ${fmt(Math.abs(drift))}${Math.abs(drift) > 200 ? '. Стоит перепроверить запись' : ''}`;

  const mealColor: Record<Meal, string> = {
    Завтрак: 'var(--series-1)',
    Обед: 'var(--series-2)',
    Перекус: 'var(--series-3)',
    Ужин: 'var(--series-4)',
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{longDate(day.d)}</h1>
          <p>{weekday(day.d)}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {neighbours.prev && (
            <Link href={`/dni/${neighbours.prev}`} className="chip">
              ← предыдущий
            </Link>
          )}
          {neighbours.next && (
            <Link href={`/dni/${neighbours.next}`} className="chip">
              следующий →
            </Link>
          )}
          <Link href="/dni" className="chip">
            Все дни
          </Link>
        </div>
      </div>

      <div className="stack">
        <div className="grid grid-tiles">
          <StatTile
            label="Калории"
            value={day.calories}
            unit="ккал"
            delta={{ value: day.calories_delta, suffix: 'к норме', goodWhen: 'lower' }}
            foot={day.in_corridor ? <span className="delta-good">в коридоре</span> : null}
          />
          <StatTile label="Вес" value={day.weight} unit="кг" digits={1}
            foot={day.weight !== null && !day.weight_manual ? <span>из Здоровья</span> : null} />
          <StatTile
            label="Шаги"
            value={day.steps}
            delta={{
              value: day.steps !== null && day.steps_target !== null ? day.steps - day.steps_target : null,
              suffix: 'к цели',
              goodWhen: 'higher',
            }}
          />
          <StatTile label="Блюд записано" value={dishes.length || null} />
        </div>

        {day.flags.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Flags flags={day.flags} />
          </div>
        )}

        <div className="grid grid-2">
          <Card title="Нутриенты" subtitle="Факт против нормы">
            <div className="stack" style={{ gap: 12 }}>
              <NutrientMeter label="Белок" value={day.protein} target={settings?.protein_target ?? null} unit="г" digits={1} mode="floor" />
              <NutrientMeter label="Жиры" value={day.fat} target={settings?.fat_target ?? null} unit="г" digits={1} />
              <NutrientMeter label="Углеводы" value={day.carbs} target={settings?.carbs_target ?? null} unit="г" digits={1} />
              <NutrientMeter label="Клетчатка" value={day.fiber} target={settings?.fiber_target ?? null} unit="г" digits={1} mode="floor" />
              <NutrientMeter label="Добавленный сахар" value={day.sugar} target={settings?.sugar_max ?? null} unit="г" digits={1} />
              <NutrientMeter label="Соль" value={day.salt} target={settings?.salt_max ?? null} unit="г" digits={1} />
              <NutrientMeter label="Насыщенные жиры" value={day.sat_fat} target={settings?.sat_fat_max ?? null} unit="г" digits={1} />
            </div>
          </Card>

          <Card title="Что ел" subtitle={driftText}>
            {byMeal.length === 0 ? (
              <p className="empty">Блюда за этот день не записаны</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Блюдо</th>
                      <th>Ккал</th>
                      <th>Б</th>
                      <th>Ж</th>
                      <th>У</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMeal.map((group) => (
                      <Fragment key={group.meal}>
                        <tr>
                          <td colSpan={4} style={{ paddingTop: 16, borderBottom: 0 }}>
                            <span className="meal-name">
                              <span className="dot" style={{ background: mealColor[group.meal] }} />
                              {group.meal}
                            </span>
                          </td>
                          <td className="muted" style={{ paddingTop: 16, borderBottom: 0, fontSize: 13 }}>
                            {fmt(group.items.reduce((sum, dish) => sum + (dish.calories ?? 0), 0))} ккал
                          </td>
                        </tr>
                        {group.items.map((dish) => (
                          <tr key={dish.id}>
                            <td style={{ whiteSpace: 'normal', minWidth: 180 }}>
                              {dish.dish}
                              {dish.product !== dish.dish && (
                                <span className="muted" style={{ fontSize: 12, display: 'block' }}>
                                  {dish.product}
                                </span>
                              )}
                            </td>
                            <td>{fmt(dish.calories)}</td>
                            <td>{fmt(dish.protein, 1)}</td>
                            <td>{fmt(dish.fat, 1)}</td>
                            <td>{fmt(dish.carbs, 1)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {(day.diary || day.note) && (
          <Card title="Запись дня">
            {day.note && <p style={{ marginTop: 0 }}>{day.note}</p>}
            {day.diary && <div className="prose">{day.diary}</div>}
          </Card>
        )}
      </div>
    </>
  );
}
