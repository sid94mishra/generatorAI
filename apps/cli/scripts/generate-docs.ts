// ────────────────────────────────────────────────────────────────
// Regenerates the command tables in .github/docs/usage-cli.md from the
// registry, so the docs can never drift from the code again.
//
//   pnpm --filter @generatorai/cli docs           # write
//   pnpm --filter @generatorai/cli docs --check   # fail if stale (CI)
// ────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  applyKeymapDocs,
  buildRegistry,
  DEFAULT_KEYMAP,
  toDocs,
  toKeymapDocs,
  DOCS_START,
  DOCS_END,
} from '@generatorai/cli-core';

const here = dirname(fileURLToPath(import.meta.url));
const docPath = resolve(here, '../../../.github/docs/usage-cli.md');

const registry = buildRegistry();
const generated = toDocs(registry);

const original = readFileSync(docPath, 'utf8');
const start = original.indexOf(DOCS_START);
const end = original.indexOf(DOCS_END);

if (start === -1 || end === -1) {
  process.stderr.write(
    `usage-cli.md is missing the generated-command markers.\n` +
      `Add these two lines where the command tables belong:\n\n${DOCS_START}\n${DOCS_END}\n`,
  );
  process.exit(2);
}

// Two generated regions: the command tables and the keymap. The keymap
// used to be hand-written and described a TUI that had not existed since
// the workbench rewrite (open question #8) — hand-writing it is the
// reason it drifted.
const next = applyKeymapDocs(
  original.slice(0, start) + generated + original.slice(end + DOCS_END.length),
  toKeymapDocs(DEFAULT_KEYMAP),
);

if (process.argv.includes('--check')) {
  if (next !== original) {
    process.stderr.write(
      'usage-cli.md is out of date with the command registry.\n' +
        'Run `pnpm --filter @generatorai/cli docs` and commit the result.\n',
    );
    process.exit(1);
  }
  process.stdout.write('usage-cli.md is up to date.\n');
  process.exit(0);
}

writeFileSync(docPath, next, 'utf8');
process.stdout.write(
  `usage-cli.md updated — ${registry.all().length} commands across ${registry.groupList().length} groups.\n`,
);
