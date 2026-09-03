// ────────────────────────────────────────────────────────────────
// Grammar names and fence aliases — DATA ONLY.
//
// Deliberately separate from `languages.ts`, which imports the grammars
// themselves. The main thread needs to answer "is this fence highlightable?"
// before it decides whether to ask the worker, and importing `languages.ts`
// to find out would drag all 26 grammars back into the main bundle — the exact
// weight moving highlighting into a worker exists to remove.
//
// `languages.ts` imports this file and registers exactly `GRAMMAR_NAMES`, so
// the two cannot drift: a grammar listed here with no import fails to
// register, and a registered grammar missing from here is never requested.
// ────────────────────────────────────────────────────────────────

/** The grammars `languages.ts` registers, in the order it registers them. */
export const GRAMMAR_NAMES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'dockerfile',
  'go',
  'ini',
  'java',
  'javascript',
  'json',
  'kotlin',
  'markdown',
  'php',
  'plaintext',
  'python',
  'ruby',
  'rust',
  'scss',
  'shell',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
] as const;

export type GrammarName = (typeof GRAMMAR_NAMES)[number];

const REGISTERED = new Set<string>(GRAMMAR_NAMES);

/**
 * Fence labels the model writes that are not grammar names.
 *
 * `tsx`/`jsx` map to their non-JSX grammar rather than going unhighlighted:
 * highlight.js's `typescript`/`javascript` grammars already handle embedded
 * JSX well enough to read, and a React answer is the single most common thing
 * an agent emits here.
 */
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'bash',
  zsh: 'bash',
  console: 'shell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  yml: 'yaml',
  html: 'xml',
  svg: 'xml',
  vue: 'xml',
  md: 'markdown',
  'c++': 'cpp',
  cs: 'csharp',
  'objective-c': 'c',
  toml: 'ini',
  patch: 'diff',
  text: 'plaintext',
  txt: 'plaintext',
  kt: 'kotlin',
});

/**
 * Resolve a fence label to a registered grammar, or `null` when we have none.
 *
 * `null` is a first-class answer: the caller renders the block as plain text
 * rather than guessing. Guessing is what `detect: true` did, and it was wrong
 * often enough (JSON scored as Python, a shell transcript as Perl) that
 * dropping it was part of P0-47 rather than a side effect of it.
 */
export function resolveLanguage(label: string | null | undefined): GrammarName | null {
  if (!label) return null;
  const lower = label.trim().toLowerCase();
  const resolved = ALIASES[lower] ?? lower;
  return REGISTERED.has(resolved) ? (resolved as GrammarName) : null;
}
