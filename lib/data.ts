import 'server-only';

import { db } from './db';
import { num, shiftDays, todayMsk } from './format';
import type { Day, Dish, MealSplit, Settings, TopProduct, Week } from './types';

/** Периоды в фильтре над графиками. */
export const PERIODS = {
  7: '7 дней',
  30: '30 дней',
  90: '90 дней',
  365: 'год',
} as const;

export type PeriodKey = keyof typeof PERIODS;

export function isPeriod(value: unknown): value is PeriodKey {
  return typeof value === 'number' && value in PERIODS;
}

export function parsePeriod(raw: string | undefined, fallback: PeriodKey = 30): PeriodKey {
  const parsed = Number(raw);
  return isPeriod(parsed) ? parsed : fallback;
}

export function periodRange(period: PeriodKey): { from: string; to: string } {
  const to = todayMsk();
  return { from: shiftDays(to, -(period - 1)), to };
}

/** PostgREST отдаёт numeric то числом, то строкой — приводим в одном месте. */
function toDay(row: Record<string, unknown>): Day {
  return {
    d: String(row.d),
    calories: num(row.calories),
    protein: num(row.protein),
    fat: num(row.fat),
    carbs: num(row.carbs),
    fiber: num(row.fiber),
    sugar: num(row.sugar),
    salt: num(row.salt),
    sat_fat: num(row.sat_fat),
    weight: num(row.weight),
    steps: num(row.steps),
    weight_manual: Boolean(row.weight_manual),
    steps_manual: Boolean(row.steps_manual),
    flags: Array.isArray(row.flags) ? (row.flags as string[]) : [],
    note: (row.note as string | null) ?? null,
    diary: (row.diary as string | null) ?? null,
    updated_at: String(row.updated_at ?? ''),
    calories_target: num(row.calories_target),
    steps_target: num(row.steps_target),
    calories_delta: num(row.calories_delta),
    in_corridor: row.in_corridor === null ? null : Boolean(row.in_corridor),
    calories_ma7: num(row.calories_ma7),
    weight_ma7: num(row.weight_ma7),
    steps_ma7: num(row.steps_ma7),
    bmr: num(row.bmr),
    expenditure: num(row.expenditure),
    balance: num(row.balance),
  };
}

function toDish(row: Record<string, unknown>): Dish {
  return {
    id: Number(row.id),
    d: String(row.d),
    meal: row.meal as Dish['meal'],
    pos: Number(row.pos ?? 0),
    dish: String(row.dish),
    product: String(row.product),
    calories: num(row.calories),
    protein: num(row.protein),
    fat: num(row.fat),
    carbs: num(row.carbs),
  };
}

async function unwrap<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  map: (row: Record<string, unknown>) => T,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[] | null) ?? []).map(map);
}

export async function getSettings(): Promise<Settings | null> {
  const { data, error } = await db().from('settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: 1,
    calories_target: num(row.calories_target) ?? 0,
    calories_tolerance: num(row.calories_tolerance) ?? 0,
    protein_target: num(row.protein_target),
    fat_target: num(row.fat_target),
    carbs_target: num(row.carbs_target),
    fiber_target: num(row.fiber_target),
    sugar_max: num(row.sugar_max),
    salt_max: num(row.salt_max),
    sat_fat_max: num(row.sat_fat_max),
    weight_start: num(row.weight_start),
    weight_goal: num(row.weight_goal),
    steps_target: num(row.steps_target) ?? 0,
    rules: (row.rules as string | null) ?? null,
    height_cm: num(row.height_cm) ?? 0,
    age_years: num(row.age_years) ?? 0,
    activity_factor: num(row.activity_factor) ?? 0,
    baseline_steps: num(row.baseline_steps) ?? 0,
    kcal_per_step: num(row.kcal_per_step) ?? 0,
    updated_at: String(row.updated_at ?? ''),
  };
}

export async function getDays(from: string, to: string): Promise<Day[]> {
  return unwrap(
    db().from('v_days').select('*').gte('d', from).lte('d', to).order('d', { ascending: true }),
    toDay,
  );
}

export async function getRecentDays(limit: number): Promise<Day[]> {
  const rows = await unwrap(
    db().from('v_days').select('*').order('d', { ascending: false }).limit(limit),
    toDay,
  );
  return rows.reverse();
}

export async function getAllDays(): Promise<Day[]> {
  return unwrap(db().from('v_days').select('*').order('d', { ascending: false }), toDay);
}

export async function getDay(date: string): Promise<Day | null> {
  const rows = await unwrap(db().from('v_days').select('*').eq('d', date).limit(1), toDay);
  return rows[0] ?? null;
}

export async function getDishes(date: string): Promise<Dish[]> {
  return unwrap(
    db().from('dishes').select('*').eq('d', date).order('meal').order('pos'),
    toDish,
  );
}

export async function getMealSplit(from: string, to: string): Promise<MealSplit[]> {
  return unwrap(
    db().from('v_meal_split').select('*').gte('d', from).lte('d', to).order('d'),
    (row) => ({
      d: String(row.d),
      meal: row.meal as MealSplit['meal'],
      calories: num(row.calories),
      dishes: Number(row.dishes ?? 0),
    }),
  );
}

export async function getWeeks(limit = 26): Promise<Week[]> {
  const rows = await unwrap(
    db().from('v_weeks').select('*').order('week_start', { ascending: false }).limit(limit),
    (row) => ({
      week_start: String(row.week_start),
      days_logged: Number(row.days_logged ?? 0),
      avg_calories: num(row.avg_calories),
      avg_protein: num(row.avg_protein),
      avg_fat: num(row.avg_fat),
      avg_carbs: num(row.avg_carbs),
      avg_fiber: num(row.avg_fiber),
      avg_steps: num(row.avg_steps),
      avg_weight: num(row.avg_weight),
      days_in_corridor: Number(row.days_in_corridor ?? 0),
      days_flagged: Number(row.days_flagged ?? 0),
      weight_change: num(row.weight_change),
      avg_expenditure: num(row.avg_expenditure),
      avg_balance: num(row.avg_balance),
      total_balance: num(row.total_balance),
    }),
  );
  return rows;
}

export async function getTopProducts(
  from: string | null,
  to: string | null,
  limit = 20,
): Promise<TopProduct[]> {
  const { data, error } = await db().rpc('top_products', {
    p_from: from,
    p_to: to,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);

  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => ({
    product: String(row.product),
    portions: Number(row.portions ?? 0),
    calories: num(row.calories),
    protein: num(row.protein),
    fat: num(row.fat),
    carbs: num(row.carbs),
    last_seen: String(row.last_seen),
  }));
}

export async function getWeeklyReports(limit = 12): Promise<{ week_start: string; body: string }[]> {
  const { data, error } = await db()
    .from('weekly_reports')
    .select('week_start, body')
    .order('week_start', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as { week_start: string; body: string }[] | null) ?? [];
}

export async function getNeighbourDates(date: string): Promise<{ prev: string | null; next: string | null }> {
  const [before, after] = await Promise.all([
    db().from('days').select('d').lt('d', date).order('d', { ascending: false }).limit(1),
    db().from('days').select('d').gt('d', date).order('d', { ascending: true }).limit(1),
  ]);
  const pick = (r: { data: unknown }) => {
    const rows = (r.data as { d: string }[] | null) ?? [];
    return rows[0]?.d ?? null;
  };
  return { prev: pick(before), next: pick(after) };
}
