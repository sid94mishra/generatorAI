#!/usr/bin/env tsx
// ────────────────────────────────────────────────────────────────
// Token generator.
//
//   tsx bin/generate.ts --write   regenerate every target
//   tsx bin/generate.ts --check   fail if any target is stale (CI)
//
// Targets are only written when the app exists on disk, so this runs
// cleanly before apps/mobile is scaffolded.
// ────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitCss, spliceCss } from '../src/emit/css.js';
import { emitNative } from '../src/emit/native.js';
import { prepaintCspHash, splicePrepaint } from '../src/emit/prepaint.js';
import { emitStaticCss } from '../src/emit/static.js';
import { emitVocabularyCss, emitVocabularyJson } from '../src/emit/vocabulary.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

/** Swap the one `sha256-…` source the pattern captures around for the current pre-paint hash. */
function replacePin(existing: string | null, pattern: RegExp): string {
  if (existing === null || !pattern.test(existing)) {
    throw new Error(`CSP pin not found (expected ${pattern})`);
  }
  return existing.replace(pattern, `$1${prepaintCspHash()}$2`);
}

interface Target {
  label: string;
  path: string;
  /** Whole-file targets return the content; spliced targets merge. */
  render(existing: string | null): string;
  /** Skip silently when the host app is not scaffolded yet. */
  optional?: boolean;
}

const targets: Target[] = [
  {
    label: 'web CSS token layers',
    path: resolve(repoRoot, 'apps/web/src/styles/globals.css'),
    render(existing) {
      if (existing === null) {
        throw new Error('apps/web/src/styles/globals.css not found');
      }
      return spliceCss(existing, emitCss());
    },
  },
  {
    label: 'web pre-paint script',
    path: resolve(repoRoot, 'apps/web/index.html'),
    render(existing) {
      if (existing === null) {
        throw new Error('apps/web/index.html not found');
      }
      return splicePrepaint(existing);
    },
  },
  // The pre-paint script is allow-listed by SHA-256 in two CSPs (the server's
  // header and the desktop's CSP floor); both pins must follow the script.
  {
    label: 'server CSP pre-paint hash',
    path: resolve(repoRoot, 'apps/server/src/middleware/csp.ts'),
    render: (existing) => replacePin(existing, /(THEME_SCRIPT_CSP_HASH = ')sha256-[A-Za-z0-9+/=]+(')/),
  },
  {
    label: 'desktop CSP pre-paint hash',
    path: resolve(repoRoot, 'apps/desktop/src/main/session-hardening.ts'),
    render: (existing) => replacePin(existing, /("script-src 'self' ')sha256-[A-Za-z0-9+/=]+(')/),
  },
  // Static desktop pages (06 §7, P5-11): no script beyond error.html's own
  // (CSP `default-src 'none'`), so they get one generated `:root` block +
  // dark-mode media query instead of the web app's full layer stack.
  {
    label: 'desktop splash page tokens',
    path: resolve(repoRoot, 'apps/desktop/resources/splash.html'),
    render(existing) {
      if (existing === null) throw new Error('apps/desktop/resources/splash.html not found');
      return spliceCss(existing, emitStaticCss());
    },
  },
  {
    label: 'desktop error page tokens',
    path: resolve(repoRoot, 'apps/desktop/resources/error.html'),
    render(existing) {
      if (existing === null) throw new Error('apps/desktop/resources/error.html not found');
      return spliceCss(existing, emitStaticCss());
    },
  },
  {
    label: 'desktop prompt page tokens',
    path: resolve(repoRoot, 'apps/desktop/resources/prompt.html'),
    render(existing) {
      if (existing === null) throw new Error('apps/desktop/resources/prompt.html not found');
      return spliceCss(existing, emitStaticCss());
    },
  },
  {
    label: 'shared class vocabulary',
    path: resolve(repoRoot, 'packages/design-tokens/css/vocabulary.css'),
    render: () => emitVocabularyCss(),
  },
  {
    label: 'vocabulary lists for Node tools',
    path: resolve(repoRoot, 'packages/design-tokens/generated/vocabulary.json'),
    render: () => emitVocabularyJson(),
  },
  {
    label: 'mobile token module',
    path: resolve(repoRoot, 'apps/mobile/src/theme/tokens.generated.ts'),
    optional: true,
    render: () => emitNative(),
  },
];

const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--write')
    ? 'write'
    : null;

if (!mode) {
  console.error('Usage: generate.ts --write | --check');
  process.exit(2);
}

/**
 * Line endings are NOT part of the generated content.
 *
 * `core.autocrlf=true` rewrites checked-out files to CRLF on Windows, so a
 * byte comparison against LF-generated output reports STALE forever and
 * breaks CI for every Windows developer. Compare on normalized text, and
 * write back using whatever convention the file already uses so the working
 * tree never churns.
 */
const normalize = (s: string): string => s.replace(/\r\n/g, '\n');

const dominantEol = (s: string | null): '\r\n' | '\n' => {
  if (!s) return process.platform === 'win32' ? '\r\n' : '\n';
  const crlf = (s.match(/\r\n/g) ?? []).length;
  const lf = (s.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
};

const applyEol = (s: string, eol: '\r\n' | '\n'): string =>
  eol === '\n' ? normalize(s) : normalize(s).replace(/\n/g, '\r\n');

let stale = 0;
let written = 0;

for (const target of targets) {
  const exists = existsSync(target.path);

  if (!exists && target.optional) {
    // The host app is not scaffolded yet — nothing to keep in sync.
    if (!existsSync(dirname(target.path))) {
      console.log(`  skip   ${target.label} (host app not present)`);
      continue;
    }
  }

  const existing = exists ? readFileSync(target.path, 'utf8') : null;

  let next: string;
  try {
    next = target.render(existing);
  } catch (err) {
    if (target.optional) {
      console.log(`  skip   ${target.label} (${(err as Error).message})`);
      continue;
    }
    throw err;
  }

  if (existing !== null && normalize(existing) === normalize(next)) {
    console.log(`  ok     ${target.label}`);
    continue;
  }

  if (mode === 'check') {
    stale += 1;
    console.error(`  STALE  ${target.label} → ${target.path}`);
    continue;
  }

  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, applyEol(next, dominantEol(existing)), 'utf8');
  written += 1;
  console.log(`  write  ${target.label}`);
}

if (mode === 'check' && stale > 0) {
  console.error(
    `\n${stale} generated token target(s) are stale. ` +
      'Run `pnpm --filter @generatorai/design-tokens tokens:write` and commit the result.',
  );
  process.exit(1);
}

if (mode === 'write') {
  console.log(`\n${written} file(s) updated.`);
}
