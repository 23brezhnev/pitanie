/** Шкалы для графиков: круглые деления и линейное отображение. */

export function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const snapped = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return snapped * magnitude;
}

/**
 * Круглые деления оси, покрывающие [min, max].
 * Возвращает и расширенные границы — по ним и рисуем, иначе верхняя метка обрежется.
 */
export function niceTicks(
  min: number,
  max: number,
  count = 5,
): { ticks: number[]; lo: number; hi: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], lo: 0, hi: 1 };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }

  const step = niceStep((max - min) / Math.max(count - 1, 1));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // Копим через счётчик, а не прибавлением шага: у дробных шагов накапливается ошибка.
  for (let i = 0; lo + i * step <= hi + step / 1000; i += 1) ticks.push(lo + i * step);

  return { ticks, lo, hi };
}

export function linear(value: number, domainLo: number, domainHi: number, rangeLo: number, rangeHi: number): number {
  if (domainHi === domainLo) return (rangeLo + rangeHi) / 2;
  return rangeLo + ((value - domainLo) / (domainHi - domainLo)) * (rangeHi - rangeLo);
}
