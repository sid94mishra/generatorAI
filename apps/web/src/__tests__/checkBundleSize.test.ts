// ────────────────────────────────────────────────────────────────
// check-bundle-size.mjs — regression test
// ────────────────────────────────────────────────────────────────
//
// W28 — the script used to sum every `.js` file under `dist/assets/`,
// which meant a chunk that should only ever be lazily fetched (a route
// chunk, a heavy third-party library only used behind a feature) counted
// against the budget exactly as much as the entry bundle itself. That
// made the check both meaningless (it always summed "everything the repo
// ships," which only grows) and blind to the actual regression this
// tracker item was about: @pierre/diffs and its Shiki grammar set
// leaking into the EAGER path while dozens of correctly-lazy chunks sat
// right next to it in the same total, undistinguished.
//
// These tests build tiny fixture `dist/` directories by hand — a real
// `vite build` output is neither necessary nor stable enough to assert
// against — and run the script as a subprocess (it's a CLI, not a
// module) against each one, exactly as CI invokes `pnpm check:bundle`.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'check-bundle-size.mjs');

/** Build a `<tmp>/dist/` fixture and return its root. */
function makeFixture(opts: {
  indexHtml: string;
  assets: Record<string, Buffer | string>;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'check-bundle-size-'));
  const distDir = join(root, 'dist');
  const assetsDir = join(distDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), opts.indexHtml);
  for (const [name, content] of Object.entries(opts.assets)) {
    writeFileSync(join(assetsDir, name), content);
  }
  return root;
}

function runScript(cwd: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH], { cwd, encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (err) {
    // Non-zero exit throws; the script's error path (console.error) writes
    // to stderr, so both streams have to be combined for assertions below
    // to see the FAIL message or the "index.html not found" diagnostic.
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: `${e.stdout}${e.stderr}` };
  }
}

describe('check-bundle-size.mjs', () => {
  it('passes when the initial-load payload is under budget, ignoring lazy-only chunks', () => {
    // A "heavy" lazy chunk that dwarfs the budget on its own — this must
    // NOT be summed, because nothing in index.html references it, exactly
    // like a route chunk or @pierre/diffs's Shiki grammar set in the real
    // build: never fetched on first paint.
    const heavyLazyChunk = Buffer.alloc(2 * 1024 * 1024, 'x'); // 2 MB, uncompressed-hostile
    const smallEntry = 'console.log("entry");';

    const root = makeFixture({
      indexHtml: `<!doctype html><html><head>
        <script type="module" crossorigin src="/assets/entry-abc.js"></script>
        <link rel="modulepreload" crossorigin href="/assets/vendor-def.js">
        <link rel="stylesheet" crossorigin href="/assets/entry-ghi.css">
      </head><body></body></html>`,
      assets: {
        'entry-abc.js': smallEntry,
        'vendor-def.js': smallEntry,
        'entry-ghi.css': 'body{color:red}',
        // Not referenced by index.html at all — a lazy route chunk.
        'lazy-route-xyz.js': heavyLazyChunk,
      },
    });

    try {
      const { status, stdout } = runScript(root);
      expect(status).toBe(0);
      expect(stdout).toContain('[check-bundle-size] OK');
      // The heavy lazy chunk must not be counted in the initial-load report...
      const initialSection = stdout.split('largest lazy chunk')[0]!;
      expect(initialSection).not.toContain('lazy-route-xyz.js');
      // ...but it IS graded on its own: 2 MB of 'x' gzips to a few KB, so it
      // is the largest lazy chunk and well under the per-chunk budget.
      expect(stdout).toContain('largest lazy chunk');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when a lazy chunk on its own exceeds the per-chunk budget', () => {
    // The regression this guards: a 9.6 MB (1.68 MB gzip) syntax-highlighting
    // chunk shipped for months because it was lazy and the initial-load budget
    // could not see it. Random bytes are incompressible, so 400 KB stays above
    // the 300 KB gzip cap.
    const heavyLazyChunk = randomBytes(400 * 1024);
    const root = makeFixture({
      indexHtml: `<!doctype html><html><head>
        <script type="module" crossorigin src="/assets/entry-abc.js"></script>
      </head><body></body></html>`,
      assets: {
        'entry-abc.js': 'console.log("entry");',
        'vendor-highlight-xyz.js': heavyLazyChunk,
      },
    });

    try {
      const { status, stdout } = runScript(root);
      expect(status).toBe(1);
      expect(stdout).toContain('lazy chunk(s) exceed');
      expect(stdout).toContain('vendor-highlight-xyz.js');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('fails when the initial-load payload itself exceeds budget', () => {
    // Random bytes are incompressible, so gzip can't shrink this below the
    // 800 KB budget the way it would for real (repetitive) source text.
    const heavyEntry = randomBytes(1024 * 1024); // 1 MB
    expect(gzipSync(heavyEntry).length).toBeGreaterThan(800 * 1024);

    const root = makeFixture({
      indexHtml: `<!doctype html><html><head>
        <script type="module" crossorigin src="/assets/entry-heavy.js"></script>
      </head><body></body></html>`,
      assets: {
        'entry-heavy.js': heavyEntry,
      },
    });

    try {
      const { status, stdout } = runScript(root);
      expect(status).toBe(1);
      expect(stdout).toContain('FAIL');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('exits with a diagnostic when dist/index.html is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-bundle-size-'));
    try {
      const { status } = runScript(root);
      expect(status).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
