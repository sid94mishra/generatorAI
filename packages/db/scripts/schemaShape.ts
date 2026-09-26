// ────────────────────────────────────────────────────────────────
// Structural schema comparison (workflow overhaul P00 review R10/R11/R22).
//
// Raw `sqlite_master` text cannot be compared across install paths: an
// upgraded database's CREATE TABLE text carries every `ADD COLUMN` appended
// to it, while a fresh one has it inline. `schemaShape` reads what SQLite
// itself reports — columns (in order, with type, NOT NULL, default, pk),
// foreign keys and explicit indexes — and `diffShapes` names every
// difference as one stable string, so a test can pin an explicit drift
// allowlist and a later migration can empty it.
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';

export interface ColumnShape {
  name: string;
  type: string;
  notnull: number;
  dflt: string;
  pk: number;
}

export interface TableShape {
  columns: ColumnShape[];
  /** `from->table.to` */
  foreignKeys: string[];
}

export interface SchemaShape {
  tables: Map<string, TableShape>;
  /** Explicit (named, SQL-bearing) indexes: name → normalised CREATE text. */
  indexes: Map<string, string>;
}

const normSql = (sql: string) => sql.replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim().toLowerCase();

/** Virtual tables and their shadow tables (FTS5 `<vt>_data`, `_idx`, …). */
function shadowFilter(sqlite: Database.Database): (name: string) => boolean {
  const virtual = (
    sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'`)
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
  return (name) => virtual.some((v) => name.startsWith(`${v}_`));
}

export function schemaShape(sqlite: Database.Database): SchemaShape {
  const isShadow = shadowFilter(sqlite);
  const tables = new Map<string, TableShape>();
  const names = (
    sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<{ name: string }>
  )
    .map((r) => r.name)
    .filter((n) => !isShadow(n));
  for (const t of names) {
    const cols = sqlite.pragma(`table_info(${JSON.stringify(t)})`) as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;
    const fks = sqlite.pragma(`foreign_key_list(${JSON.stringify(t)})`) as Array<{ from: string; table: string; to: string | null }>;
    tables.set(t, {
      columns: cols.map((c) => ({
        name: c.name,
        type: c.type.toUpperCase(),
        notnull: c.notnull,
        dflt: c.dflt_value === null || c.dflt_value === undefined ? '' : String(c.dflt_value),
        pk: c.pk,
      })),
      foreignKeys: fks.map((f) => `${f.from}->${f.table}.${f.to ?? '(pk)'}`).sort(),
    });
  }
  const indexes = new Map<string, string>();
  for (const r of sqlite
    .prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`)
    .all() as Array<{ name: string; tbl_name: string; sql: string }>) {
    if (!isShadow(r.tbl_name)) indexes.set(r.name, normSql(r.sql));
  }
  return { tables, indexes };
}

/**
 * Every difference between two shapes, as sorted stable strings. `a` and
 * `b` are labels used in the output (e.g. 'upgraded' / 'fresh').
 */
export function diffShapes(a: SchemaShape, b: SchemaShape, labels: [string, string] = ['a', 'b']): string[] {
  const [la, lb] = labels;
  const out: string[] = [];
  for (const t of new Set([...a.tables.keys(), ...b.tables.keys()])) {
    const ta = a.tables.get(t);
    const tb = b.tables.get(t);
    if (!ta || !tb) {
      out.push(`table ${t}: only in ${ta ? la : lb}`);
      continue;
    }
    const ca = new Map(ta.columns.map((c) => [c.name, c]));
    const cb = new Map(tb.columns.map((c) => [c.name, c]));
    for (const name of new Set([...ca.keys(), ...cb.keys()])) {
      const x = ca.get(name);
      const y = cb.get(name);
      if (!x || !y) {
        out.push(`column ${t}.${name}: only in ${x ? la : lb}`);
        continue;
      }
      for (const field of ['type', 'notnull', 'dflt', 'pk'] as const) {
        if (x[field] !== y[field]) out.push(`column ${t}.${name}: ${field} ${la}=${x[field]} ${lb}=${y[field]}`);
      }
    }
    const shared = (cols: ColumnShape[], other: Map<string, ColumnShape>) =>
      cols.filter((c) => other.has(c.name)).map((c) => c.name).join(',');
    if (shared(ta.columns, cb) !== shared(tb.columns, ca)) out.push(`column-order ${t}`);
    for (const fk of new Set([...ta.foreignKeys, ...tb.foreignKeys])) {
      const inA = ta.foreignKeys.includes(fk);
      const inB = tb.foreignKeys.includes(fk);
      if (inA !== inB) out.push(`fk ${t} ${fk}: only in ${inA ? la : lb}`);
    }
  }
  for (const name of new Set([...a.indexes.keys(), ...b.indexes.keys()])) {
    const x = a.indexes.get(name);
    const y = b.indexes.get(name);
    if (!x || !y) out.push(`index ${name}: only in ${x ? la : lb}`);
    else if (x !== y) out.push(`index ${name}: definition differs`);
  }
  return out.sort();
}
