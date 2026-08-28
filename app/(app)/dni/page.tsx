import Link from 'next/link';

import { Card, Flags } from '@/components/ui';
import { getAllDays, getSettings } from '@/lib/data';
import { days as daysWord, fmt, longDate, signed, weekday } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DaysPage() {
  const [days, settings] = await Promise.all([getAllDays(), getSettings()]);

  const logged = days.filter((d) => d.calories !== null);
  const inCorridor = days.filter((d) => d.in_corridor).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Дни</h1>
          <p>
            {days.length === 0
              ? 'Записей пока нет'
              : `${daysWord(days.length)} в базе, из них ${inCorridor} в коридоре нормы`}
          </p>
        </div>
      </div>

      <Card>
        {days.length === 0 ? (
          <p className="empty">
            Пока пусто. Данные появятся, когда Claude запишет первый день.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Съедено</th>
                  <th>К норме</th>
                  <th>Потрачено</th>
                  <th>Баланс</th>
                  <th>Белок</th>
                  <th>Жиры</th>
                  <th>Углев.</th>
                  <th>Клетч.</th>
                  <th>Сахар</th>
                  <th>Соль</th>
                  <th>Вес</th>
                  <th>Шаги</th>
                  <th style={{ textAlign: 'left' }}>Флаги</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.d}>
                    <td>
                      <Link href={`/dni/${day.d}`}>{longDate(day.d)}</Link>
                      <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
                        {weekday(day.d).slice(0, 2)}
                      </span>
                    </td>
                    <td>{fmt(day.calories)}</td>
                    <td className={day.in_corridor ? 'muted' : day.calories_delta !== null && day.calories_delta > 0 ? 'delta-bad' : ''}>
                      {signed(day.calories_delta)}
                    </td>
                    <td className="muted">{fmt(day.expenditure)}</td>
                    <td className={day.balance === null ? '' : day.balance < 0 ? 'delta-good' : 'delta-bad'}>
                      {signed(day.balance)}
                    </td>
                    <td>{fmt(day.protein, 1)}</td>
                    <td>{fmt(day.fat, 1)}</td>
                    <td>{fmt(day.carbs, 1)}</td>
                    <td
                      className={
                        settings?.fiber_target && day.fiber !== null && day.fiber < settings.fiber_target
                          ? 'delta-bad'
                          : ''
                      }
                    >
                      {fmt(day.fiber, 1)}
                    </td>
                    <td
                      className={
                        settings?.sugar_max && day.sugar !== null && day.sugar > settings.sugar_max
                          ? 'delta-bad'
                          : ''
                      }
                    >
                      {fmt(day.sugar, 1)}
                    </td>
                    <td
                      className={
                        settings?.salt_max && day.salt !== null && day.salt > settings.salt_max
                          ? 'delta-bad'
                          : ''
                      }
                    >
                      {fmt(day.salt, 1)}
                    </td>
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

      {logged.length > 0 && (
        <p className="form-note" style={{ marginTop: 12 }}>
          Красным отмечены дни, где клетчатки меньше нормы, а сахара или соли — больше предела.
          Пределы задаются на странице «Нормы». Расход и баланс считаются только за дни,
          где известны шаги; на признак «в коридоре» они не влияют.
        </p>
      )}
    </>
  );
}
