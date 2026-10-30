// Workflow settings' pure parts (M8-07; MWorkflowSettings; MDF-89): the sections, a variable name's problem
// (identifier, reserved roots and system prefixes, taken), the row summary ("String · required", the default),
// and the default value's text form per type (and back, with the type's error). Unit-tested.
import { FORBIDDEN_VARIABLE_NAME_PATTERN, RESERVED_ROOTS, VARIABLE_NAME_PATTERN, type VariableDefinition, type VariableType } from '@generatorai/workflow-spec';

export const SETTINGS_SECTIONS = ['general', 'project', 'variables', 'hooks', 'tags', 'budget'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SECTION_LABEL: Record<SettingsSection, string> = { general: 'General', project: 'Project', variables: 'Variables', hooks: 'Hooks', tags: 'Tags', budget: 'Budget' };

export function parseSettingsSection(raw: unknown): SettingsSection | null {
  return (SETTINGS_SECTIONS as readonly unknown[]).includes(raw) ? (raw as SettingsSection) : null;
}

export const TYPE_LABEL: Record<VariableType, string> = { string: 'String', number: 'Number', boolean: 'Boolean', choice: 'Choice', text: 'Text', list: 'List', json: 'JSON' };

export const RESERVED_LINE = `Reserved: ${RESERVED_ROOTS.join(', ')}, and names starting __, repo_path_ or repo_branch_.`;

/** Why a name cannot be used, or null. */
export function variableNameProblem(name: string, taken: readonly string[]): string | null {
  if (!name) return 'A variable needs a name';
  if (!VARIABLE_NAME_PATTERN.test(name)) return 'Letters, digits and _, not starting with a digit';
  if ((RESERVED_ROOTS as readonly string[]).includes(name) || FORBIDDEN_VARIABLE_NAME_PATTERN.test(name)) return `${name} is reserved. Pick another name.`;
  if (name.length > 64) return 'At most 64 characters';
  if (taken.includes(name)) return `${name} is already a variable`;
  return null;
}

/** The default as one line for the row ("main", "3", "left-pad, …", `{ "majors"…`). */
export function defaultPreview(v: VariableDefinition): string | null {
  const d = v.defaultValue;
  if (d === undefined || d === null || d === '') return null;
  if (Array.isArray(d)) return d.join(', ');
  if (typeof d === 'object') return JSON.stringify(d);
  return String(d);
}

export function variableSummary(v: VariableDefinition): string {
  return `${TYPE_LABEL[v.type]}${v.required ? ' · required' : ''}`;
}

/** The default's editable text (list: one per line; json: pretty). */
export function defaultText(v: VariableDefinition): string {
  const d = v.defaultValue;
  if (d === undefined || d === null) return '';
  if (v.type === 'list' && Array.isArray(d)) return d.join('\n');
  if (v.type === 'json') return JSON.stringify(d, null, 2);
  return String(d);
}

/** Text → the default value for a type; `error` when it does not fit. Empty text = no default. */
export function parseDefault(type: VariableType, text: string, options?: readonly string[]): { value?: unknown; error?: string } {
  const t = text.trim();
  if (!t) return {};
  switch (type) {
    case 'number':
      return Number.isFinite(Number(t)) ? { value: Number(t) } : { error: 'Not a number' };
    case 'boolean':
      return t === 'true' || t === 'false' ? { value: t === 'true' } : { error: 'true or false' };
    case 'choice':
      return !options?.length || options.includes(t) ? { value: t } : { error: 'Not one of the options' };
    case 'list':
      return { value: text.split('\n').map((x) => x.trim()).filter(Boolean) };
    case 'json':
      try {
        return { value: JSON.parse(t) as unknown };
      } catch {
        return { error: 'Not valid JSON' };
      }
    default:
      return { value: type === 'text' ? text : t };
  }
}

/** Changing a variable's type keeps a default that still fits, else drops it. */
export function retype(v: VariableDefinition, type: VariableType): VariableDefinition {
  const text = defaultText(v);
  const parsed = parseDefault(type, type === 'list' ? text.replace(/,\s*/g, '\n') : text, v.options);
  const next: VariableDefinition = { ...v, type };
  if (parsed.error || parsed.value === undefined) delete next.defaultValue;
  else next.defaultValue = parsed.value;
  if (type !== 'choice') delete next.options;
  return next;
}
