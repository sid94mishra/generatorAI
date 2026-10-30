// ────────────────────────────────────────────────────────────────
// The Shiki highlight worker (D-88): grammar loading, regex compilation and
// tokenizing for every CodeBlock and highlighted diff line, off the main
// thread. One request → one reply, matched by `id` (`./highlighter.ts`).
// ────────────────────────────────────────────────────────────────

import { engineHighlightCode, engineHighlightTokens } from './shikiEngine.js';
import type { HighlightRequest, HighlightResponse } from './highlighter.js';

self.onmessage = async (event: MessageEvent<HighlightRequest>) => {
  const { id, kind, code, lang } = event.data;
  let reply: HighlightResponse;
  try {
    const value = kind === 'html' ? await engineHighlightCode(code, lang) : await engineHighlightTokens(code, lang);
    reply = { id, ok: true, value };
  } catch (err) {
    reply = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(reply);
};
