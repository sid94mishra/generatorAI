// ────────────────────────────────────────────────────────────────
// variableForm — the pure half of the Start-run sheet.
//
// A workflow declares typed inputs (`graph.workflow.variables`,
// `VariableDefinitionSchema` of @generatorai/workflow-spec): string, text,
// number, boolean, choice, list (of strings), json — each with a label, optional default, `required`
// and `options`. The sheet edits every value as a STRING (or boolean) and
// this module turns that draft into the `variables` object the create-run
// route takes, reporting per-field errors instead of letting the server 400.
// ────────────────────────────────────────────────────────────────

export type VariableType = 'string' | 'number' | 'boolean' | 'choice' | 'text' | 'list' | 'json';

export interface VariableDefinition {
  name: string;
  type: VariableType;
  label: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
}

/** What the form holds: text for every field, a boolean for switches. */
export type DraftValue = string | boolean;
export type Draft = Record<string, DraftValue>;

const TYPES: readonly VariableType[] = ['string', 'number', 'boolean', 'choice', 'text', 'list', 'json'];

/**
 * Read the definition's `variables` defensively — the detail endpoint is
 * typed loosely on this client and older definitions may omit fields.
 * Internal (`__`-prefixed) names are runtime plumbing, never user inputs.
 */
export function parseVariables(raw: unknown): VariableDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: VariableDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    const name = typeof v['name'] === 'string' ? v['name'] : '';
    if (!name || name.startsWith('__')) continue;
    const type = TYPES.includes(v['type'] as VariableType) ? (v['type'] as VariableType) : 'string';
    const def: VariableDefinition = {
      name,
      type,
      label: typeof v['label'] === 'string' && v['label'] ? v['label'] : name,
      required: v['required'] === true,
    };
    if (typeof v['description'] === 'string' && v['description']) def.description = v['description'];
    if (v['defaultValue'] !== undefined) def.defaultValue = v['defaultValue'];
    if (Array.isArray(v['options'])) def.options = v['options'].filter((o): o is string => typeof o === 'string');
    out.push(def);
  }
  return out;
}

/** The initial draft: defaults where declared, the first option for a required choice. */
export function initialDraft(defs: readonly VariableDefinition[]): Draft {
  const draft: Draft = {};
  for (const def of defs) {
    const d = def.defaultValue;
    if (def.type === 'boolean') {
      draft[def.name] = d === true || d === 'true';
    } else if (def.type === 'list' && Array.isArray(d)) {
      draft[def.name] = d.join('\n');
    } else if (def.type === 'json' && d !== undefined) {
      draft[def.name] = JSON.stringify(d, null, 2);
    } else if (d !== undefined && d !== null) {
      draft[def.name] = String(d);
    } else if (def.type === 'choice' && def.required && def.options && def.options.length > 0) {
      draft[def.name] = def.options[0]!;
    } else {
      draft[def.name] = '';
    }
  }
  return draft;
}

export interface BuildResult {
  variables: Record<string, unknown>;
  /** Field name → message. Empty when the draft is valid. */
  errors: Record<string, string>;
  valid: boolean;
}

/** Validate and coerce the draft into the create-run `variables` payload. */
export function buildVariables(defs: readonly VariableDefinition[], draft: Draft): BuildResult {
  const variables: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const def of defs) {
    const raw = draft[def.name];

    if (def.type === 'boolean') {
      variables[def.name] = raw === true;
      continue;
    }

    const text = typeof raw === 'string' ? raw : '';
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      if (def.required) errors[def.name] = `${def.label} is required.`;
      // Optional and blank: omit, so the server applies its own default.
      continue;
    }

    if (def.type === 'number') {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        errors[def.name] = `${def.label} must be a number.`;
        continue;
      }
      variables[def.name] = n;
      continue;
    }

    if (def.type === 'list') {
      // One item per line.
      variables[def.name] = text.split('\n').map((x) => x.trim()).filter(Boolean);
      continue;
    }

    if (def.type === 'json') {
      try {
        variables[def.name] = JSON.parse(trimmed);
      } catch {
        errors[def.name] = `${def.label} must be valid JSON.`;
      }
      continue;
    }

    if (def.type === 'choice' && def.options && def.options.length > 0 && !def.options.includes(trimmed)) {
      errors[def.name] = `Pick one of the options for ${def.label}.`;
      continue;
    }

    // `text` keeps its internal whitespace/newlines; `string` is trimmed.
    variables[def.name] = def.type === 'text' ? text : trimmed;
  }

  return { variables, errors, valid: Object.keys(errors).length === 0 };
}
