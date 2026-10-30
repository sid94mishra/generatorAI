// ────────────────────────────────────────────────────────────────
// Lazy Shiki 4 highlighting for C-23 CodeBlock (D-33, D-38; 09 §8.1 "Shiki
// grammars lazy, out of the initial bundle"), off the main thread (D-88).
//
// Nothing here is imported eagerly by CodeBlock.tsx: `highlightCode()` and
// `highlightTokens()` are only called from inside a `useEffect`, and the
// engine (`./shikiEngine.ts`: `shiki/core`, the JS regex engine, one lazy
// chunk per language grammar, the `var(--syntax-*)` theme) is loaded inside
// a dedicated module worker (`./highlight.worker.ts`). Compiling a grammar
// and tokenizing a block used to run on the main thread — 0.3–0.4 s for the
// first TypeScript fence, a long task in the middle of a streaming answer.
// Where there is no Worker (unit tests) the engine runs in-thread.
//
// Results are cached by (kind, language, code): a code block that remounts
// (a transcript view-mode switch, the live turn becoming the persisted
// message) shows its colours at once (`peekHighlightedCode`) and costs nothing.
// ────────────────────────────────────────────────────────────────

import type { ThemedToken } from 'shiki/core';
import { engineHighlightCode, engineHighlightTokens, resolveLang } from './shikiEngine.js';

export {
  LANG_LOADERS,
  SYNTAX_THEME,
  SYNTAX_THEME_NAME,
  isSupportedLang,
  resolveLang,
  type SupportedLang,
} from './shikiEngine.js';

// ── Result cache ─────────────────────────────────────────────────

const CACHE_LIMIT = 400;
const cache = new Map<string, string | ThemedToken[][] | null>();

function cacheKey(kind: 'html' | 'tokens', code: string, lang: string): string {
  return `${kind}\u0000${lang}\u0000${code}`;
}

function remember<T extends string | ThemedToken[][] | null>(key: string, value: T): T {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return value;
}

/** The highlighted HTML of `code` if it was already produced, so a remounting block paints it without waiting. */
export function peekHighlightedCode(code: string, lang: string | undefined): string | undefined {
  const value = cache.get(cacheKey('html', code, resolveLang(lang) ?? lang ?? 'text'));
  return typeof value === 'string' ? value : undefined;
}

// ── Worker dispatch ──────────────────────────────────────────────

export type HighlightRequest = { id: number; kind: 'html' | 'tokens'; code: string; lang: string | undefined };
export type HighlightResponse = { id: number; ok: true; value: string | ThemedToken[][] | null } | { id: number; ok: false; error: string };

let workerPromise: Promise<Worker | null> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (value: string | ThemedToken[][] | null) => void; reject: (err: Error) => void }>();

function getWorker(): Promise<Worker | null> {
  if (!workerPromise) {
    workerPromise =
      typeof Worker === 'undefined'
        ? Promise.resolve(null)
        : import('./highlight.worker.ts?worker')
            .then(({ default: HighlightWorker }) => {
              const worker = new HighlightWorker();
              worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
                const reply = event.data;
                const waiter = pending.get(reply.id);
                if (!waiter) return;
                pending.delete(reply.id);
                if (reply.ok) waiter.resolve(reply.value);
                else waiter.reject(new Error(reply.error));
              };
              worker.onerror = () => {
                // A worker that cannot start (CSP, a host without module workers): highlight in-thread from now on.
                workerPromise = Promise.resolve(null);
                for (const [id, waiter] of pending) {
                  pending.delete(id);
                  waiter.reject(new Error('highlight worker failed'));
                }
              };
              return worker;
            })
            .catch(() => null);
  }
  return workerPromise;
}

async function run(kind: 'html' | 'tokens', code: string, lang: string | undefined): Promise<string | ThemedToken[][] | null> {
  const worker = await getWorker();
  if (worker) {
    try {
      return await new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, kind, code, lang } satisfies HighlightRequest);
      });
    } catch {
      // Fall through to the in-thread engine.
    }
  }
  return kind === 'html' ? engineHighlightCode(code, lang) : engineHighlightTokens(code, lang);
}

/**
 * Highlights `code` as HTML. Falls back to plain (unhighlighted, still
 * escaped) markup for an unsupported/omitted language rather than throwing —
 * a code block should never fail to render because a grammar is missing.
 */
export async function highlightCode(code: string, lang: string | undefined): Promise<string> {
  const key = cacheKey('html', code, resolveLang(lang) ?? lang ?? 'text');
  const hit = cache.get(key);
  if (typeof hit === 'string') return hit;
  return remember(key, (await run('html', code, lang)) as string);
}

/**
 * Highlights `code` as one token array per source line (for line-oriented
 * views such as diff rows, which lay out each line themselves). Each token's
 * `color` is a `var(--syntax-*)` reference. Resolves `null` for an
 * unsupported/omitted language — callers render plain text.
 */
export async function highlightTokens(code: string, lang: string | undefined): Promise<ThemedToken[][] | null> {
  const supported = resolveLang(lang);
  if (!supported) return null;
  const key = cacheKey('tokens', code, supported);
  if (cache.has(key)) return cache.get(key) as ThemedToken[][] | null;
  return remember(key, (await run('tokens', code, supported)) as ThemedToken[][] | null);
}

/**
 * Shiki always wraps its output in `<pre class="shiki" style="…">…</pre>`.
 * Rather than reach into that markup from CodeBlock's own className with an
 * arbitrary `[&_pre]:…` selector (banned outside `ui/lib`), replace the
 * wrapper's own attributes with the kit's plain chrome classes — CodeBlock
 * owns the box model, Shiki only supplies the coloured `<code>` inside it.
 */
export function withPreChrome(html: string, wrap: boolean): string {
  const preClass = `m-0 bg-transparent p-0 ${wrap ? 'whitespace-pre-wrap' : 'whitespace-pre'}`;
  return html.replace(/^<pre[^>]*>/, `<pre class="${preClass}">`);
}
