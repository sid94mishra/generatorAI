// ────────────────────────────────────────────────────────────────
// DB-01 — Drizzle-Kit configuration
//
// Enables versioned migration files in `packages/db/migrations/` generated
// from the live Drizzle schema. Existing deployments continue to use the
// boot-time idempotent `migrateDB()` (see `src/index.ts`) — this config
// lets us graduate forward: new schema changes ship as Drizzle-Kit SQL
// files, and `migrateDB()` stays as the backward-compatible fallback
// until every deployment has been brought up to the current baseline.
//
// Workflow:
//   pnpm --filter @generatorai/db db:generate   # diff schema → new SQL migration
//   pnpm --filter @generatorai/db db:check      # verify migration history
//   pnpm --filter @generatorai/db db:push       # apply to a dev DB
//
// Runtime application of these files isn't wired up yet (the boot-time
// migrator still runs first); that cutover is tracked as a future task.
// ────────────────────────────────────────────────────────────────

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    // Placeholder — overridden by `DB_PATH` env var for pnpm db:push.
    // Generation (`db:generate`) doesn't need a live DB.
    url: process.env['DB_PATH'] ?? './dev.db',
  },
  // Each snapshot goes into `migrations/meta/`; review the generated SQL
  // before committing so we don't accidentally ship a destructive ALTER.
  verbose: true,
  strict: true,
});
