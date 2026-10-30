// ────────────────────────────────────────────────────────────────
// Registers the diff syntax theme (`DIFF_SYNTAX_THEME`) with @pierre/diffs.
//
// Import for the side effect, before anything renders a diff or builds the
// worker pool: `import './diffSyntaxTheme.js';`. The pool resolves themes on
// the main thread and ships the resolved theme to its workers, so this one
// registration covers both the main-thread highlighter and every worker.
// ────────────────────────────────────────────────────────────────

import { registerCustomTheme, type ThemeRegistration } from '@pierre/diffs';
import { SYNTAX_THEME } from '@/ui/patterns/CodeBlock/highlighter.js';
import { DIFF_SYNTAX_THEME } from './diffTheme.js';

/**
 * Idempotent across module re-evaluation (HMR, two chunks): the library logs
 * an error on a duplicate name, so the flag lives on globalThis rather than in
 * module scope.
 */
const REGISTERED = Symbol.for('generatorai.diffSyntaxTheme');
const registry = globalThis as { [REGISTERED]?: boolean };

if (!registry[REGISTERED]) {
  registry[REGISTERED] = true;
  // Same scopes and `var(--syntax-*)` colours as C-23 CodeBlock; only the
  // name differs, because the resolver checks the loaded theme's name.
  const theme = { ...SYNTAX_THEME, name: DIFF_SYNTAX_THEME } as ThemeRegistration;
  registerCustomTheme(DIFF_SYNTAX_THEME, () => Promise.resolve(theme));
}
