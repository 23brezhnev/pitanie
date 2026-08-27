import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { Card } from '@/components/ui';
import { getSettings, getWeeklyReports, getWeeks } from '@/lib/data';
import { fmt, longDate, shiftDays, signed } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function WeeksPage() {
  const [weeks, settings, reports] = await Promise.all([
    getWeeks(26),
    getSettings(),
    getWeeklyReports(8),
  ]);

  const chronological = [...weeks].reverse();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Недели</h1>
          <p>Неделя считается с понедельника. Изменение веса — среднее недели против предыдущей.</p>
        </div>
      </div>

      <div className="stack">
        <Card title="Средний вес по неделям" subtitle="Сглаживает шум ежедневных взвешиваний">
          <TimeSeriesChart
            data={chronological.map((w) => ({ d: w.week_start, weight: w.avg_weight }))}
            series={[
              { key: 'weight', label: 'Средний вес', color: 'var(--series-1)', type: 'line', digits: 1 },
            ]}
            reference={
              settings?.weight_goal !== null && settings?.weight_goal !== undefined
                ? { value: settings.weight_goal, label: 'Цель' }
                : undefined
            }
            unit="кг"
            zeroBased={false}
            emptyText="Недель с данными пока нет"
          />
        </Card>

        <Card title="Сводка">
          {weeks.length === 0 ? (
            <p className="empty">Пока пусто</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Неделя</th>
                    <th>Дней</th>
                    <th>Ккал</th>
                    <th>Белок</th>
                    <th>Жиры</th>
                    <th>Углев.</th>
                    <th>Клетч.</th>
                    <th>Шаги</th>
                    <th>Вес</th>
                    <th>Δ веса</th>
                    <th>В коридоре</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    <tr key={week.week_start}>
                      <td>
                        {longDate(week.week_start)}
                        <span className="muted"> — {longDate(shiftDays(week.week_start, 6))}</span>
                      </td>
                      <td>{week.days_logged}</td>
                      <td>{fmt(week.avg_calories)}</td>
                      <td>{fmt(week.avg_protein, 1)}</td>
                      <td>{fmt(week.avg_fat, 1)}</td>
                      <td>{fmt(week.avg_carbs, 1)}</td>
                      <td>{fmt(week.avg_fiber, 1)}</td>
                      <td>{fmt(week.avg_steps)}</td>
                      <td>{fmt(week.avg_weight, 1)}</td>
                      <td
                        className={
                          week.weight_change === null
                            ? ''
                            : week.weight_change < 0
                              ? 'delta-good'
                              : week.weight_change > 0
                                ? 'delta-bad'
                                : ''
                        }
                      >
                        {signed(week.weight_change, 1)}
                      </td>
                      <td>
                        {week.days_in_corridor} / {week.days_logged}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {reports.length > 0 && (
          <Card title="Разборы" subtitle="Тексты, которые Claude сохранил по итогам недели">
            <div className="stack">
              {reports.map((report) => (
                <div key={report.week_start}>
                  <h3 style={{ marginBottom: 6 }}>Неделя с {longDate(report.week_start)}</h3>
                  <div className="prose">{report.body}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
