# Database portability (DB-01)

GeneratorAI ships with **SQLite** (better-sqlite3 + Drizzle) as the only wired
driver. The architecture is kept "Postgres-ready" so a future driver is a
*config change*, not a rewrite. This file is the checklist for that day.

## The seam (already in place)

- **One factory switch.** All callers go through `createDB(input)` where
  `input` is a SQLite path (back-compat) **or** a `DatabaseConfig`
  (`{ driver, url }`). `resolveDatabaseConfig()` infers the driver from a URL
  scheme (`postgres://`, `libsql://`, else sqlite). `libsql`/`postgres` are
  recognized and throw an actionable "not yet wired" error — the door is open,
  no dependency added. See `packages/db/src/index.ts`.
- **Async transactions.** `withTransaction(db, fn)` is async-shaped
  (`fn: () => Promise<T>`); service code never sees the synchronous
  better-sqlite3 transaction semantics. A Postgres adapter can implement the
  same signature.
- **Portable query builder.** Repositories use Drizzle's query builder. The
  arithmetic/aggregate raw SQL in use (`version + 1`, `count(*)`, `ts < ?`) is
  ANSI-portable.

## To wire a non-SQLite driver, do these (and only these)

1. **Add the driver branch** in `createDB()` (`packages/db/src/index.ts`):
   build the Drizzle instance for `drizzle-orm/libsql` or
   `drizzle-orm/node-postgres`, add the dependency, and widen `AppDatabase` to
   the union. Adjust `closeDB()` / `withTransaction()` (they currently reach
   into `session.client` for the better-sqlite3 handle).
2. **Provide a dialect-specific migration runner.** `migrateDB()`
   (`packages/db/src/migrations/index.ts`) is SQLite-only: it uses
   `AUTOINCREMENT`, `INSERT OR IGNORE`, `PRAGMA`, and `ALTER TABLE ADD COLUMN`
   semantics. Keep the `_schema_versions` ledger; translate the DDL per dialect
   (or generate it with `drizzle-kit`).
3. **Replace the SQLite-only SQL** — the *only* two spots, both in
   `packages/db/src/repositories/ChatMessageRepository.ts`:
   - **`rowid` tiebreaker** (`getBySessionId`, `getByChatId`,
     `getBySessionAndStageRunId`): `ORDER BY timestamp, rowid` uses SQLite's
     hidden `rowid` to preserve same-second insertion order. Postgres has no
     `rowid`. Fix: add a monotonic column (e.g. a `BIGSERIAL seq` or
     insertion-ordered identity) and order by `(timestamp, seq)`.
   - **`json_extract`** (`getBySessionAndStageRunId`):
     `json_extract(metadata, '$.stageRunId')` is SQLite JSON1. Postgres
     equivalent: `metadata->>'stageRunId'` (jsonb). Abstract behind a tiny
     dialect helper or branch on driver.
4. **Verify JSON column handling.** Columns use Drizzle `mode:'json'` +
   `validateJsonColumn`/`safeJsonColumn`. On Postgres prefer `jsonb`; the
   symmetric validate/parse helpers stay the same.

That's the whole list. Everything else is dialect-agnostic.
