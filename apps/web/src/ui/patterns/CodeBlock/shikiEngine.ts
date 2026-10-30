// ────────────────────────────────────────────────────────────────
// Shiki engine for C-23 CodeBlock — the part that actually tokenizes. It runs
// inside the highlight worker (`highlight.worker.ts`) in the app, so grammar
// compilation (the JS regex engine transpiles a grammar's rules on first use,
// ~0.3–0.4 s for TypeScript) and tokenizing never block the main thread; and
// in-thread where there is no Worker (unit tests, very old hosts). See
// `./highlighter.ts` for the public, cached API.
// ────────────────────────────────────────────────────────────────

import type { HighlighterCore, ThemedToken, ThemeRegistrationRaw } from 'shiki/core';

export const SYNTAX_THEME_NAME = 'gai-syntax';

/** Shiki theme whose token colours are `var(--syntax-*)` (globals.css, per-theme values). */
export const SYNTAX_THEME: ThemeRegistrationRaw = {
  name: SYNTAX_THEME_NAME,
  type: 'dark',
  fg: 'var(--syntax-variable)',
  bg: 'transparent',
  settings: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: 'var(--syntax-comment)' } },
    {
      scope: ['string', 'string.quoted', 'punctuation.definition.string', 'string.template'],
      settings: { foreground: 'var(--syntax-string)' },
    },
    { scope: ['constant.numeric'], settings: { foreground: 'var(--syntax-number)' } },
    {
      scope: ['keyword', 'storage.type', 'storage.modifier', 'keyword.control', 'keyword.other'],
      settings: { foreground: 'var(--syntax-keyword)' },
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call', 'variable.function'],
      settings: { foreground: 'var(--syntax-function)' },
    },
    {
      scope: ['entity.name.type', 'support.type', 'entity.name.class', 'support.class', 'entity.other.inherited-class'],
      settings: { foreground: 'var(--syntax-type)' },
    },
    { scope: ['variable', 'variable.other', 'variable.parameter'], settings: { foreground: 'var(--syntax-variable)' } },
    {
      scope: ['constant', 'constant.language', 'support.constant', 'constant.character'],
      settings: { foreground: 'var(--syntax-constant)' },
    },
    { scope: ['keyword.operator'], settings: { foreground: 'var(--syntax-operator)' } },
    { scope: ['punctuation', 'meta.brace', 'punctuation.separator'], settings: { foreground: 'var(--syntax-punctuation)' } },
    { scope: ['entity.name.tag'], settings: { foreground: 'var(--syntax-tag)' } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: 'var(--syntax-attribute)' } },
    { scope: ['markup.deleted', 'diff.deleted'], settings: { foreground: 'var(--syntax-deleted)' } },
    { scope: ['markup.inserted', 'diff.inserted'], settings: { foreground: 'var(--syntax-inserted)' } },
  ],
};

/**
 * Supported languages, each its own lazy chunk. Extend by adding one static
 * `import('shiki/langs/<name>.mjs')` entry — never a templated dynamic import
 * (breaks bundler chunk analysis for a node_modules path).
 */
export const LANG_LOADERS = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
} as const;

export type SupportedLang = keyof typeof LANG_LOADERS;

export function isSupportedLang(lang: string | undefined): lang is SupportedLang {
  return !!lang && Object.hasOwn(LANG_LOADERS, lang);
}

/**
 * Common short names (fence info strings like ```ts / ```sh, file-extension
 * style names) → the `LANG_LOADERS` key that highlights them.
 */
const LANG_ALIASES: Readonly<Record<string, SupportedLang>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  json5: 'jsonc',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  console: 'bash',
  py: 'python',
  python3: 'python',
  yml: 'yaml',
  md: 'markdown',
  htm: 'html',
  svg: 'xml',
  rs: 'rust',
  rb: 'ruby',
  golang: 'go',
  patch: 'diff',
  docker: 'dockerfile',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  h: 'c',
  kt: 'kotlin',
  kts: 'kotlin',
  cfg: 'ini',
  conf: 'ini',
};

/** Resolves a language name or alias (case-insensitive) to a highlightable language, else `undefined`. */
export function resolveLang(lang: string | undefined): SupportedLang | undefined {
  if (!lang) return undefined;
  const key = lang.trim().toLowerCase();
  if (isSupportedLang(key)) return key;
  return Object.hasOwn(LANG_ALIASES, key) ? LANG_ALIASES[key] : undefined;
}

/** Languages Shiki tokenizes without a grammar (no lazy chunk needed). */
const PLAIN_LANGS = new Set(['text', 'plain', 'plaintext', 'txt']);

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/javascript'),
      ]);
      return createHighlighterCore({
        themes: [SYNTAX_THEME],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
    })();
  }
  return highlighterPromise;
}

async function ensureLanguage(highlighter: HighlighterCore, lang: SupportedLang): Promise<void> {
  if (loadedLangs.has(lang)) return;
  const mod = await LANG_LOADERS[lang]();
  await highlighter.loadLanguage(mod.default);
  loadedLangs.add(lang);
}

/**
 * Highlights `code` as HTML. Falls back to plain (unhighlighted, still
 * escaped) markup for an unsupported/omitted language rather than throwing —
 * a code block should never fail to render because a grammar is missing.
 */
export async function engineHighlightCode(code: string, lang: string | undefined): Promise<string> {
  const supported = resolveLang(lang);
  const resolvedLang = supported ?? (lang && PLAIN_LANGS.has(lang) ? lang : 'text');
  const highlighter = await getHighlighter();
  if (supported) await ensureLanguage(highlighter, supported);
  return highlighter.codeToHtml(code, { lang: resolvedLang, theme: SYNTAX_THEME_NAME });
}

/**
 * Highlights `code` as one token array per source line (for line-oriented
 * views such as diff rows, which lay out each line themselves). Each token's
 * `color` is a `var(--syntax-*)` reference from `SYNTAX_THEME`. Resolves
 * `null` for an unsupported/omitted language — callers render plain text.
 */
export async function engineHighlightTokens(code: string, lang: string | undefined): Promise<ThemedToken[][] | null> {
  const supported = resolveLang(lang);
  if (!supported) return null;
  const highlighter = await getHighlighter();
  await ensureLanguage(highlighter, supported);
  return highlighter.codeToTokens(code, { lang: supported, theme: SYNTAX_THEME_NAME }).tokens;
}

