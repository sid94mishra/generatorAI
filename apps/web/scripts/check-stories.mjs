#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Stories-present check (docs/redesign/09-verification.md §3.6).
//
// Every *.tsx under src/ui/{primitives,patterns,shell,templates} that declares
// an exported component (a PascalCase function, const or class) must have a
// sibling <same name>.stories.tsx. Re-export files (`export { X } from './X'`)
// declare nothing and are skipped. Tests and stories themselves are skipped.
//
// `check:design` runs this through check-design-system.mjs; it also runs on its
// own: node scripts/check-stories.mjs
// ────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT_FOLDERS = ['primitives', 'patterns', 'shell', 'templates'];

const EXPORTED_COMPONENT =
  /export\s+(?:default\s+)?(?:(?:async\s+)?function\s+[A-Z]\w*|const\s+[A-Z]\w*\s*(?::[^=]+)?=|class\s+[A-Z]\w*)/;

function collectTsx(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...collectTsx(full));
    } else if (entry.name.endsWith('.tsx') && !/\.(?:stories|test)\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** @returns {string[]} POSIX paths (relative to apps/web) of component files without a story. */
export function findMissingStories(webDir) {
  const missing = [];
  for (const folder of KIT_FOLDERS) {
    for (const file of collectTsx(join(webDir, 'src', 'ui', folder))) {
      if (!EXPORTED_COMPONENT.test(readFileSync(file, 'utf8'))) continue;
      const story = join(dirname(file), `${basename(file, '.tsx')}.stories.tsx`);
      if (!existsSync(story)) missing.push(relative(webDir, file).split(sep).join('/'));
    }
  }
  return missing;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const missing = findMissingStories(fileURLToPath(new URL('..', import.meta.url)));
  if (missing.length > 0) {
    console.error(`[check-stories] ${missing.length} kit component file(s) without a sibling *.stories.tsx:`);
    for (const f of missing) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('[check-stories] OK — every kit component has a story.');
}
