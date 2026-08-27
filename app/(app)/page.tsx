import Link from 'next/link';

import { ProductBars } from '@/components/charts/ProductBars';
import { StackedColumns } from '@/components/charts/StackedColumns';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { Card, Flags, PeriodPicker, StatTile } from '@/components/ui';
import { getDays, getSettings, getTopProducts, parsePeriod, periodRange } from '@/lib/data';
import { days as daysWord, fmt, longDate, shortDate, todayMsk } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const period = parsePeriod((await searchParams).period, 30);
  const { from, to } = periodRange(period);

  const [settings, days, topProducts] = await Promise.all([
    getSettings(),
    getDays(from, to),
    getTopProducts(from, to, 8),
  ]);

  if (!settings) {
    return (
      <p className="empty">
        В таблице настроек нет строки с нормами. Заполни её на странице «Нормы».
      </p>
    );
  }

  const withCalories = days.filter((d) => d.calories !== null);
  const latest = days.at(-1) ?? null;
  const lastWeighed = [...days].reverse().find((d) => d.weight !== null) ?? null;

  const inCorridor = days.filter((d) => d.in_corridor).length;
  const avgCalories = withCalories.length
    ? withCalories.reduce((sum, d) => sum + (d.calories ?? 0), 0) / withCalories.length
    : null;

  const withSteps = days.filter((d) => d.steps !== null);
  const avgSteps = withSteps.length
    ? withSteps.reduce((sum, d) => sum + (d.steps ?? 0), 0) / withSteps.length
    : null;

  const weight = lastWeighed?.weight ?? null;
  const toGoal = weight !== null && settings.weight_goal !== null ? weight - settings.weight_goal : null;
  const fromStart =
    weight !== null && settings.weight_start !== null ? weight - settings.weight_start : null;

  const isToday = latest?.d === todayMsk();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Обзор</h1>
          <p>
            {latest
              ? `Последняя запись — ${longDate(latest.d)}${isToday ? ' (сегодня)' : ''}`
              : 'Записей пока нет'}
          </p>
        </div>
        <PeriodPicker path="/" current={period} />
      </div>

      <div className="stack">
        <div className="grid grid-tiles">
          <div className="card">
            <div className="tile-label">Вес сейчас</div>
            <div className="hero" style={{ marginTop: 8 }}>
              {fmt(weight, 1)}
              <span className="tile-unit" style={{ fontSize: 18 }}>
                кг
              </span>
            </div>
            <div className="tile-foot">
              {toGoal !== null && (
                <span>
                  до цели {fmt(settings.weight_goal, 0)} кг — {fmt(Math.max(toGoal, 0), 1)} кг
                </span>
              )}
            </div>
            {fromStart !== null && (
              <div className="tile-foot" style={{ marginTop: 0 }}>
                <span className={fromStart < 0 ? 'delta-good' : 'delta-bad'}>
                  {fromStart > 0 ? '+' : fromStart < 0 ? '−' : ''}
                  {fmt(Math.abs(fromStart), 1)} кг от старта
                </span>
              </div>
            )}
          </div>

          <StatTile
            label={isToday ? 'Калории сегодня' : 'Калории в последний день'}
            value={latest?.calories ?? null}
            unit="ккал"
            delta={{
              value: latest?.calories_delta ?? null,
              suffix: 'к норме',
              goodWhen: 'lower',
            }}
          />

          <StatTile
            label={`Калории в среднем за ${daysWord(period)}`}
            value={avgCalories}
            unit="ккал"
            delta={{
              value: avgCalories === null ? null : Math.round(avgCalories - settings.calories_target),
              suffix: 'к норме',
              goodWhen: 'lower',
            }}
          />

          <StatTile
            label="Дней в коридоре"
            value={inCorridor}
            foot={
              <span>
                из {daysWord(withCalories.length)} с записью
              </span>
            }
          />

          <StatTile
            label="Шаги в среднем"
            value={avgSteps === null ? null : Math.round(avgSteps)}
            delta={{
              value: avgSteps === null ? null : Math.round(avgSteps - settings.steps_target),
              suffix: 'к цели',
              goodWhen: 'higher',
            }}
          />
        </div>

        <Card
          title="Калории по дням"
          subtitle={`Норма ${fmt(settings.calories_target)} ккал, коридор ±${fmt(settings.calories_tolerance)}`}
        >
          <TimeSeriesChart
            data={days.map((d) => ({ d: d.d, calories: d.calories, ma7: d.calories_ma7 }))}
            series={[
              { key: 'calories', label: 'За день', color: 'var(--series-1)', type: 'column' },
              { key: 'ma7', label: 'Среднее за 7 дней', color: 'var(--series-2)', type: 'line' },
            ]}
            band={{
              lo: settings.calories_target - settings.calories_tolerance,
              hi: settings.calories_target + settings.calories_tolerance,
              label: 'Коридор нормы',
            }}
            unit="ккал"
            height={240}
          />
        </Card>

        <div className="grid grid-2">
          <Card title="Вес" subtitle="Точки взвешиваний и сглаженный тренд">
            <TimeSeriesChart
              data={days.map((d) => ({ d: d.d, weight: d.weight, ma7: d.weight_ma7 }))}
              series={[
                { key: 'weight', label: 'Взвешивание', color: 'var(--series-1)', type: 'line', digits: 1 },
                { key: 'ma7', label: 'Среднее за 7 дней', color: 'var(--series-2)', type: 'line', digits: 1 },
              ]}
              reference={
                settings.weight_goal !== null
                  ? { value: settings.weight_goal, label: 'Цель' }
                  : undefined
              }
              unit="кг"
              zeroBased={false}
            />
          </Card>

          <Card title="Шаги" subtitle={`Цель — ${fmt(settings.steps_target)} шагов в день`}>
            <TimeSeriesChart
              data={days.map((d) => ({ d: d.d, steps: d.steps }))}
              series={[{ key: 'steps', label: 'Шаги', color: 'var(--series-1)', type: 'column' }]}
              reference={{ value: settings.steps_target, label: 'Цель' }}
            />
          </Card>
        </div>

        <Card title="Белки, жиры, углеводы" subtitle="Граммы за день">
          <StackedColumns
            data={days.map((d) => ({ d: d.d, protein: d.protein, fat: d.fat, carbs: d.carbs }))}
            series={[
              { key: 'protein', label: 'Белок', color: 'var(--series-1)' },
              { key: 'fat', label: 'Жиры', color: 'var(--series-2)' },
              { key: 'carbs', label: 'Углеводы', color: 'var(--series-3)' },
            ]}
            unit="г"
            digits={1}
          />
        </Card>

        <div className="grid grid-2">
          <Card
            title="Что даёт больше всего калорий"
            subtitle={`За ${daysWord(period)}`}
            action={
              <Link href={`/produkty?period=${period}`} className="chip">
                Все продукты
              </Link>
            }
          >
            <ProductBars items={topProducts} />
          </Card>

          <Card
            title="Последние дни"
            action={
              <Link href="/dni" className="chip">
                Все дни
              </Link>
            }
          >
            {days.length === 0 ? (
              <p className="empty">За этот период записей нет</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Ккал</th>
                      <th>Вес</th>
                      <th>Шаги</th>
                      <th>Флаги</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...days]
                      .reverse()
                      .slice(0, 8)
                      .map((day) => (
                        <tr key={day.d}>
                          <td>
                            <Link href={`/dni/${day.d}`}>{shortDate(day.d)}</Link>
                          </td>
                          <td>{fmt(day.calories)}</td>
                          <td>{fmt(day.weight, 1)}</td>
                          <td>{fmt(day.steps)}</td>
                          <td style={{ textAlign: 'left' }}>
                            <Flags flags={day.flags} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
