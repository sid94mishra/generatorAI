#!/usr/bin/env tsx
/**
 * Workflow-spec generator (workflow overhaul, R-6).
 *
 * P00 WP-0.4 scaffold. PHASE-01 WP-1.5 fills this in: it will derive the
 * JSON Schema, docs and authoring-skill references from the zod schemas in
 * `@generatorai/workflow-spec` (via `zod-to-json-schema`), write them under
 * `schemas/workflow/`, and with `--check` fail when the committed output
 * differs from a fresh generation — the same contract as
 * `scripts/generate-schemas.ts`.
 *
 * Until `@generatorai/workflow-spec` exists there is nothing to generate, so
 * both modes are a no-op that exits 0. It exists now so CI and `pnpm lint`
 * can wire the `--check` call once and never change it.
 *
 * Usage:
 *   pnpm generate:workflow-spec          # write generated artifacts
 *   pnpm generate:workflow-spec --check  # fail if committed artifacts drift
 *
 * Exit codes:
 *   0  generated (or, in --check mode, nothing drifted)
 *   1  --check found drift (from P01 on)
 */

const check = process.argv.includes('--check');

function main(): number {
  const mode = check ? 'check' : 'generate';
  console.log(`[generate-workflow-spec] ${mode}: no workflow-spec package yet (P00 scaffold); nothing to do.`);
  return 0;
}

process.exit(main());
