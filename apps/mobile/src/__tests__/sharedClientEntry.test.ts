// ────────────────────────────────────────────────────────────────
// Guard for the `@generatorai/shared` → `shared/src/client.ts` Metro alias.
//
// `tsc` checks the phone against the FULL shared barrel, but Metro bundles
// the client entry. A value that exists in the barrel and not in the entry
// would type-check and then be `undefined` on the device. This test walks
// every client package the phone bundles, collects the VALUE imports from
// `@generatorai/shared`, and asserts the client entry exports each one.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import * as clientEntry from '../../../../packages/shared/src/client';

const ROOT = path.resolve(__dirname, '../../../..');
const CLIENT_GRAPH = [
  'packages/client-core/src',
  'packages/client-runtime/src',
  'packages/client-transport/src',
  'packages/relay-protocol/src',
  'packages/design-tokens/src',
  'apps/mobile/src',
  'apps/mobile/app',
];

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
}

function valueImportsFromShared(): Map<string, string[]> {
  const files: string[] = [];
  for (const rel of CLIENT_GRAPH) {
    const dir = path.join(ROOT, rel);
    if (fs.existsSync(dir)) walk(dir, files);
  }
  const bySymbol = new Map<string, string[]>();
  const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@generatorai\/shared['"]/g;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      if (m[1]) continue; // `import type { … }` — erased
      for (const raw of (m[2] ?? '').split(',')) {
        const spec = raw.trim();
        if (!spec || spec.startsWith('type ')) continue;
        const name = spec.split(/\s+as\s+/)[0]!.trim();
        const list = bySymbol.get(name) ?? [];
        list.push(path.relative(ROOT, file));
        bySymbol.set(name, list);
      }
    }
    // Namespace / default imports would defeat the static check — forbid them.
    expect(source, `${file} must not namespace-import @generatorai/shared`).not.toMatch(
      /import\s+\*\s+as\s+\w+\s+from\s+['"]@generatorai\/shared['"]/,
    );
  }
  return bySymbol;
}

describe('@generatorai/shared client entry', () => {
  it('exports every value the phone bundle imports from the barrel', () => {
    const wanted = valueImportsFromShared();
    const exported = new Set(Object.keys(clientEntry));
    const missing = [...wanted.entries()]
      .filter(([name]) => !exported.has(name))
      .map(([name, files]) => `${name} (used by ${files.join(', ')})`);
    expect(missing, `add these to packages/shared/src/client.ts:\n${missing.join('\n')}`).toEqual([]);
  });

  it('does not reach any server-only module', () => {
    // Static: the entry file's own import lines.
    const entrySource = fs.readFileSync(path.join(ROOT, 'packages/shared/src/client.ts'), 'utf8');
    for (const forbidden of ['./config/', './ipc/', './telemetry/', './logging/', './node', './builders/']) {
      expect(entrySource, `client.ts must not import ${forbidden}`).not.toContain(`from '${forbidden}`);
    }
    // Runtime: importing the entry must not have loaded pino or OpenTelemetry.
    const loaded = Object.keys(require.cache ?? {}).map((p) => p.split('\\').join('/'));
    expect(loaded.filter((p) => /node_modules\/(pino|@opentelemetry)\//.test(p))).toEqual([]);
  });
});
