// ────────────────────────────────────────────────────────────────
// turnHint — what the generated commit / PR text is told about a turn
// ────────────────────────────────────────────────────────────────
//
// Agent-native mode (doc §5) commits for the agent, so the agent is asked to
// end its final message with one `Summary:` line describing the change. That
// line is authored specifically to seed the commit message, so when it is
// present it IS the hint; otherwise we fall back to the user's prompt plus a
// tail of the assistant's prose, which is noisier but always available.
//
// Pure string work — no git, no model, no I/O.

/** Hints are capped so a long turn cannot dominate the generation prompt. */
export const TURN_HINT_MAX_CHARS = 2_000;

/** `Summary:` / `**Summary:**` / `## Summary:` — case-insensitive, one line. */
const SUMMARY_LINE = /^\s*(?:[#>*_\-\s]*)summary\s*:\s*(.+?)\s*[*_]*\s*$/i;

/**
 * The LAST `Summary:` line of `text`, without its label, or undefined.
 *
 * Last rather than first: an agent that revises its answer restates the
 * summary at the end, and the closing one describes what actually landed.
 * Markdown decoration around the label (`**Summary:** …`) is tolerated
 * because models add it unprompted.
 */
export function extractSummaryLine(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  let found: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = SUMMARY_LINE.exec(line);
    if (!match) continue;
    const body = stripDecoration(match[1] ?? '');
    if (body) found = body;
  }
  return found;
}

/** Trim markdown emphasis and trailing punctuation noise off a summary line. */
function stripDecoration(raw: string): string {
  return raw
    .replace(/^[*_`\s]+/, '')
    .replace(/[*_`\s]+$/, '')
    .trim();
}

export interface TurnHintInput {
  /** The user's prompt for the turn that just finished. */
  prompt?: string;
  /** The assistant's final text for that turn. */
  assistantText?: string;
  /** Chat name, used only when there is nothing else to say. */
  chatName?: string;
  max?: number;
}

/**
 * The hint handed to `SourceControlFlowService.run` for one finished turn.
 *
 * Preference order:
 *   1. the agent's own `Summary:` line — written to seed the commit message;
 *   2. the user's prompt + the tail of the assistant's text;
 *   3. the chat name.
 *
 * Always capped at `max` characters (default `TURN_HINT_MAX_CHARS`), keeping
 * the HEAD of the prompt and the TAIL of the assistant's text: the prompt says
 * what was asked for, and the end of the answer says what was done.
 */
export function buildTurnHint(input: TurnHintInput): string {
  const max = input.max ?? TURN_HINT_MAX_CHARS;
  if (max <= 0) return '';

  const summary = extractSummaryLine(input.assistantText);
  if (summary) return summary.slice(0, max);

  const prompt = (input.prompt ?? '').trim();
  const answer = (input.assistantText ?? '').trim();

  if (!prompt && !answer) return (input.chatName ?? '').trim().slice(0, max);
  if (!answer) return prompt.slice(0, max);

  const promptBlock = prompt ? `Task: ${prompt}` : '';
  if (!promptBlock) return tail(answer, max);

  const separator = '\n\nAssistant: ';
  // Half the budget to the ask, the rest to what was done — but never waste
  // the ask's share when it is short.
  const promptBudget = Math.min(promptBlock.length, Math.floor(max / 2));
  const head = promptBlock.slice(0, promptBudget);
  const rest = max - head.length - separator.length;
  if (rest <= 0) return head.slice(0, max);
  return `${head}${separator}${tail(answer, rest)}`;
}

/** The last `max` characters of `text`, marked when it was cut. */
function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = '… ';
  return marker + text.slice(-(Math.max(1, max - marker.length)));
}
