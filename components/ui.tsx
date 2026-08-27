import Link from 'next/link';
import type { ReactNode } from 'react';

import { PERIODS, type PeriodKey } from '@/lib/data';
import { fmt } from '@/lib/format';

export function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {subtitle && <p className="card-sub">{subtitle}</p>}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  unit,
  digits = 0,
  delta,
  foot,
}: {
  label: string;
  value: number | null;
  unit?: string;
  digits?: number;
  /** Знаковое отклонение и как его читать: «меньше — лучше» для калорий и веса. */
  delta?: { value: number | null; suffix?: string; goodWhen: 'lower' | 'higher' };
  foot?: ReactNode;
}) {
  const deltaValue = delta?.value ?? null;
  const isGood =
    deltaValue === null || deltaValue === 0
      ? null
      : delta?.goodWhen === 'lower'
        ? deltaValue < 0
        : deltaValue > 0;

  return (
    <div className="card">
      <div className="tile-label">{label}</div>
      <div className="tile-value">
        {fmt(value, digits)}
        {unit && value !== null && <span className="tile-unit">{unit}</span>}
      </div>
      <div className="tile-foot">
        {deltaValue !== null && (
          <span className={isGood === null ? '' : isGood ? 'delta-good' : 'delta-bad'}>
            {deltaValue > 0 ? '+' : deltaValue < 0 ? '−' : ''}
            {fmt(Math.abs(deltaValue), digits)}
            {delta?.suffix ? ` ${delta.suffix}` : ''}
          </span>
        )}
        {foot}
      </div>
    </div>
  );
}

export function PeriodPicker({ path, current }: { path: string; current: PeriodKey }) {
  return (
    <div className="segmented">
      {(Object.keys(PERIODS) as unknown as string[]).map((key) => {
        const period = Number(key) as PeriodKey;
        return (
          <Link
            key={key}
            href={`${path}?period=${period}`}
            aria-current={period === current ? 'true' : undefined}
          >
            {PERIODS[period]}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Полоска «сколько от нормы». Заливка несёт состояние, дорожка — светлый шаг
 * того же цвета, чтобы состояние читалось по всей ширине.
 */
export function NutrientMeter({
  label,
  value,
  target,
  unit,
  digits = 0,
  /** Норму надо набрать (белок, клетчатка) или не превысить (сахар, соль). */
  mode = 'ceiling',
}: {
  label: string;
  value: number | null;
  target: number | null;
  unit: string;
  digits?: number;
  mode?: 'ceiling' | 'floor';
}) {
  const ratio = value !== null && target ? value / target : null;
  const over = ratio !== null && ratio > 1.02;
  const under = ratio !== null && ratio < 0.85;

  const color =
    ratio === null
      ? 'var(--axis)'
      : mode === 'ceiling'
        ? over
          ? 'var(--critical)'
          : 'var(--series-1)'
        : under
          ? 'var(--warning)'
          : 'var(--series-1)';

  const status = ratio === null ? null : mode === 'ceiling' ? (over ? 'выше нормы' : null) : under ? 'ниже нормы' : null;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          fontSize: 13,
          marginBottom: 5,
        }}
      >
        <span style={{ color: 'var(--ink-2)' }}>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          <b style={{ fontWeight: 600 }}>{fmt(value, digits)}</b>
          <span className="muted">
            {target !== null ? ` / ${fmt(target, digits)}` : ''} {unit}
          </span>
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: 'var(--surface-sunken)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(Math.max((ratio ?? 0) * 100, 0), 100)}%`,
            background: color,
            borderRadius: 3,
          }}
        />
      </div>
      {status && (
        <div style={{ fontSize: 12, marginTop: 4 }} className={over ? 'delta-bad' : 'muted'}>
          {status}
        </div>
      )}
    </div>
  );
}

export function Flags({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <>
      {flags.map((flag) => (
        <span className="chip" key={flag}>
          <span className="dot" style={{ background: 'var(--warning)' }} />
          {flag}
        </span>
      ))}
    </>
  );
}
