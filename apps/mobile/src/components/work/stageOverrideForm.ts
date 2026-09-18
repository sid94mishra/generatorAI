// ────────────────────────────────────────────────────────────────
// Per-stage variables for the Advanced section of StartRunSheet.
//
// A stage override's `variables` are free-form (StageRunOverride in
// @generatorai/shared) — there is no per-stage declaration to build fields
// from — so the sheet takes one `key=value` per line. Values that parse as
// JSON scalars (numbers, true/false, null) are sent typed; everything else
// is a string. The wire encoding itself is `encodeStageOverrides` in
// @generatorai/client-core.
//
// Tested in src/__tests__/stageOverrideForm.test.ts.
// ────────────────────────────────────────────────────────────────

export interface StageVariablesParse {
  variables: Record<string, unknown>;
  /** First problem, or null. */
  error: string | null;
}

const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value !== '' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseStageVariables(text: string): StageVariablesParse {
  const variables: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) return { variables, error: `Line ${i + 1}: use key=value.` };
    const key = line.slice(0, eq).trim();
    if (!KEY.test(key)) return { variables, error: `Line ${i + 1}: "${key}" is not a valid variable name.` };
    if (key.startsWith('__')) return { variables, error: `Line ${i + 1}: names starting with __ are reserved.` };
    variables[key] = coerce(line.slice(eq + 1).trim());
  }
  return { variables, error: null };
}

/** Back to text, for re-seeding a field. */
export function formatStageVariables(variables: Record<string, unknown>): string {
  return Object.entries(variables)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}
