'use client';

import { useMemo, useState } from 'react';

import { fmt, shortDate } from '@/lib/format';
import { linear, niceTicks } from '@/lib/scale';
import { useWidth } from '../useWidth';

export type StackSeries = { key: string; label: string; color: string };
export type StackPoint = { d: string; [key: string]: number | string | null | undefined };

type Props = {
  data: StackPoint[];
  series: StackSeries[];
  unit?: string;
  digits?: number;
  height?: number;
  emptyText?: string;
};

const M = { top: 14, right: 16, bottom: 26, left: 46 };
const COLUMN_MAX = 24;
const COLUMN_GAP = 2;
const SEGMENT_GAP = 2; // пробел поверхностью между сегментами стопки

function segmentPath(x: number, y: number, w: number, h: number, rounded: boolean): string {
  if (h <= 0) return '';
  if (!rounded) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  const r = Math.min(4, w / 2, h);
  return [
    `M${x} ${y + h}`,
    `L${x} ${y + r}`,
    `Q${x} ${y} ${x + r} ${y}`,
    `L${x + w - r} ${y}`,
    `Q${x + w} ${y} ${x + w} ${y + r}`,
    `L${x + w} ${y + h}`,
    'Z',
  ].join(' ');
}

export function StackedColumns({
  data,
  series,
  unit,
  digits = 0,
  height = 220,
  emptyText = 'Пока нет данных за этот период',
}: Props) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const totals = useMemo(
    () =>
      data.map((point) =>
        series.reduce((sum, s) => sum + (typeof point[s.key] === 'number' ? (point[s.key] as number) : 0), 0),
      ),
    [data, series],
  );

  const geometry = useMemo(
    () => niceTicks(0, totals.length ? Math.max(...totals) : 1, 5),
    [totals],
  );

  if (data.length === 0) return <p className="empty">{emptyText}</p>;

  const plotWidth = Math.max(width - M.left - M.right, 10);
  const plotHeight = height - M.top - M.bottom;
  const bandWidth = plotWidth / data.length;
  const columnWidth = Math.max(Math.min(bandWidth - COLUMN_GAP, COLUMN_MAX), 1);

  const xAt = (i: number) => M.left + bandWidth * (i + 0.5);
  const yAt = (v: number) => linear(v, geometry.lo, geometry.hi, M.top + plotHeight, M.top);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotWidth / 76))));

  const hovered = hover !== null ? data[hover] : null;
  const tooltipLeft = hover !== null ? Math.min(Math.max(xAt(hover), 84), width - 84) : 0;

  return (
    <div className="chart" ref={ref}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <div className="segmented">
          <button type="button" aria-pressed={!asTable} onClick={() => setAsTable(false)}>
            График
          </button>
          <button type="button" aria-pressed={asTable} onClick={() => setAsTable(true)}>
            Таблица
          </button>
        </div>
      </div>

      {asTable ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                {series.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
                <th>Всего</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((point, i) => (
                <tr key={point.d}>
                  <td>{shortDate(point.d)}</td>
                  {series.map((s) => (
                    <td key={s.key}>
                      {typeof point[s.key] === 'number' ? fmt(point[s.key] as number, digits) : '—'}
                    </td>
                  ))}
                  <td>{fmt(totals[data.length - 1 - i], digits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Столбцы за ${data.length} дн.`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - box.left) / box.width) * width;
            const index = Math.floor((x - M.left) / bandWidth);
            setHover(index >= 0 && index < data.length ? index : null);
          }}
        >
          {geometry.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={M.left}
                x2={M.left + plotWidth}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke="var(--grid)"
                strokeWidth="1"
              />
              <text
                x={M.left - 8}
                y={yAt(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="11"
                fill="var(--ink-muted)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {fmt(tick)}
              </text>
            </g>
          ))}

          {data.map((point, i) =>
            i % labelEvery === 0 ? (
              <text
                key={point.d}
                x={xAt(i)}
                y={M.top + plotHeight + 16}
                textAnchor="middle"
                fontSize="11"
                fill="var(--ink-muted)"
              >
                {shortDate(point.d)}
              </text>
            ) : null,
          )}

          {data.map((point, i) => {
            const present = series.filter((s) => typeof point[s.key] === 'number' && (point[s.key] as number) > 0);
            let cursor = 0;
            return (
              <g key={point.d} opacity={hover === null || hover === i ? 1 : 0.45}>
                {present.map((s, index) => {
                  const value = point[s.key] as number;
                  const yBottom = yAt(cursor);
                  cursor += value;
                  const yTop = yAt(cursor);
                  const isTop = index === present.length - 1;
                  // Пробел режем снизу сегмента, кроме самого нижнего — он стоит на оси.
                  const gap = index === 0 ? 0 : SEGMENT_GAP;
                  const h = Math.max(yBottom - yTop - gap, 0);
                  return (
                    <path
                      key={s.key}
                      d={segmentPath(xAt(i) - columnWidth / 2, yTop, columnWidth, h, isTop)}
                      fill={s.color}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}

      {hovered && !asTable && (
        <div className="tooltip" style={{ left: tooltipLeft, top: M.top }}>
          <div className="tooltip-title">{shortDate(hovered.d)}</div>
          {series.map((s) => (
            <div className="tooltip-row" key={s.key}>
              <span className="tooltip-key">
                <span className="dot" style={{ background: s.color }} />
                {s.label}
              </span>
              <b>
                {typeof hovered[s.key] === 'number' ? fmt(hovered[s.key] as number, digits) : '—'}
              </b>
            </div>
          ))}
          <div className="tooltip-row" style={{ marginTop: 4 }}>
            <span className="tooltip-key">Всего</span>
            <b>
              {fmt(totals[hover as number], digits)}
              {unit ? ` ${unit}` : ''}
            </b>
          </div>
        </div>
      )}

      <div className="legend">
        {series.map((s) => (
          <span className="legend-item" key={s.key}>
            <span className="dot" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
