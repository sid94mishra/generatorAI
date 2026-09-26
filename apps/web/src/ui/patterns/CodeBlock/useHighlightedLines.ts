// ────────────────────────────────────────────────────────────────
// useHighlightedLines — per-line Shiki tokens for views that lay out every
// source line themselves (diff rows with old/new line numbers and +/-
// markers), where a single `<CodeBlock>` does not fit. Same lazy grammar
// chunks and `var(--syntax-*)` theme as CodeBlock (./highlighter.ts).
//
// Returns `null` until the grammar chunk has loaded, and for an unsupported
// language — render the plain line text in that case.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { highlightTokens, resolveLang } from './highlighter.js';

/** One coloured run of a line; `color` is a `var(--syntax-*)` reference. */
export interface HighlightedToken {
  content: string;
  color?: string;
}

export function useHighlightedLines(code: string, lang: string | undefined): HighlightedToken[][] | null {
  const highlightLang = resolveLang(lang);
  const [state, setState] = useState<{ code: string; lang: string; lines: HighlightedToken[][] } | null>(null);

  useEffect(() => {
    if (!highlightLang || !code) return;
    let live = true;
    void highlightTokens(code, highlightLang).then((tokens) => {
      if (!live || !tokens) return;
      setState({
        code,
        lang: highlightLang,
        lines: tokens.map((line) => line.map((token) => ({ content: token.content, color: token.color }))),
      });
    });
    return () => {
      live = false;
    };
  }, [code, highlightLang]);

  // Never paint a previous input's colours over the current text.
  return state && state.code === code && state.lang === highlightLang ? state.lines : null;
}
