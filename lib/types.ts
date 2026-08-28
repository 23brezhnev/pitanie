export type Meal = 'Завтрак' | 'Обед' | 'Перекус' | 'Ужин';

export const MEALS: Meal[] = ['Завтрак', 'Обед', 'Перекус', 'Ужин'];

export type Day = {
  d: string;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  fiber: number | null;
  sugar: number | null;
  salt: number | null;
  sat_fat: number | null;
  weight: number | null;
  steps: number | null;
  weight_manual: boolean;
  steps_manual: boolean;
  flags: string[];
  note: string | null;
  diary: string | null;
  updated_at: string;
  calories_target: number | null;
  steps_target: number | null;
  calories_delta: number | null;
  in_corridor: boolean | null;
  calories_ma7: number | null;
  weight_ma7: number | null;
  steps_ma7: number | null;
  bmr: number | null;
  fat_percent: number | null;
  lean_mass: number | null;
  active_energy: number | null;
  basal_energy: number | null;
  expenditure_measured: number | null;
  expenditure_formula: number | null;
  /** Расход: измерение Apple Health, где оно есть, иначе формула. */
  expenditure: number | null;
  /** «health» или «формула» — чем именно посчитан расход. */
  expenditure_source: string | null;
  /** Съедено минус потрачено: минус — дефицит, плюс — профицит. */
  balance: number | null;
};

export type Dish = {
  id: number;
  d: string;
  meal: Meal;
  pos: number;
  dish: string;
  product: string;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
};

export type Settings = {
  id: number;
  calories_target: number;
  calories_tolerance: number;
  protein_target: number | null;
  fat_target: number | null;
  carbs_target: number | null;
  fiber_target: number | null;
  sugar_max: number | null;
  salt_max: number | null;
  sat_fat_max: number | null;
  weight_start: number | null;
  weight_goal: number | null;
  steps_target: number;
  prefer_measured_expenditure: boolean;
  rules: string | null;
  height_cm: number;
  age_years: number;
  activity_factor: number;
  baseline_steps: number;
  kcal_per_step: number;
  updated_at: string;
};

export type Week = {
  week_start: string;
  days_logged: number;
  avg_calories: number | null;
  avg_protein: number | null;
  avg_fat: number | null;
  avg_carbs: number | null;
  avg_fiber: number | null;
  avg_steps: number | null;
  avg_weight: number | null;
  days_in_corridor: number;
  days_flagged: number;
  weight_change: number | null;
  avg_expenditure: number | null;
  avg_balance: number | null;
  total_balance: number | null;
  avg_fat_percent: number | null;
};

export type TopProduct = {
  product: string;
  portions: number;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  last_seen: string;
};

export type MealSplit = {
  d: string;
  meal: Meal;
  calories: number | null;
  dishes: number;
};
