// ────────────────────────────────────────────────────────────────
// ReviewPromptSerializer — turn threads into an agent instruction
// ────────────────────────────────────────────────────────────────
//
// Serialisation happens on the SERVER, not in the composer, so the CLI, SDK
// and desktop app all produce byte-identical prompts.
//
// The format is deliberately XML-ish rather than markdown: the anchored code
// often contains fences and markdown headings, and a tag-delimited envelope
// survives that without escaping games.

import type { ReviewIntent, ReviewThread } from './types.js';

/** Rough token budget for the whole feedback block. */
const MAX_PROMPT_CHARS = 24_000;
/** Anchors longer than this are elided in the middle. */
const MAX_ANCHOR_CHARS = 1_500;

const INTENT_HINT: Record<ReviewIntent, string> = {
  fix: 'Change the code as described.',
  question: 'Answer the question. Only change code if the answer requires it.',
  note: 'Take this into account; no change may be needed.',
  refactor: 'Restructure the code as described without changing behaviour.',
  test: 'Add or update tests as described.',
};

export interface SerializeOptions {
  /** Appended verbatim after the structured block. */
  note?: string;
  round?: number;
  workspaceId?: string;
}

export function serializeReviewThreads(
  threads: ReviewThread[],
  options: SerializeOptions = {},
): string {
  if (threads.length === 0) return '';

  // Group by file so the agent sees one block per file, in path order —
  // the same order it will edit them in.
  const byFile = new Map<string, ReviewThread[]>();
  for (const thread of threads) {
    const key = `${thread.repoAlias}\u0000${thread.path}`;
    const list = byFile.get(key);
    if (list) list.push(thread);
    else byFile.set(key, [thread]);
  }

  const round = options.round ?? 1;
  const parts: string[] = [];
  parts.push(
    `<review_feedback round="${round}"${
      options.workspaceId ? ` workspace="${escapeAttr(options.workspaceId)}"` : ''
    }>`,
  );

  let budget = MAX_PROMPT_CHARS;
  let elided = 0;

  for (const [key, fileThreads] of [...byFile.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const [alias, path] = key.split('\u0000') as [string, string];
    fileThreads.sort((a, b) => a.startLine - b.startLine);

    const chunks: string[] = [];
    for (const thread of fileThreads) {
      const lineRef =
        thread.startLine === thread.endLine
          ? `${thread.startLine}`
          : `${thread.startLine}-${thread.endLine}`;

      const anchor = truncateMiddle(thread.anchorText, MAX_ANCHOR_CHARS);
      const commentLines = thread.comments
        .filter((c) => c.author === 'user')
        .map(
          (c) =>
            `<comment id="${escapeAttr(c.id)}"${
              c.intent ? ` intent="${c.intent}"` : ''
            }>${escapeText(c.body)}</comment>`,
        )
        .join('\n');

      const block = [
        `<file path="${escapeAttr(path)}" alias="${escapeAttr(alias)}" lines="${lineRef}" side="${thread.side}">`,
        '```',
        anchor,
        '```',
        commentLines,
        '</file>',
      ].join('\n');

      if (block.length > budget) {
        // Out of budget — reference the location without the code so the
        // agent still knows a comment exists there.
        const stub = `<file path="${escapeAttr(path)}" alias="${escapeAttr(alias)}" lines="${lineRef}" side="${thread.side}" elided="true">\n${commentLines}\n</file>`;
        if (stub.length <= budget) {
          chunks.push(stub);
          budget -= stub.length;
        } else {
          elided++;
        }
        continue;
      }
      chunks.push(block);
      budget -= block.length;
    }
    parts.push(...chunks);
  }

  parts.push('</review_feedback>');

  if (elided > 0) {
    parts.push(
      `\n(${elided} further comment${elided === 1 ? '' : 's'} omitted for length — ask for them if needed.)`,
    );
  }

  const intents = new Set(
    threads.flatMap((t) => t.comments.map((c) => c.intent).filter(Boolean)),
  ) as Set<ReviewIntent>;
  const hints = [...intents].map((i) => `- ${i}: ${INTENT_HINT[i]}`);

  parts.push('');
  parts.push('Address every comment above.');
  if (hints.length > 0) {
    parts.push('Intent meanings:');
    parts.push(...hints);
  }
  parts.push(
    'After each change, state which comment id it resolves. If you disagree with a comment, say so instead of silently skipping it.',
  );

  if (options.note?.trim()) {
    parts.push('');
    parts.push(options.note.trim());
  }

  return parts.join('\n');
}

/** Keep the head and tail of an over-long anchor, elide the middle. */
function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 20) / 2);
  return `${text.slice(0, half)}\n… (${text.length - max} chars elided) …\n${text.slice(-half)}`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape both angle brackets in comment bodies. Users write things like
 * "wrap it in <Suspense>", and an unescaped `>` can close a tag the model is
 * mid-way through parsing, silently swallowing the rest of the comment.
 */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
