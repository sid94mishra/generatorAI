#!/usr/bin/env tsx
/**
 * Template generator (workflow overhaul P05 WP-5A.1, ground rule 2).
 *
 * The loop templates are not hand-written: each is generated from a preset
 * of `@generatorai/workflow-spec/presets` (a template function that emits
 * plain stage and edge JSON over the generic kinds) and written to
 * `templates/system/<id>-workflow.json`, where the TemplateRegistry loads
 * it like any other template. With `--check` it writes nothing and fails
 * when a committed file differs from a fresh generation (line endings
 * ignored); `pnpm lint` runs the check.
 *
 * Usage:
 *   pnpm generate:templates          # write the generated templates
 *   pnpm generate:templates --check  # fail if they drifted
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { presetTemplates } from '../packages/workflow-spec/src/presets/index.ts';

const check = process.argv.includes('--check');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const normalise = (s: string) => s.replace(/\r\n/g, '\n');

function main(): number {
  const drift: string[] = [];
  for (const t of presetTemplates()) {
    const path = resolve(repoRoot, 'templates/system', `${t.id}-workflow.json`);
    const content = `${JSON.stringify({ id: t.id, category: t.category, graph: t.graph }, null, 2)}\n`;
    const rel = relative(repoRoot, path).replace(/\\/g, '/');
    if (check) {
      const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (current === null || normalise(current) !== normalise(content)) drift.push(rel);
      continue;
    }
    writeFileSync(path, content);
    console.log(`[generate-templates] wrote ${rel}`);
  }
  if (check) {
    if (drift.length) {
      console.error(`[generate-templates] out of date: ${drift.join(', ')}\nRun: pnpm generate:templates`);
      return 1;
    }
    console.log('[generate-templates] check: generated templates are up to date');
  }
  return 0;
}

process.exit(main());
