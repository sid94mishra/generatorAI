// Pure Slider logic (03 MP-25): snapping, Compose's step count, a value from a touch, and the adjustable step.
export function snapSlider(value: number, min: number, max: number, step?: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  if (!step || step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.round(snapped * 1e6) / 1e6);
}

/** Compose `steps`: the number of discrete stops between the ends (0 = continuous). */
export function composeSteps(min: number, max: number, step?: number): number {
  if (!step || step <= 0) return 0;
  return Math.max(0, Math.round((max - min) / step) - 1);
}

/** Value at x on a track of a width (RTL mirrors). */
export function sliderValueAt(x: number, width: number, min: number, max: number, step?: number, rtl = false): number {
  if (width <= 0) return min;
  const fraction = Math.min(1, Math.max(0, x / width));
  return snapSlider(min + (rtl ? 1 - fraction : fraction) * (max - min), min, max, step);
}

/** One adjustable increment: the step, or 10 % of the range when continuous. */
export function adjustStep(min: number, max: number, step?: number): number {
  return step && step > 0 ? step : (max - min) / 10;
}

/** True when a stepped slider moved to another stop (a selection tick). */
export function crossedStop(previous: number, next: number, step?: number): boolean {
  return Boolean(step) && previous !== next;
}

export function sliderFraction(value: number, min: number, max: number): number {
  return max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0;
}
