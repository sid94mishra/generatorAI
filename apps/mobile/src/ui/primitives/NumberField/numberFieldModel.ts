// Pure NumberField logic (03 MP-43): clamped stepping and the adjustable value.
export function clampStep(value: number, delta: number, min = -Infinity, max = Infinity): number {
  const next = value + delta;
  // Fix float drift for fractional steps (0.1 + 0.2).
  const rounded = Math.round(next * 1e6) / 1e6;
  return Math.min(max, Math.max(min, rounded));
}

export function canStep(value: number, direction: 1 | -1, min = -Infinity, max = Infinity): boolean {
  return direction > 0 ? value < max : value > min;
}

export function numberAccessibilityValue(value: number, text: string, min?: number, max?: number): { now: number; min?: number; max?: number; text: string } {
  return { now: value, min: Number.isFinite(min) ? min : undefined, max: Number.isFinite(max) ? max : undefined, text };
}
