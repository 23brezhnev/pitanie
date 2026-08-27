import { ProductBars } from '@/components/charts/ProductBars';
import { Card, PeriodPicker } from '@/components/ui';
import { getTopProducts, parsePeriod, periodRange } from '@/lib/data';
import { days as daysWord, fmt, longDate, plural } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const period = parsePeriod((await searchParams).period, 30);
  const { from, to } = periodRange(period);
  const products = await getTopProducts(from, to, 40);

  const total = products.reduce((sum, p) => sum + (p.calories ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Продукты</h1>
          <p>
            Группировка по нормализованному ключу: бренд и вес в него не входят, поэтому «Сыр
            Село Зелёное» и «Сыр» — одна строка.
          </p>
        </div>
        <PeriodPicker path="/produkty" current={period} />
      </div>

      <div className="stack">
        <Card
          title={`Топ по калориям за ${daysWord(period)}`}
          subtitle={
            products.length === 0
              ? undefined
              : `${products.length} ${plural(products.length, 'продукт', 'продукта', 'продуктов')}, всего ${fmt(total)} ккал`
          }
        >
          <ProductBars items={products.slice(0, 15)} />
        </Card>

        <Card title="Все продукты периода">
          {products.length === 0 ? (
            <p className="empty">За этот период блюда не записаны</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Продукт</th>
                    <th>Порций</th>
                    <th>Ккал всего</th>
                    <th>Ккал за раз</th>
                    <th>Белок</th>
                    <th>Жиры</th>
                    <th>Углев.</th>
                    <th>Последний раз</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.product}>
                      <td style={{ whiteSpace: 'normal' }}>{product.product}</td>
                      <td>{fmt(product.portions)}</td>
                      <td>{fmt(product.calories)}</td>
                      <td>
                        {product.calories !== null && product.portions > 0
                          ? fmt(Math.round(product.calories / product.portions))
                          : '—'}
                      </td>
                      <td>{fmt(product.protein, 1)}</td>
                      <td>{fmt(product.fat, 1)}</td>
                      <td>{fmt(product.carbs, 1)}</td>
                      <td>{longDate(product.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
