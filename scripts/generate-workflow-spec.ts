#!/usr/bin/env tsx
/**
 * Workflow-spec generator (workflow overhaul, R-6; P01 WP-1.5).
 *
 * Derives, from the zod schemas in `@generatorai/workflow-spec`:
 *   - packages/workflow-spec/generated/*.schema.json (JSON Schema: the
 *     workflow document, the invocation request, run commands and
 *     validation issues);
 *   - docs/workflow-overhaul/generated/FIELDS.md (every field with its type,
 *     default and description, the Expression v2 grammar, the validation
 *     codes and the state tables).
 * With `--check` it writes nothing and fails when the committed files
 * differ from a fresh generation (line endings ignored), the same contract
 * as `scripts/generate-schemas.ts`. `pnpm lint` runs the check.
 *
 * Why `zod-to-json-schema`: the monorepo's schemas are zod 3 (3.25.x). zod
 * 4's native `z.toJSONSchema()` only accepts zod 4 schemas, so it cannot
 * convert them. The root pins `zod` ^3.25.76 so the converter's zod peer
 * resolves to the same zod 3 the schemas use. If the monorepo moves to zod
 * 4, switch to `z.toJSONSchema()` and drop the dependency.
 *
 * Usage:
 *   pnpm generate:workflow-spec          # write generated artifacts
 *   pnpm generate:workflow-spec --check  # fail if committed artifacts drift
 *
 * Exit codes:
 *   0  generated (or, in --check mode, nothing drifted)
 *   1  --check found drift
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFieldsMarkdown, toJSONSchema } from '../packages/workflow-spec/src/jsonschema.ts';

const check = process.argv.includes('--check');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function outputs(): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  for (const [name, schema] of Object.entries(toJSONSchema())) {
    files.push({ path: resolve(repoRoot, 'packages/workflow-spec/generated', name), content: `${JSON.stringify(schema, null, 2)}\n` });
  }
  files.push({ path: resolve(repoRoot, 'docs/workflow-overhaul/generated/FIELDS.md'), content: renderFieldsMarkdown() });
  return files;
}

const normalise = (s: string) => s.replace(/\r\n/g, '\n');

function main(): number {
  const drift: string[] = [];
  for (const f of outputs()) {
    const rel = relative(repoRoot, f.path).replace(/\\/g, '/');
    if (check) {
      const current = existsSync(f.path) ? readFileSync(f.path, 'utf8') : null;
      if (current === null || normalise(current) !== normalise(f.content)) drift.push(rel);
      continue;
    }
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.content);
    console.log(`[generate-workflow-spec] wrote ${rel}`);
  }
  if (check) {
    if (drift.length) {
      console.error(`[generate-workflow-spec] out of date: ${drift.join(', ')}\nRun: pnpm generate:workflow-spec`);
      return 1;
    }
    console.log('[generate-workflow-spec] check: generated files are up to date');
  }
  return 0;
}

process.exit(main());
