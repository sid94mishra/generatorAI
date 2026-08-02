// ────────────────────────────────────────────────────────────────
// IterationPlanner — Track C
//   Parses a user-supplied AutomationDataset, validates it against the
//   automation's DataSchema, and expands it into a stream of iteration
//   variable-bags according to the IterationMode. Consumed by
//   AutomationService.runExecution and by the preview endpoint.
// ────────────────────────────────────────────────────────────────

import {
  parseBatchData,
  ValidationError,
  type AutomationDataset,
  type BatchDataFormat,
  type DataFieldDef,
  type DataSchema,
  type IterationMode,
  type PlannedIterations,
  type ParsedBatchData,
} from '@generatorai/shared';

/** Reserved variable names we never let a user field override. Match
 *  the semantics we already use elsewhere in variable interpolation. */
const RESERVED_VARIABLE_NAMES = new Set([
  '__proto__', 'constructor', 'prototype',
  '__iteration_index', '__iteration_total',
]);

/** Regex enforced on generated / user-supplied variable names. */
const VARIABLE_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Default group/dataset variable name if `IterationMode` didn't set one. */
const DEFAULT_GROUP_VARIABLE = 'items';

/** Maximum iterations we will plan from a single dataset. Prevents
 *  runaway blow-ups from mistyped datasets. Matches the row limit in
 *  parseBatchData for consistency. */
const MAX_PLANNED_ITERATIONS = 10_000;

/** Human-readable label used in the UI. Truncated to keep list rows compact. */
function labelForRow(
  row: Record<string, unknown>,
  index: number,
  primaryKey?: string,
): string {
  if (primaryKey && row[primaryKey] !== undefined && row[primaryKey] !== null) {
    return `${primaryKey}=${String(row[primaryKey]).slice(0, 80)}`;
  }
  return `Row ${index + 1}`;
}

/** Compact label for a group-by iteration: `"field1=v1, field2=v2"`. */
function labelForGroup(
  fields: string[],
  key: Record<string, unknown>,
): string {
  return fields
    .map((f) => `${f}=${String(key[f] ?? '').slice(0, 40)}`)
    .join(', ');
}

/** Map `DataSchema.format` → `parseBatchData` format enum. */
function normaliseFormat(format: DataSchema['format']): BatchDataFormat {
  // parseBatchData uses 'json' where the DataSchema uses 'json_array'
  return format === 'json_array' ? 'json' : format;
}

/** Coerce a raw parsed value into the declared field type where safe. */
function coerceValue(
  raw: unknown,
  field: DataFieldDef,
  warnings: string[],
  rowIndex: number,
): unknown {
  if (raw === null || raw === undefined) {
    return field.defaultValue ?? undefined;
  }

  switch (field.type) {
    case 'string': {
      if (typeof raw === 'string') return raw;
      const coerced = String(raw);
      warnings.push(`Row ${rowIndex + 1} field "${field.name}": coerced ${typeof raw} to string`);
      return coerced;
    }
    case 'number': {
      if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
      const parsed = typeof raw === 'string' ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) return parsed;
      throw new ValidationError(
        `Row ${rowIndex + 1} field "${field.name}" is not a number: ${JSON.stringify(raw)}`,
      );
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'string') {
        const lower = raw.trim().toLowerCase();
        if (lower === 'true' || lower === '1' || lower === 'yes') return true;
        if (lower === 'false' || lower === '0' || lower === 'no') return false;
      }
      if (typeof raw === 'number') return raw !== 0;
      throw new ValidationError(
        `Row ${rowIndex + 1} field "${field.name}" is not a boolean: ${JSON.stringify(raw)}`,
      );
    }
    case 'date': {
      if (raw instanceof Date) return raw.toISOString();
      const asDate = new Date(String(raw));
      if (!Number.isNaN(asDate.getTime())) return asDate.toISOString();
      throw new ValidationError(
        `Row ${rowIndex + 1} field "${field.name}" is not a valid date: ${JSON.stringify(raw)}`,
      );
    }
    case 'json': {
      // Pass through as-is; strings that look like JSON are decoded.
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            return JSON.parse(trimmed);
          } catch {
            /* fallthrough — keep as string */
          }
        }
      }
      return raw;
    }
    default:
      return raw;
  }
}

/**
 * Validate a single parsed row against the schema, coercing types
 * where safe and populating defaults for missing optional fields.
 * Throws on required-field violations or unrecoverable type mismatches.
 */
function validateRow(
  row: Record<string, unknown>,
  schema: DataSchema,
  rowIndex: number,
  warnings: string[],
): Record<string, unknown> {
  // NOTE: plain object literal (not `Object.create(null)`) — Drizzle's
  // better-sqlite3 JSON codec inspects `.constructor` when serializing and
  // fails on prototype-less objects with "Cannot read properties of null".
  // Prototype-pollution keys are already blocked via RESERVED_VARIABLE_NAMES
  // + VARIABLE_NAME_REGEX at every insertion site.
  const validated: Record<string, unknown> = {};
  const knownFieldNames = new Set<string>();

  for (const field of schema.fields) {
    knownFieldNames.add(field.name);
    const required = field.required !== false; // default true
    const present = Object.prototype.hasOwnProperty.call(row, field.name);
    const raw = present ? row[field.name] : undefined;

    if (!present || raw === null || raw === undefined || raw === '') {
      if (required && field.defaultValue === undefined) {
        throw new ValidationError(
          `Row ${rowIndex + 1} is missing required field "${field.name}"`,
        );
      }
      if (field.defaultValue !== undefined) {
        validated[field.name] = field.defaultValue;
      }
      continue;
    }

    const coerced = coerceValue(raw, field, warnings, rowIndex);

    if (field.type === 'string' && field.enum && field.enum.length > 0) {
      if (!field.enum.includes(String(coerced))) {
        throw new ValidationError(
          `Row ${rowIndex + 1} field "${field.name}" must be one of ` +
          `[${field.enum.join(', ')}] but got "${String(coerced)}"`,
        );
      }
    }

    validated[field.name] = coerced;
  }

  // Warn about (but don't reject) extra fields — pass them through so
  // users can iterate on new columns without editing the schema.
  for (const key of Object.keys(row)) {
    if (!knownFieldNames.has(key) && VARIABLE_NAME_REGEX.test(key) && !RESERVED_VARIABLE_NAMES.has(key)) {
      validated[key] = row[key];
      warnings.push(`Row ${rowIndex + 1}: extra field "${key}" passed through`);
    }
  }

  return validated;
}

/**
 * Group validated rows by a tuple of field values. Order-preserving:
 * groups appear in the order their first row was encountered.
 */
function groupRows(
  rows: Record<string, unknown>[],
  fields: string[],
): Array<{ key: Record<string, unknown>; rows: Record<string, unknown>[] }> {
  const groups = new Map<string, { key: Record<string, unknown>; rows: Record<string, unknown>[] }>();
  for (const row of rows) {
    const keyObj: Record<string, unknown> = {};
    for (const f of fields) keyObj[f] = row[f];
    const keyStr = fields.map((f) => JSON.stringify(row[f] ?? null)).join('\u0000');
    let bucket = groups.get(keyStr);
    if (!bucket) {
      bucket = { key: keyObj, rows: [] };
      groups.set(keyStr, bucket);
    }
    bucket.rows.push(row);
  }
  return Array.from(groups.values());
}

/**
 * Merge `baseVariables` with a row's fields, injecting iteration
 * metadata. Reserved names in the row are dropped with a warning; the
 * user's row values take precedence over `baseVariables` for user-
 * declared fields but never override the reserved `__iteration_*` keys.
 */
function buildIterationVariables(
  baseVariables: Record<string, unknown>,
  rowVars: Record<string, unknown>,
  iterationIndex: number,
  iterationTotal: number,
): Record<string, unknown> {
  // Plain literal — see note in validateRow(). Prototype-pollution keys
  // are filtered by RESERVED_VARIABLE_NAMES + VARIABLE_NAME_REGEX below.
  const bag: Record<string, unknown> = {};
  // Base first so row-level values override.
  for (const [k, v] of Object.entries(baseVariables)) {
    if (RESERVED_VARIABLE_NAMES.has(k)) continue;
    if (!VARIABLE_NAME_REGEX.test(k)) continue;
    bag[k] = v;
  }
  for (const [k, v] of Object.entries(rowVars)) {
    if (RESERVED_VARIABLE_NAMES.has(k)) continue;
    if (!VARIABLE_NAME_REGEX.test(k)) continue;
    bag[k] = v;
  }
  bag['__iteration_index'] = iterationIndex;
  bag['__iteration_total'] = iterationTotal;
  return bag;
}

export interface PlanArgs {
  schema: DataSchema;
  mode: IterationMode;
  dataset: AutomationDataset;
  baseVariables?: Record<string, unknown>;
}

/**
 * Pure function that maps a schema + mode + dataset into a stream of
 * variable-bags ready to feed to `AutomationService`. All parsing and
 * validation errors are `ValidationError`.
 */
export function planIterations(args: PlanArgs): PlannedIterations {
  const { schema, mode, dataset, baseVariables = {} } = args;
  const warnings: string[] = [];

  let parsed: ParsedBatchData;
  try {
    parsed = parseBatchData(
      normaliseFormat(schema.format),
      dataset.data,
    );
  } catch (err) {
    // parseBatchData throws plain `Error` for malformed input; re-wrap
    // as ValidationError so the trigger / preview routes surface a
    // 400 instead of an opaque 5xx.
    throw new ValidationError(
      `Dataset parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed.rowCount === 0) {
    return { iterations: [], warnings, parsedRowCount: 0 };
  }

  if (parsed.rowCount > MAX_PLANNED_ITERATIONS) {
    throw new ValidationError(
      `Dataset produced ${parsed.rowCount} rows, exceeding the maximum of ${MAX_PLANNED_ITERATIONS}`,
    );
  }

  // Validate + coerce each row against the schema.
  const validatedRows: Record<string, unknown>[] = [];
  for (let i = 0; i < parsed.rows.length; i++) {
    validatedRows.push(validateRow(parsed.rows[i]!, schema, i, warnings));
  }

  // For group_by mode, verify grouping fields exist in the schema.
  if (mode.kind === 'group_by') {
    const declaredNames = new Set(schema.fields.map((f) => f.name));
    for (const f of mode.fields) {
      if (!declaredNames.has(f)) {
        throw new ValidationError(
          `group_by field "${f}" is not declared in the DataSchema`,
        );
      }
    }
  }

  const parsedRowCount = validatedRows.length;

  if (mode.kind === 'each_row') {
    const total = validatedRows.length;
    const iterations = validatedRows.map((row, idx) => ({
      variables: buildIterationVariables(baseVariables, row, idx, total),
      label: labelForRow(row, idx, schema.primaryKey),
    }));
    return { iterations, warnings, parsedRowCount };
  }

  if (mode.kind === 'group_by') {
    const groupVar = mode.groupVariable ?? DEFAULT_GROUP_VARIABLE;
    if (!VARIABLE_NAME_REGEX.test(groupVar) || RESERVED_VARIABLE_NAMES.has(groupVar)) {
      throw new ValidationError(
        `Invalid groupVariable "${groupVar}" — must be a valid identifier`,
      );
    }
    const groups = groupRows(validatedRows, mode.fields);
    const total = groups.length;
    const iterations = groups.map((group, idx) => {
      // Group key fields promote to top-level variables so prompts
      // can reference them directly (e.g. `{{priority}}`).
      const keyVars: Record<string, unknown> = {};
      for (const f of mode.fields) keyVars[f] = group.key[f];
      const vars = buildIterationVariables(
        baseVariables,
        keyVars,
        idx,
        total,
      );
      vars[groupVar] = group.rows;
      return {
        variables: vars,
        label: labelForGroup(mode.fields, group.key),
      };
    });
    return { iterations, warnings, parsedRowCount };
  }

  if (mode.kind === 'single') {
    const datasetVar = mode.datasetVariable ?? DEFAULT_GROUP_VARIABLE;
    if (!VARIABLE_NAME_REGEX.test(datasetVar) || RESERVED_VARIABLE_NAMES.has(datasetVar)) {
      throw new ValidationError(
        `Invalid datasetVariable "${datasetVar}" — must be a valid identifier`,
      );
    }
    const vars = buildIterationVariables(baseVariables, {}, 0, 1);
    vars[datasetVar] = validatedRows;
    return {
      iterations: [{ variables: vars, label: `Full dataset (${parsedRowCount} rows)` }],
      warnings,
      parsedRowCount,
    };
  }

  // Exhaustive check — TypeScript will flag missing cases.
  const _exhaustive: never = mode;
  return _exhaustive;
}

/**
 * Convenience wrapper that runs `planIterations` and caps the returned
 * iterations at 5. Used by the `POST /api/automations/preview-iterations`
 * endpoint and the UI's schema-editor preview panel.
 */
export function previewIterations(args: PlanArgs): {
  iterations: PlannedIterations['iterations'];
  totalIterations: number;
  parsedRowCount: number;
  warnings: string[];
} {
  const planned = planIterations(args);
  return {
    iterations: planned.iterations.slice(0, 5),
    totalIterations: planned.iterations.length,
    parsedRowCount: planned.parsedRowCount,
    warnings: planned.warnings,
  };
}
