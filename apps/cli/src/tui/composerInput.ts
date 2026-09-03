// ────────────────────────────────────────────────────────────────
// What a line typed into the composer means (open question #19).
//
// The tracker logged this as "`/attach` → `chat.send`'s `flags.attach`
// threading has no dedicated test", and proposed building e2e mock
// infrastructure for it. The command half turned out to be covered already
// (`chat-send.test.ts` asserts the `sendWithAttachments` routing and the
// unreadable-path failure); what was genuinely untested is the decision made
// HERE — which slash command a line is, and whether a send carries the
// queued attachments.
//
// It was untestable because it lived inside a 60-line `switch` in a closure
// inside the workbench component. Pulling the DECISION out (and leaving the
// effects behind) is what makes it testable, and it makes the switch read as
// a dispatch table rather than as a parser and a dispatcher at once.
// ────────────────────────────────────────────────────────────────

/** Slash commands the composer understands. Anything else is unknown. */
export const SLASH_COMMANDS = [
  'model',
  'mode',
  'agent',
  'attach',
  'clear',
  'stop',
  'editor',
  'copy',
  'thinking',
  'help',
] as const;

export type SlashCommand = (typeof SLASH_COMMANDS)[number];

export type ComposerIntent =
  /** Ordinary text: send it, with whatever files `/attach` has queued. */
  | { kind: 'send'; prompt: string; attachments: string[] }
  | { kind: 'slash'; command: SlashCommand; argument: string }
  | { kind: 'unknown-slash'; command: string };

/**
 * Classifies a submitted line.
 *
 * `pendingAttachments` is threaded through rather than read from a store so
 * the decision is a pure function of its inputs — the whole point of the
 * extraction.
 */
export function parseComposerInput(
  text: string,
  pendingAttachments: readonly string[] = [],
): ComposerIntent {
  if (!text.startsWith('/')) {
    // The queued files ride with the NEXT message, which is what `/attach`
    // promises. Copied rather than passed through, so the caller clearing
    // the queue cannot mutate what it just sent.
    return { kind: 'send', prompt: text, attachments: [...pendingAttachments] };
  }

  const [command = '', ...rest] = text.slice(1).split(/\s+/);
  const argument = rest.join(' ').trim();

  return (SLASH_COMMANDS as readonly string[]).includes(command)
    ? { kind: 'slash', command: command as SlashCommand, argument }
    : { kind: 'unknown-slash', command };
}

/**
 * The queue after `/attach <path>`.
 *
 * Appends rather than replaces: `/attach` twice means two files, which is
 * how a user builds up a set before writing the message about them.
 * Duplicates are collapsed — attaching the same path twice uploads it twice
 * and reads as a bug.
 */
export function queueAttachment(pending: readonly string[], path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed || pending.includes(trimmed)) return [...pending];
  return [...pending, trimmed];
}
