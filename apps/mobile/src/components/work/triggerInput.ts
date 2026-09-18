// ────────────────────────────────────────────────────────────────
// Trigger inputs — the pure half of TriggerInputSheet.
//
// A schema-driven automation takes a dataset at trigger time:
// `{ format: 'json_array' | 'csv' | 'jsonl', data: string }`
// (AutomationDatasetSchema). The SERVER parses and validates rows against
// the automation's DataSchema; this module does a light pre-flight so an
// obvious mistake (unparseable JSON, a missing required column) is reported
// in the sheet instead of as a 400 after the tap.
//
// Tested in src/__tests__/triggerInput.test.ts.
// ────────────────────────────────────────────────────────────────

export type DatasetFormat = 'json_array' | 'csv' | 'jsonl';

export const DATASET_FORMATS: readonly DatasetFormat[] = ['json_array', 'csv', 'jsonl'];

export const DATASET_FORMAT_LABEL: Record<DatasetFormat, string> = {
  json_array: 'JSON',
  csv: 'CSV',
  jsonl: 'JSONL',
};

/** Server-side cap (AutomationDatasetSchema.data max). */
export const DATASET_MAX_CHARS = 5_000_000;

export interface SchemaFieldView {
  name: string;
  type?: string;
  required: boolean;
}

export interface DatasetCheck {
  ok: boolean;
  /** Rows parsed, when the text could be parsed at all. */
  rowCount: number | null;
  /** Blocking problems. */
  errors: string[];
}

function isDatasetFormat(value: unknown): value is DatasetFormat {
  return typeof value === 'string' && (DATASET_FORMATS as readonly string[]).includes(value);
}

/** The declared fields of an automation's `dataSchema`, read defensively. */
export function schemaFieldsOf(dataSchema: unknown): SchemaFieldView[] {
  if (!dataSchema || typeof dataSchema !== 'object') return [];
  const fields = (dataSchema as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  const out: SchemaFieldView[] = [];
  for (const f of fields) {
    if (!f || typeof f !== 'object') continue;
    const name = (f as { name?: unknown }).name;
    if (typeof name !== 'string' || !name) continue;
    const type = (f as { type?: unknown }).type;
    out.push({
      name,
      ...(typeof type === 'string' ? { type } : {}),
      // DataFieldDef: `required` defaults to true.
      required: (f as { required?: unknown }).required !== false,
    });
  }
  return out;
}

/** The format the schema declares, else JSON. */
export function schemaFormatOf(dataSchema: unknown): DatasetFormat {
  const format = dataSchema && typeof dataSchema === 'object' ? (dataSchema as { format?: unknown }).format : undefined;
  return isDatasetFormat(format) ? format : 'json_array';
}

/** The saved default dataset, when the automation has a usable one. */
export function defaultDatasetOf(raw: unknown): { format: DatasetFormat; data: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { format, data } = raw as { format?: unknown; data?: unknown };
  if (typeof data !== 'string' || !data.trim()) return null;
  return { format: isDatasetFormat(format) ? format : 'json_array', data };
}

/** Guess the format from a picked file's name; null when the name says nothing. */
export function formatFromFileName(name: string): DatasetFormat | null {
  const lower = name.trim().toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl';
  if (lower.endsWith('.json')) return 'json_array';
  return null;
}

/** One CSV line split on commas, honouring double-quoted cells. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

function parseRows(format: DatasetFormat, text: string): { rows: Record<string, unknown>[] } | { error: string } {
  if (format === 'json_array') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!Array.isArray(parsed)) return { error: 'JSON must be an array of rows, like [{"name": "a"}].' };
    const bad = parsed.findIndex((r) => !r || typeof r !== 'object' || Array.isArray(r));
    if (bad >= 0) return { error: `Row ${bad + 1} is not an object.` };
    return { rows: parsed as Record<string, unknown>[] };
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (format === 'jsonl') {
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i]!);
      } catch {
        return { error: `Line ${i + 1} is not valid JSON.` };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: `Line ${i + 1} is not a JSON object.` };
      }
      rows.push(parsed as Record<string, unknown>);
    }
    return { rows };
  }
  // CSV: first line is the header.
  if (lines.length === 0) return { rows: [] };
  const header = splitCsvLine(lines[0]!);
  if (header.some((h) => !h)) return { error: 'The CSV header has an empty column name.' };
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, unknown> = {};
    header.forEach((h, i) => {
      if (cells[i] !== undefined && cells[i] !== '') row[h] = cells[i];
    });
    return row;
  });
  return { rows };
}

/**
 * Pre-flight a dataset. Blank text is only OK when the automation has a
 * saved default the server can fall back on (`allowEmpty`).
 */
export function checkDataset(
  format: DatasetFormat,
  text: string,
  fields: readonly SchemaFieldView[],
  options: { allowEmpty?: boolean } = {},
): DatasetCheck {
  if (!text.trim()) {
    return options.allowEmpty
      ? { ok: true, rowCount: null, errors: [] }
      : { ok: false, rowCount: null, errors: ['Paste or pick a dataset to run with.'] };
  }
  if (text.length > DATASET_MAX_CHARS) {
    return { ok: false, rowCount: null, errors: ['The dataset is larger than the 5 MB the server accepts.'] };
  }
  const parsed = parseRows(format, text);
  if ('error' in parsed) return { ok: false, rowCount: null, errors: [parsed.error] };
  const { rows } = parsed;
  if (rows.length === 0) return { ok: false, rowCount: 0, errors: ['The dataset has no rows.'] };

  const errors: string[] = [];
  const required = fields.filter((f) => f.required).map((f) => f.name);
  for (const name of required) {
    const missingAt = rows.findIndex((r) => r[name] === undefined || r[name] === null || r[name] === '');
    if (missingAt >= 0) {
      errors.push(`Row ${missingAt + 1} is missing required field "${name}".`);
      if (errors.length >= 3) break;
    }
  }
  return { ok: errors.length === 0, rowCount: rows.length, errors };
}

/** A placeholder showing the expected shape, built from the schema fields. */
export function datasetPlaceholder(format: DatasetFormat, fields: readonly SchemaFieldView[]): string {
  const names = fields.length > 0 ? fields.slice(0, 3).map((f) => f.name) : ['name', 'priority'];
  const sample = Object.fromEntries(names.map((n) => [n, '…']));
  if (format === 'csv') return `${names.join(',')}\n${names.map(() => '…').join(',')}`;
  if (format === 'jsonl') return JSON.stringify(sample);
  return `[\n  ${JSON.stringify(sample)}\n]`;
}
