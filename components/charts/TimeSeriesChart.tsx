'use client';

import { useMemo, useState } from 'react';

import { fmt, shortDate } from '@/lib/format';
import { linear, niceTicks } from '@/lib/scale';
import { useWidth } from '../useWidth';

export type SeriesSpec = {
  key: string;
  label: string;
  color: string;
  type: 'column' | 'line';
  /** Знаков после запятой в подсказке. */
  digits?: number;
};

export type TimePoint = { d: string; [key: string]: number | string | null | undefined };

type Props = {
  data: TimePoint[];
  series: SeriesSpec[];
  /** Коридор нормы: серая полоса позади данных. */
  band?: { lo: number; hi: number; label: string };
  /** Линия цели. */
  reference?: { value: number; label: string };
  unit?: string;
  height?: number;
  /** Столбцы всегда от нуля; вес и подобное — по фактическому диапазону. */
  zeroBased?: boolean;
  emptyText?: string;
};

const M = { top: 14, right: 16, bottom: 26, left: 46 };
const COLUMN_MAX = 24;
const COLUMN_GAP = 2; // «пробел поверхностью» между соседними столбцами
const COLUMN_LIMIT = 45; // дальше столбцы тоньше волоса — переключаемся на линию

/** Столбец со скруглённой вершиной и прямым основанием. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
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

export function TimeSeriesChart({
  data,
  series,
  band,
  reference,
  unit,
  height = 220,
  zeroBased = true,
  emptyText = 'Пока нет данных за этот период',
}: Props) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const resolved = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        type: s.type === 'column' && data.length > COLUMN_LIMIT ? ('line' as const) : s.type,
      })),
    [series, data.length],
  );

  const geometry = useMemo(() => {
    const values: number[] = [];
    for (const point of data) {
      for (const s of resolved) {
        const v = point[s.key];
        if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
      }
    }
    if (band) values.push(band.lo, band.hi);
    if (reference) values.push(reference.value);

    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    return niceTicks(zeroBased ? Math.min(0, min) : min, max, 5);
  }, [data, resolved, band, reference, zeroBased]);

  if (data.length === 0) return <p className="empty">{emptyText}</p>;

  const plotWidth = Math.max(width - M.left - M.right, 10);
  const plotHeight = height - M.top - M.bottom;
  const bandWidth = plotWidth / data.length;

  const xAt = (i: number) => M.left + bandWidth * (i + 0.5);
  const yAt = (v: number) => linear(v, geometry.lo, geometry.hi, M.top + plotHeight, M.top);

  const columnWidth = Math.max(Math.min(bandWidth - COLUMN_GAP, COLUMN_MAX), 1);

  // Подписи по оси X: примерно каждые 76 px, чтобы даты не наезжали друг на друга.
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotWidth / 76))));

  const legendSeries = resolved.filter((s) => data.some((p) => typeof p[s.key] === 'number'));
  const hovered = hover !== null ? data[hover] : null;

  const tooltipLeft = hover !== null ? Math.min(Math.max(xAt(hover), 78), width - 78) : 0;

  return (
    <div className="chart" ref={ref}>
      <svg
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`График за ${data.length} дн.`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - box.left) / box.width) * width;
          const index = Math.floor((x - M.left) / bandWidth);
          setHover(index >= 0 && index < data.length ? index : null);
        }}
      >
        {/* коридор нормы */}
        {band && (
          <rect
            x={M.left}
            y={yAt(band.hi)}
            width={plotWidth}
            height={Math.max(yAt(band.lo) - yAt(band.hi), 1)}
            fill="var(--grid)"
            opacity="0.55"
          />
        )}

        {/* сетка и подписи оси Y */}
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
              {fmt(tick, Number.isInteger(tick) ? 0 : 1)}
            </text>
          </g>
        ))}

        {/* линия цели */}
        {reference && (
          <line
            x1={M.left}
            x2={M.left + plotWidth}
            y1={yAt(reference.value)}
            y2={yAt(reference.value)}
            stroke="var(--axis)"
            strokeWidth="1"
          />
        )}

        {/* подписи оси X */}
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

        {/* курсор */}
        {hover !== null && (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={M.top}
            y2={M.top + plotHeight}
            stroke="var(--axis)"
            strokeWidth="1"
          />
        )}

        {/* столбцы */}
        {resolved
          .filter((s) => s.type === 'column')
          .map((s) =>
            data.map((point, i) => {
              const v = point[s.key];
              if (typeof v !== 'number') return null;
              const top = Math.min(yAt(v), yAt(Math.max(geometry.lo, 0)));
              const bottom = Math.max(yAt(v), yAt(Math.max(geometry.lo, 0)));
              return (
                <path
                  key={`${s.key}-${point.d}`}
                  d={columnPath(xAt(i) - columnWidth / 2, top, columnWidth, bottom - top)}
                  fill={s.color}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              );
            }),
          )}

        {/* линии — с разрывами там, где данных нет */}
        {resolved
          .filter((s) => s.type === 'line')
          .map((s) => {
            // Копим подряд идущие точки. Одиночная точка не даёт линии — рисуем её кружком,
            // иначе редкие измерения (взвешивался через день) просто исчезают с графика.
            const runs: { i: number; v: number }[][] = [];
            let current: { i: number; v: number }[] = [];
            data.forEach((point, i) => {
              const v = point[s.key];
              if (typeof v === 'number' && Number.isFinite(v)) {
                current.push({ i, v });
              } else if (current.length) {
                runs.push(current);
                current = [];
              }
            });
            if (current.length) runs.push(current);

            const last = runs.at(-1)?.at(-1) ?? null;

            return (
              <g key={s.key}>
                {runs.map((run, index) =>
                  run.length > 1 ? (
                    <path
                      key={index}
                      d={run.map((p, k) => `${k ? 'L' : 'M'}${xAt(p.i)} ${yAt(p.v)}`).join(' ')}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : (
                    <circle
                      key={index}
                      cx={xAt(run[0].i)}
                      cy={yAt(run[0].v)}
                      r="3"
                      fill={s.color}
                    />
                  ),
                )}
                {last && (
                  <circle
                    cx={xAt(last.i)}
                    cy={yAt(last.v)}
                    r="4"
                    fill={s.color}
                    stroke="var(--surface)"
                    strokeWidth="2"
                  />
                )}
              </g>
            );
          })}

        {/* точки под курсором */}
        {hovered &&
          resolved.map((s) => {
            const v = hovered[s.key];
            if (typeof v !== 'number') return null;
            return (
              <circle
                key={s.key}
                cx={xAt(hover as number)}
                cy={yAt(v)}
                r="4"
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            );
          })}
      </svg>

      {hovered && (
        <div className="tooltip" style={{ left: tooltipLeft, top: M.top }}>
          <div className="tooltip-title">{shortDate(hovered.d)}</div>
          {resolved.map((s) => {
            const v = hovered[s.key];
            return (
              <div className="tooltip-row" key={s.key}>
                <span className="tooltip-key">
                  <span className="dot" style={{ background: s.color }} />
                  {s.label}
                </span>
                <b>
                  {typeof v === 'number' ? fmt(v, s.digits ?? 0) : '—'}
                  {typeof v === 'number' && unit ? ` ${unit}` : ''}
                </b>
              </div>
            );
          })}
        </div>
      )}

      {(legendSeries.length > 1 || band || reference) && (
        <div className="legend">
          {legendSeries.map((s) => (
            <span className="legend-item" key={s.key}>
              <span
                className="dot"
                style={{
                  background: s.color,
                  ...(s.type === 'line' ? { height: 3, width: 14, borderRadius: 2 } : {}),
                }}
              />
              {s.label}
            </span>
          ))}
          {band && (
            <span className="legend-item">
              <span
                className="dot"
                style={{ background: 'var(--grid)', width: 14, borderRadius: 3 }}
              />
              {band.label}
            </span>
          )}
          {reference && !band && (
            <span className="legend-item">
              <span
                className="dot"
                style={{ background: 'var(--axis)', height: 2, width: 14, borderRadius: 1 }}
              />
              {reference.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
