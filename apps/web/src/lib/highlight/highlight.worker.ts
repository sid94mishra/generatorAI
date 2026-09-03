// ────────────────────────────────────────────────────────────────
// The syntax-highlighting worker — W27 / P0-47, the half that was missing.
//
// `detect: true` came out of the chat path already. This is the rest: the
// highlighting itself ran synchronously inside React's render, on the main
// thread, once per code block PER TOKEN — a 200-line code block in a
// streaming answer is re-highlighted on every chunk that follows it, and every
// one of those passes competes with the frame the user is watching.
//
// D3's Phase-3 note is explicit that this is the correct use of a worker: it
// owns no native handle, it is pure CPU, and its whole value is not being on
// the thread that paints.
//
// The protocol is deliberately tiny — one request, one response, correlated by
// id — because a worker with a rich protocol is a worker with a lifecycle, and
// this one has none: it is stateless and any request can be dropped without
// consequence (the caller renders plain text).
// ────────────────────────────────────────────────────────────────

import { hljs } from './languages.js';
import { resolveLanguage } from './languageNames.js';
import { tokenizeHighlightHtml, type HighlightToken } from './tokenize.js';

export interface HighlightRequest {
  id: number;
  language: string;
  code: string;
}

export interface HighlightResponse {
  id: number;
  /** Empty when the language is unknown — the caller renders plain text. */
  tokens: HighlightToken[];
}

/**
 * Highlight one block. Exported so the behaviour is testable without a
 * `Worker`, which vitest's happy-dom environment does not provide.
 */
export function highlightBlock(language: string, code: string): HighlightToken[] {
  const grammar = resolveLanguage(language);
  if (!grammar) return [];
  try {
    // `ignoreIllegals` — a fence is frequently a FRAGMENT (a function body, a
    // partial object) or is still mid-stream and syntactically incomplete.
    // Throwing on those would leave the most common case unhighlighted.
    const { value } = hljs.highlight(code, { language: grammar, ignoreIllegals: true });
    return tokenizeHighlightHtml(value);
  } catch {
    // Highlighting is decoration. A grammar that throws costs colour, never
    // the code itself.
    return [];
  }
}

// `self` is undefined when this module is imported directly by a test.
if (typeof self !== 'undefined' && typeof (self as unknown as Worker).postMessage === 'function') {
  self.onmessage = (event: MessageEvent<HighlightRequest>) => {
    const { id, language, code } = event.data;
    const response: HighlightResponse = { id, tokens: highlightBlock(language, code) };
    (self as unknown as Worker).postMessage(response);
  };
}
