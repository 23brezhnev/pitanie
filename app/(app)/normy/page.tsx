import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { Card } from '@/components/ui';
import { getSettings } from '@/lib/data';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Пустое поле — это «нормы нет», а не ноль. */
function optionalNumber(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? '').trim().replace(',', '.');
  if (raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredNumber(formData: FormData, name: string, fallback: number): number {
  return optionalNumber(formData, name) ?? fallback;
}

async function saveSettings(formData: FormData) {
  'use server';

  const rules = String(formData.get('rules') ?? '').trim();

  const { error } = await db()
    .from('settings')
    .update({
      calories_target: requiredNumber(formData, 'calories_target', 1900),
      calories_tolerance: requiredNumber(formData, 'calories_tolerance', 100),
      protein_target: optionalNumber(formData, 'protein_target'),
      fat_target: optionalNumber(formData, 'fat_target'),
      carbs_target: optionalNumber(formData, 'carbs_target'),
      fiber_target: optionalNumber(formData, 'fiber_target'),
      sugar_max: optionalNumber(formData, 'sugar_max'),
      salt_max: optionalNumber(formData, 'salt_max'),
      sat_fat_max: optionalNumber(formData, 'sat_fat_max'),
      weight_start: optionalNumber(formData, 'weight_start'),
      weight_goal: optionalNumber(formData, 'weight_goal'),
      steps_target: requiredNumber(formData, 'steps_target', 8000),
      height_cm: requiredNumber(formData, 'height_cm', 185),
      age_years: requiredNumber(formData, 'age_years', 30),
      activity_factor: requiredNumber(formData, 'activity_factor', 1.35),
      baseline_steps: requiredNumber(formData, 'baseline_steps', 5000),
      kcal_per_step: requiredNumber(formData, 'kcal_per_step', 0.0833),
      rules: rules === '' ? null : rules,
    })
    .eq('id', 1);

  if (error) throw new Error(error.message);

  revalidatePath('/', 'layout');
  redirect('/normy?sohraneno=1');
}

function Field({
  name,
  label,
  value,
  step = '1',
  hint,
}: {
  name: string;
  label: string;
  value: number | null;
  step?: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type="number"
        step={step}
        defaultValue={value ?? ''}
        inputMode="decimal"
      />
      {hint && <span className="form-note">{hint}</span>}
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ sohraneno?: string }>;
}) {
  const [settings, params] = await Promise.all([getSettings(), searchParams]);

  if (!settings) {
    return <p className="empty">В таблице settings нет строки с id = 1. Создай её и обнови страницу.</p>;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Нормы</h1>
          <p>
            Отсюда графики берут цели и коридор. Claude читает эти же значения, когда считает
            день, — правь здесь, а не в переписке.
          </p>
        </div>
        {params.sohraneno && <span className="chip">Сохранено</span>}
      </div>

      <form action={saveSettings} className="stack">
        <Card title="Калории" subtitle="День считается «в коридоре», если укладывается в цель ± допуск">
          <div className="grid grid-tiles" style={{ gap: 14 }}>
            <Field name="calories_target" label="Норма, ккал" value={settings.calories_target} step="10" />
            <Field name="calories_tolerance" label="Допуск, ± ккал" value={settings.calories_tolerance} step="10" />
          </div>
        </Card>

        <Card title="Макросы и пределы" subtitle="Пустое поле — норма не задана, полоска на дне не рисуется">
          <div className="grid grid-tiles" style={{ gap: 14 }}>
            <Field name="protein_target" label="Белок, г" value={settings.protein_target} step="1" hint="Норму надо набрать" />
            <Field name="fat_target" label="Жиры, г" value={settings.fat_target} step="1" />
            <Field name="carbs_target" label="Углеводы, г" value={settings.carbs_target} step="1" />
            <Field name="fiber_target" label="Клетчатка, г" value={settings.fiber_target} step="1" hint="Норму надо набрать" />
            <Field name="sugar_max" label="Добавленный сахар, не больше г" value={settings.sugar_max} step="1" />
            <Field name="salt_max" label="Соль, не больше г" value={settings.salt_max} step="0.1" />
            <Field name="sat_fat_max" label="Насыщенные жиры, не больше г" value={settings.sat_fat_max} step="1" />
          </div>
        </Card>

        <Card title="Вес и движение">
          <div className="grid grid-tiles" style={{ gap: 14 }}>
            <Field name="weight_start" label="Стартовый вес, кг" value={settings.weight_start} step="0.1" />
            <Field name="weight_goal" label="Целевой вес, кг" value={settings.weight_goal} step="0.1" />
            <Field name="steps_target" label="Шаги в день" value={settings.steps_target} step="500" />
          </div>
          <p className="form-note" style={{ marginTop: 12 }}>
            Норма калорий под шаги не пересчитывается. Счётчик завышает расход на 20–30%, а базовая
            активность уже заложена в норму.
          </p>
        </Card>

        <Card
          title="Оценка расхода"
          subtitle="Отсюда берутся «Потрачено» и «Баланс дня». На норму и на признак «в коридоре» эти числа не влияют — они только объясняют движение веса."
        >
          <div className="grid grid-tiles" style={{ gap: 14 }}>
            <Field name="height_cm" label="Рост, см" value={settings.height_cm} step="1" />
            <Field name="age_years" label="Возраст, лет" value={settings.age_years} step="1" />
            <Field
              name="activity_factor"
              label="Коэффициент активности"
              value={settings.activity_factor}
              step="0.01"
              hint="При базовом числе шагов"
            />
            <Field
              name="baseline_steps"
              label="Базовые шаги"
              value={settings.baseline_steps}
              step="500"
              hint="Сколько шагов уже заложено в коэффициент"
            />
            <Field
              name="kcal_per_step"
              label="Ккал за шаг сверх базовых"
              value={settings.kcal_per_step}
              step="0.001"
              hint="0,0833 — это 250 ккал за 3000 шагов"
            />
          </div>
          <p className="form-note" style={{ marginTop: 12 }}>
            Основной обмен считается по Миффлину — Сан Жеору от последнего известного веса.
            Расход — обмен, умноженный на коэффициент, плюс прибавка за шаги сверх базовых.
            Счётчик шагов завышает расход на 20–30%: если оценка кажется щедрой, снижай ккал за шаг.
          </p>
        </Card>

        <Card title="Правила питания" subtitle="То, что раньше лежало в «Система питания.md». Claude читает это перед каждой записью.">
          <textarea name="rules" defaultValue={settings.rules ?? ''} />
        </Card>

        <div>
          <button type="submit" className="button button-primary">
            Сохранить
          </button>
        </div>
      </form>
    </>
  );
}
