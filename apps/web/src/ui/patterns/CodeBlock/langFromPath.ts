// ────────────────────────────────────────────────────────────────
// File path → language name for C-23 CodeBlock (replaces the old
// highlight.js `extToLang`, D-33).
//
// The result names the language for display (a header/badge) and is what
// `<CodeBlock lang>` takes. Names that `highlighter.ts` can highlight
// (`resolveLang`) get Shiki colour; the rest (lua, r, hcl …) still label the
// file and render as plain text. Pure data — importing this never pulls a
// grammar chunk.
// ────────────────────────────────────────────────────────────────

const EXT_LANG: Readonly<Record<string, string>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'jsonc',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  xml: 'xml',
  svg: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  graphql: 'graphql',
  proto: 'protobuf',
  md: 'markdown',
  mdx: 'markdown',
  diff: 'diff',
  patch: 'diff',
  dart: 'dart',
  r: 'r',
  lua: 'lua',
  vim: 'viml',
  tf: 'hcl',
};

/** Extension-less file names that still name a language. */
const BASENAME_LANG: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

/**
 * The language of a file from its path (`src/App.tsx` → `tsx`), or
 * `undefined` for an unknown extension. Accepts `/` and `\\` separators.
 */
export function langFromPath(path: string): string | undefined {
  const name = (path.split(/[/\\]/).pop() ?? path).toLowerCase();
  if (Object.hasOwn(BASENAME_LANG, name)) return BASENAME_LANG[name];
  const dot = name.lastIndexOf('.');
  if (dot < 0) return undefined;
  const ext = name.slice(dot + 1);
  return Object.hasOwn(EXT_LANG, ext) ? EXT_LANG[ext] : undefined;
}
