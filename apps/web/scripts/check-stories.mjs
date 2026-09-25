#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Stories-present check (docs/redesign/09-verification.md §3.6).
//
// Every *.tsx under src/ui/{primitives,patterns,shell,templates} that declares
// a component and exports anything must have a sibling <same name>.stories.tsx.
// "Declares a component" = a PascalCase function, const or class at the start of
// a line, exported inline or not: the shadcn CLI shape (`function Button() {}` …
// `export { Button, buttonVariants }`) counts as well as `export function X`.
// Pure re-export files (`export { X } from './X'`, `export * from`) declare
// nothing and are skipped. Tests and stories themselves are skipped.
//
// `check:design` runs this through check-design-system.mjs; it also runs on its
// own: node scripts/check-stories.mjs
// ────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_FOLDERS = ['primitives', 'patterns', 'shell', 'templates'];

/** PascalCase with a lower-case letter (Button, not SIZES), declared at the start of a line. */
const PASCAL = '[A-Z]\\w*[a-z]\\w*';
const DECLARES_COMPONENT = new RegExp(
  `^[ \\t]*(?:export[ \\t]+(?:default[ \\t]+)?)?` +
    `(?:(?:async[ \\t]+)?function\\*?[ \\t]+${PASCAL}|(?:const|let|var)[ \\t]+${PASCAL}\\s*(?::[^=]+)?=|(?:abstract[ \\t]+)?class[ \\t]+${PASCAL})`,
  'm',
);
const EXPORTS_SOMETHING = /^[ \t]*export[ \t{*]/m;

/** True when the source is a component file (see the header). Exported for the rails tests. */
export function isComponentSource(source) {
  return DECLARES_COMPONENT.test(source) && EXPORTS_SOMETHING.test(source);
}

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
      if (!isComponentSource(readFileSync(file, 'utf8'))) continue;
      const story = join(dirname(file), `${basename(file, '.tsx')}.stories.tsx`);
      if (!existsSync(story)) missing.push(relative(webDir, file).split(sep).join('/'));
    }
  }
  return missing;
}

// realpath: through a symlink, a junction or macOS /tmp → /private/tmp, argv[1]
// differs from import.meta.url and the check would silently do nothing.
function isMain() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false; // argv[1] is not a file (node -e, a test runner's flags)
  }
}

if (isMain()) {
  const missing = findMissingStories(fileURLToPath(new URL('..', import.meta.url)));
  if (missing.length > 0) {
    console.error(`[check-stories] ${missing.length} kit component file(s) without a sibling *.stories.tsx:`);
    for (const f of missing) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('[check-stories] OK — every kit component has a story.');
}
