// P2-R11 — regression test for the `import.meta.url === \`file://${argv[1]}\``
// main-module guard bug fixed in agent-tests/vrt/seed.ts (mirrors
// scripts/redesign/vrt.mjs's own `isMain()`, which already used the correct
// pattern). The buggy comparison is a raw string template, not a URL: it
// mismatches whenever `process.argv[1]` and the module's real `file://` URL
// differ in ways a literal template never accounts for — a Windows drive
// letter (`file:///C:/…` vs `C:\…`), percent-encoding (a space becomes
// `%20`), or (reproduced below, on this machine) `os.tmpdir()` resolving
// through a symlink (macOS's `/var` → `/private/var`). Every one of those
// makes `main()` silently skip and the script exit 0 having done nothing.
//
// This spawns a real child process for each case — not a mock — so it
// exercises Node's actual `import.meta.url` resolution, not an assumption
// about it.
//
// Runs under the root vitest "node" project:
//   pnpm exec vitest run --project node scripts/__tests__/main-module-guard.test.mjs

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Same shape as the fixed `isMain()` in agent-tests/vrt/seed.ts.
const PROBE_BODY = `
import { realpathSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const oldGuard = import.meta.url === \`file://\${process.argv[1]}\`;

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return (
      pathToFileURL(realpathSync(process.argv[1])).href ===
      pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
    );
  } catch {
    return false;
  }
}

console.log(JSON.stringify({ oldGuard, newGuard: isMain() }));
`;

const tempDirs = [];
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
function runProbe(dir) {
  const scriptPath = path.join(dir, 'probe.mjs');
  fs.writeFileSync(scriptPath, PROBE_BODY);
  return JSON.parse(execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' }).trim());
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('main-module guard (agent-tests/vrt/seed.ts pattern, P2-R11)', () => {
  it('the realpath/pathToFileURL comparison correctly detects "this file is the entry point" from a path containing a space', () => {
    const dir = tempDir('seed guard test ');
    const { newGuard } = runProbe(dir);
    expect(newGuard).toBe(true);
  });

  it('the old `file://${argv[1]}` template comparison is not a reliable "is main module" check', () => {
    // Reproduced here via os.tmpdir()'s own symlink indirection (macOS
    // rewrites /var -> /private/var); the same class of mismatch is what
    // breaks it on Windows drive letters and on any percent-encoded path —
    // the bug is "raw path compared to a URL", not one specific OS quirk.
    const dir = tempDir('seed-guard-plain-');
    const { oldGuard, newGuard } = runProbe(dir);
    expect(oldGuard).toBe(false);
    expect(newGuard).toBe(true);
  });

  it('is not fooled by a module that is merely imported, not run directly', () => {
    const dir = tempDir('seed-guard-imported-');
    const targetPath = path.join(dir, 'target.mjs');
    fs.writeFileSync(targetPath, PROBE_BODY);
    const runnerPath = path.join(dir, 'runner.mjs');
    fs.writeFileSync(runnerPath, "await import('./target.mjs');\n");

    const out = execFileSync(process.execPath, [runnerPath], { encoding: 'utf8' }).trim();
    const { newGuard } = JSON.parse(out);
    // argv[1] is runner.mjs, not target.mjs, so target's own isMain() must be false.
    expect(newGuard).toBe(false);
  });
});
