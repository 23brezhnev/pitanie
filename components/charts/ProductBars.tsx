'use client';

import { useState } from 'react';

import { fmt, plural, shortDate } from '@/lib/format';
import type { TopProduct } from '@/lib/types';

/**
 * Горизонтальные полосы по продуктам. Одна серия — легенда не нужна,
 * заголовок карточки уже говорит, что отложено.
 */
export function ProductBars({ items }: { items: TopProduct[] }) {
  const [hover, setHover] = useState<string | null>(null);

  if (items.length === 0) return <p className="empty">За этот период блюда не записаны</p>;

  const max = Math.max(...items.map((i) => i.calories ?? 0), 1);
  const active = items.find((i) => i.product === hover);

  return (
    <div className="chart" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {items.map((item) => (
        <div
          key={item.product}
          onMouseEnter={() => setHover(item.product)}
          onMouseLeave={() => setHover(null)}
          style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 168px) 1fr auto', gap: 12, alignItems: 'center' }}
        >
          <span
            style={{
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--ink-2)',
            }}
            title={item.product}
          >
            {item.product}
          </span>

          <span style={{ display: 'block', height: 16 }}>
            <span
              style={{
                display: 'block',
                height: 16,
                width: `${Math.max(((item.calories ?? 0) / max) * 100, 0.6)}%`,
                background: 'var(--series-1)',
                borderRadius: '0 4px 4px 0',
                opacity: hover === null || hover === item.product ? 1 : 0.45,
              }}
            />
          </span>

          <span
            style={{
              fontSize: 13,
              color: 'var(--ink-2)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {fmt(item.calories)} ккал
          </span>
        </div>
      ))}

      {active && (
        <div
          className="tooltip"
          style={{ position: 'static', transform: 'none', marginTop: 6, minWidth: 0 }}
        >
          <div className="tooltip-title">{active.product}</div>
          <div className="tooltip-row">
            <span className="tooltip-key">Порций</span>
            <b>
              {fmt(active.portions)} {plural(active.portions, 'раз', 'раза', 'раз')}
            </b>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-key">Белок · жиры · углеводы</span>
            <b>
              {fmt(active.protein, 1)} · {fmt(active.fat, 1)} · {fmt(active.carbs, 1)} г
            </b>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-key">Последний раз</span>
            <b>{shortDate(active.last_seen)}</b>
          </div>
        </div>
      )}
    </div>
  );
}
