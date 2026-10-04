// ────────────────────────────────────────────────────────────────
// Review-comment prompts as a person reads them.
//
// "Add & send" on a Changes-dock comment sends the agent a machine-formatted prompt
// (`packages/review` ReviewPromptSerializer: `<review_feedback>` → `<file>` → `<comment>`, then the
// instructions). The transcript showed it verbatim as the user's bubble — XML, escaped `&lt;`, the
// intent glossary. Both clients render the parsed comments instead.
//
// Dependency-free (the Electron main bundle loads `@generatorai/shared/ui-contract`).
// ────────────────────────────────────────────────────────────────

export interface ReviewPromptComment {
  path: string;
  /** "12" or "12-18". */
  lines: string;
  intent?: string;
  body: string;
}

export interface ParsedReviewPrompt {
  comments: ReviewPromptComment[];
  /** The note the reviewer typed after the comments, if any. */
  note?: string;
}

const unescape = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const INSTRUCTIONS_END = /If you disagree with a comment, say so instead of silently skipping it\.\s*/;

/** The comments of a review-feedback prompt, or null when the text is an ordinary message. */
export function parseReviewPrompt(text: string): ParsedReviewPrompt | null {
  const start = text.indexOf('<review_feedback');
  const end = text.indexOf('</review_feedback>');
  if (start === -1 || end === -1 || end < start) return null;
  const comments: ReviewPromptComment[] = [];
  const fileRe = /<file\b([^>]*)>([\s\S]*?)<\/file>/g;
  for (const file of text.slice(start, end).matchAll(fileRe)) {
    const attrs = file[1] ?? '';
    const path = unescape(/\bpath="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const lines = /\blines="([^"]*)"/.exec(attrs)?.[1] ?? '';
    for (const c of (file[2] ?? '').matchAll(/<comment\b([^>]*)>([\s\S]*?)<\/comment>/g)) {
      const intent = /\bintent="([^"]*)"/.exec(c[1] ?? '')?.[1];
      comments.push({ path, lines, ...(intent ? { intent } : {}), body: unescape((c[2] ?? '').trim()) });
    }
  }
  if (comments.length === 0) return null;
  const tail = text.slice(end + '</review_feedback>'.length);
  const m = INSTRUCTIONS_END.exec(tail);
  const note = m ? tail.slice(m.index + m[0].length).trim() : '';
  return { comments, ...(note ? { note } : {}) };
}
