// ────────────────────────────────────────────────────────────────
// Batch Data Parser — Parse CSV, JSON, JSONL into structured rows
// for automation batch mode iteration
// ────────────────────────────────────────────────────────────────

import type { BatchDataFormat, ParsedBatchData } from '../types/Automation.js';

/**
 * Phase 2, 2.20 — limits are overridable via env so operators can tune for
 * their dataset without forking shared. Invalid values fall back to defaults.
 */
function readLimitFromEnv(name: string, fallback: number): number {
  const raw = (typeof process !== 'undefined' ? process.env?.[name] : undefined) ?? '';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Maximum number of rows allowed in batch data (override: `GEN_BATCH_MAX_ROWS`) */
const MAX_ROW_COUNT = readLimitFromEnv('GEN_BATCH_MAX_ROWS', 10_000);

/** Maximum number of unique columns allowed (override: `GEN_BATCH_MAX_COLUMNS`) */
const MAX_COLUMN_COUNT = readLimitFromEnv('GEN_BATCH_MAX_COLUMNS', 100);

/** Reserved/dangerous property names that cannot be used as column names */
const RESERVED_NAMES = new Set([
  '__proto__', 'constructor', 'prototype', 'toString', 'valueOf',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  'toLocaleString',
]);

/** Validate a column/variable name is safe */
function isValidColumnName(name: string): boolean {
  if (!name || name.length > 100) return false;
  if (RESERVED_NAMES.has(name)) return false;
  // Allow alphanumeric, underscore, hyphen, dot (common in variable names)
  return /^[a-zA-Z_][a-zA-Z0-9_.\-]*$/.test(name);
}

/** Strip UTF-8 BOM if present */
function stripBOM(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

/**
 * Parse raw batch data in the given format into structured rows.
 * Each row is a Record of column → value, ready for variable injection.
 */
export function parseBatchData(format: BatchDataFormat, rawData: string): ParsedBatchData {
  const trimmed = stripBOM(rawData.trim());
  if (!trimmed) {
    return { columns: [], rows: [], rowCount: 0 };
  }

  let result: ParsedBatchData;
  switch (format) {
    case 'json':
      result = parseJSONArray(trimmed);
      break;
    case 'csv':
      result = parseCSV(trimmed);
      break;
    case 'jsonl':
      result = parseJSONL(trimmed);
      break;
    default:
      throw new Error(`Unsupported batch data format: ${String(format)}`);
  }

  // Enforce limits
  if (result.rowCount > MAX_ROW_COUNT) {
    throw new Error(`Batch data exceeds maximum of ${MAX_ROW_COUNT} rows (got ${result.rowCount})`);
  }
  if (result.columns.length > MAX_COLUMN_COUNT) {
    throw new Error(`Batch data exceeds maximum of ${MAX_COLUMN_COUNT} columns (got ${result.columns.length})`);
  }

  // Validate column names are safe (prevent prototype pollution)
  for (const col of result.columns) {
    if (!isValidColumnName(col)) {
      throw new Error(`Invalid column name "${col}": must start with letter or underscore, contain only alphanumeric/underscore characters, and not use reserved names`);
    }
  }

  if (result.rowCount === 0) {
    throw new Error('Batch data must contain at least one row');
  }

  return result;
}

/**
 * Parse a JSON array of objects.
 * Supports: [{"col1": "val1", "col2": 2}, ...] or ["simple", "array"] (auto-wraps primitives)
 */
function parseJSONArray(text: string): ParsedBatchData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON: unable to parse batch data as JSON array');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Batch data must be a JSON array');
  }

  if (parsed.length === 0) {
    return { columns: [], rows: [], rowCount: 0 };
  }

  if (parsed.length > MAX_ROW_COUNT) {
    throw new Error(`JSON array exceeds maximum of ${MAX_ROW_COUNT} items (got ${parsed.length})`);
  }

  // If items are objects, use them directly; if primitives, wrap as { value: item }
  const rows: Record<string, unknown>[] = parsed.map((item, idx) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return item as Record<string, unknown>;
    }
    return { value: item, _index: idx };
  });

  const columns = detectColumns(rows);
  return { columns, rows, rowCount: rows.length };
}

/**
 * Parse CSV text with the first line as headers.
 * Handles: quoted fields, commas within quotes, escaped quotes ("").
 */
function parseCSV(text: string): ParsedBatchData {
  const lines = splitCSVLines(text);
  if (lines.length === 0) {
    return { columns: [], rows: [], rowCount: 0 };
  }

  const headers = parseCSVLine(lines[0]!).map((h) => h.trim());

  if (headers.length === 0 || headers.every((h) => h === '')) {
    throw new Error('CSV must have a header row with column names');
  }

  if (headers.length > MAX_COLUMN_COUNT) {
    throw new Error(`CSV exceeds maximum of ${MAX_COLUMN_COUNT} columns (got ${headers.length})`);
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (rows.length >= MAX_ROW_COUNT) {
      throw new Error(`CSV exceeds maximum of ${MAX_ROW_COUNT} rows`);
    }
    const line = lines[i]!.trim();
    if (!line) continue; // Skip empty lines

    const values = parseCSVLine(line);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (!header) continue;
      const raw = values[j]?.trim() ?? '';
      row[header] = coerceValue(raw);
    }
    rows.push(row);
  }

  return { columns: headers.filter(Boolean), rows, rowCount: rows.length };
}

/**
 * Parse JSONL (JSON Lines) — one JSON object per line.
 */
function parseJSONL(text: string): ParsedBatchData {
  const lines = text.split('\n').filter((line) => line.trim() !== '');

  if (lines.length > MAX_ROW_COUNT) {
    throw new Error(`JSONL exceeds maximum of ${MAX_ROW_COUNT} lines (got ${lines.length})`);
  }

  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]!);
    } catch {
      throw new Error(`Invalid JSON on line ${i + 1}: unable to parse`);
    }

    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rows.push(parsed as Record<string, unknown>);
    } else {
      rows.push({ value: parsed, _index: i });
    }
  }

  const columns = detectColumns(rows);
  return { columns, rows, rowCount: rows.length };
}

/**
 * Detect all unique column names from an array of row objects.
 * Preserves insertion order from the first occurrence of each key.
 */
function detectColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

/**
 * Resolve iteration variables for a single batch row.
 * Merges: base variables + mapped row fields + iteration metadata.
 * Validates variable names to prevent prototype pollution.
 */
export function resolveIterationVariables(
  row: Record<string, unknown>,
  columnMapping: Record<string, string> | undefined,
  baseVariables: Record<string, unknown>,
  iterationIndex: number,
  totalIterations: number,
): Record<string, unknown> {
  const resolvedRow: Record<string, unknown> = Object.create(null);

  // Apply column mapping: map column names to variable names
  for (const [col, val] of Object.entries(row)) {
    const varName = columnMapping?.[col] ?? col;
    // Skip reserved/dangerous property names
    if (RESERVED_NAMES.has(varName)) continue;
    resolvedRow[varName] = val;
  }

  return {
    ...baseVariables,
    ...resolvedRow,
    __iteration_index: iterationIndex,
    __iteration_total: totalIterations,
  };
}

/**
 * Build iteration label — a human-readable summary of the row for UI display.
 * Uses the first non-internal column value, or falls back to "Iteration N".
 */
export function buildIterationLabel(
  row: Record<string, unknown>,
  iterationIndex: number,
): string {
  const displayKeys = Object.keys(row).filter((k) => !k.startsWith('_'));
  if (displayKeys.length === 0) return `Iteration ${iterationIndex + 1}`;

  const firstKey = displayKeys[0]!;
  const firstVal = row[firstKey];
  const label = String(firstVal ?? '').slice(0, 80);
  if (displayKeys.length === 1) return label || `Iteration ${iterationIndex + 1}`;

  return `${firstKey}=${label}`;
}

// ── CSV Helpers ──

/** Split CSV text into logical lines (handling multi-line quoted fields) */
function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++; // Skip \r\n
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current) lines.push(current);
  return lines;
}

/** Parse a single CSV line into fields, handling quoted values */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }

  fields.push(current);
  return fields;
}

/** Coerce a string value to its most likely type */
function coerceValue(raw: string): unknown {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;

  // Try number
  const num = Number(raw);
  if (!Number.isNaN(num) && raw !== '') return num;

  return raw;
}
