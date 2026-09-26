// ────────────────────────────────────────────────────────────────
// Workflow variables (the settings' Variables tab): name validation that
// mirrors the spec schema, choice options typed as one string, the default
// value coerced to the declared type, the auto-label rule and what the Run
// dialog asks for at launch (WorkflowSettingsPanel board). Pure.
// ────────────────────────────────────────────────────────────────

import {
  FORBIDDEN_VARIABLE_NAME_PATTERN,
  RESERVED_ROOTS,
  VARIABLE_NAME_PATTERN,
  type VariableDefinition,
} from '@generatorai/workflow-spec';

export type VariableType = VariableDefinition['type'];

/**
 * Why `name` cannot be a variable name, or null. Mirrors the spec schema so
 * the problem shows while typing rather than as a failed save: identifiers
 * only, not an expression root (`variables`, `stages`, `run`, …) and not a
 * reserved system prefix (`__`, `repo_path_`, `repo_branch_`).
 */
export function variableNameError(name: string, otherNames: readonly string[]): string | null {
  if (!name) return 'A name is required';
  if (!VARIABLE_NAME_PATTERN.test(name)) return 'Use letters, digits and _ (not starting with a digit)';
  if ((RESERVED_ROOTS as readonly string[]).includes(name)) return `'${name}' is a reserved expression root`;
  if (FORBIDDEN_VARIABLE_NAME_PATTERN.test(name)) {
    return 'Names starting with __, repo_path_ or repo_branch_ are reserved (use run.codebases.<alias>)';
  }
  if (otherNames.includes(name)) return `Another variable is already called '${name}'`;
  return null;
}

/** True when `name` is refused because it is reserved (a root or a system prefix), not merely malformed or taken. */
export function isReservedVariableName(name: string): boolean {
  return (RESERVED_ROOTS as readonly string[]).includes(name) || FORBIDDEN_VARIABLE_NAME_PATTERN.test(name);
}

/** The reserved expression roots, for the "Also reserved: …" note. */
export const RESERVED_VARIABLE_ROOTS: readonly string[] = RESERVED_ROOTS;

/** Choice options typed as one comma-separated string (parsed on blur, D-11). */
export function parseOptions(raw: string): string[] {
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}

/**
 * True when the label is still the one the builder generated for this name
 * (`variable3` → "Variable 3"), or simply a copy of the name.
 */
export function isAutoLabel(label: string | undefined, name: string): boolean {
  if (!label) return true;
  if (label === name) return true;
  const generated = /^variable(\d+)$/.exec(name);
  return generated !== null && label === `Variable ${generated[1]}`;
}

export const VARIABLE_TYPES: readonly { value: VariableType; label: string; short: string }[] = [
  { value: 'string', label: 'String', short: 'String' },
  { value: 'number', label: 'Number', short: 'Number' },
  { value: 'boolean', label: 'Boolean', short: 'Boolean' },
  { value: 'choice', label: 'Choice', short: 'Choice' },
  { value: 'text', label: 'Text (multiline)', short: 'Text' },
  { value: 'list', label: 'List of strings', short: 'List' },
  { value: 'json', label: 'JSON', short: 'JSON' },
];

export function typeShortLabel(type: VariableType): string {
  return VARIABLE_TYPES.find((t) => t.value === type)?.short ?? type;
}

/**
 * Coerce a typed default to the type the variable declares, so a `number`
 * variable stores 4 (not "4") and a `boolean` one stores true. An input the
 * user is still typing (`"1e"`, `"ye"`) is kept verbatim rather than
 * mangled — validation happens at run time.
 */
export function coerceDefault(raw: string, type: VariableType): unknown {
  if (raw === '') return undefined;
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === 'boolean') {
    const lowered = raw.trim().toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
    return raw;
  }
  // A list default is typed comma-separated; a json default as JSON (kept verbatim until it parses).
  if (type === 'list') return raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (type === 'json') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

/** The default value as the text field shows it. */
export function defaultText(value: unknown, type: VariableType): string {
  if (value === undefined || value === null) return '';
  if (type === 'list' && Array.isArray(value)) return value.join(', ');
  if (type === 'json' && typeof value !== 'string') return JSON.stringify(value);
  return String(value);
}

/** The default as the variables table shows it: `main`, `false`, `[ ]`, `3 keys`, or null for none. */
export function defaultPreview(value: unknown, type: VariableType): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.length === 0 ? '[ ]' : value.join(', ');
  if (type === 'json' && typeof value === 'object') {
    const n = Object.keys(value as Record<string, unknown>).length;
    return `${n} ${n === 1 ? 'key' : 'keys'}`;
  }
  return String(value);
}

/** A fresh `variableN` name. */
export function nextVariableName(variables: readonly VariableDefinition[]): string {
  const taken = new Set(variables.map((v) => v.name));
  let counter = variables.length + 1;
  while (taken.has(`variable${counter}`)) counter++;
  return `variable${counter}`;
}

/** One field the Run dialog asks for at launch: the variable's label and its default, if any. */
export interface RunDialogField {
  name: string;
  label: string;
  defaultValue: string | null;
  required: boolean;
}

/** What the Run dialog asks for, in declaration order. */
export function runDialogFields(variables: readonly VariableDefinition[]): RunDialogField[] {
  return variables.map((v) => ({
    name: v.name,
    label: v.label?.trim() || v.name,
    defaultValue: typeof v.defaultValue === 'boolean' ? (v.defaultValue ? 'on' : 'off') : defaultPreview(v.defaultValue, v.type),
    required: v.required,
  }));
}
