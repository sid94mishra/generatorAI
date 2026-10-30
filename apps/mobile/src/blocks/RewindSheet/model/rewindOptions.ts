// ────────────────────────────────────────────────────────────────
// Rewind / fork — the option model and the sentences that report a result.
//
// Pure data, no React, for the same reason `turnOptions.ts` is: the sheet,
// the accessibility labels and the tests must agree on the wording, and the
// wording is the hard part. Claude Code's `/rewind` menu is the reference —
// three choices, each with one line saying what it actually moves:
//
//   Restore code and conversation   both, the default
//   Restore conversation only       the transcript, files stay as they are
//   Restore code only               the files, the transcript stays
//
// The "code" line is deliberately explicit about shell commands: our
// checkpoints are git snapshots of the whole workspace, so unlike the
// provider SDKs' own file checkpointing they DO cover a file a `sed` or a
// build script touched. A user who does not know that under-trusts the
// action and hand-reverts instead.
// ────────────────────────────────────────────────────────────────

import type { RewindChatResponse, RewindScope } from '@generatorai/client-core';

export interface RewindOption {
  scope: RewindScope;
  title: string;
  /** One line under the title: what this choice moves, in plain words. */
  help: string;
  testID: string;
}

/** In menu order; `all` leads because it is the default and the safe read. */
export const REWIND_OPTIONS: readonly RewindOption[] = [
  {
    scope: 'all',
    title: 'Restore code and conversation',
    help: 'Puts the files back and drops this message and everything after it.',
    testID: 'rewind-sheet-all',
  },
  {
    scope: 'conversation',
    title: 'Restore conversation only',
    help: 'Drops this message and everything after it. Files stay exactly as they are now.',
    testID: 'rewind-sheet-conversation',
  },
  {
    scope: 'code',
    title: 'Restore code only',
    help: 'Every file the agent changed since this message, including through shell commands, is put back.',
    testID: 'rewind-sheet-code',
  },
];

/** The default choice, and what the sheet pre-selects. */
export const DEFAULT_REWIND_SCOPE: RewindScope = 'all';

/**
 * The note appended whenever the provider could not rewind its own history.
 *
 * Saying nothing here is the failure mode that matters: the user believes
 * the model has forgotten the dropped turns when in fact it is about to be
 * handed a summary of them.
 */
export const SYNTHETIC_CONVERSATION_NOTE =
  'The provider has no native rewind; the model gets a summary of the surviving conversation with your next message.';

export interface RewindAvailability {
  /** A turn is in flight — the server would answer 409 CHAT_BUSY. */
  streaming?: boolean;
  /** An archived chat takes no mutations at all. */
  archived?: boolean;
  /** No turn id on the message: nothing to anchor the rewind to. */
  missingTurn?: boolean;
}

export interface RewindOptionState extends RewindOption {
  disabled: boolean;
  /** Why it is disabled — shown in the row, never left to guesswork. */
  disabledReason: string | null;
}

/**
 * Why every option is unavailable, or `null` when they are all available.
 *
 * One reason for the whole sheet rather than per row: nothing here can be
 * true of one scope and false of another.
 */
export function rewindBlockedReason(availability: RewindAvailability = {}): string | null {
  if (availability.missingTurn) return 'This message is not part of a recorded turn yet.';
  if (availability.archived) return 'This chat is archived.';
  if (availability.streaming) return 'Wait for the current turn to finish, or stop it first.';
  return null;
}

/** The three rows, with their disabled state resolved. */
export function rewindOptions(availability: RewindAvailability = {}): RewindOptionState[] {
  const reason = rewindBlockedReason(availability);
  return REWIND_OPTIONS.map((option) => ({
    ...option,
    disabled: reason !== null,
    disabledReason: reason,
  }));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What to say after a rewind succeeded.
 *
 * Counts first, because "it worked" without a number is indistinguishable
 * from "it found nothing to do" — which is a real outcome when the turn
 * changed no files.
 */
export function describeRewind(response: RewindChatResponse): string {
  const parts: string[] = [];

  if (response.scope !== 'conversation') {
    const files = response.files;
    const restored = files?.restored ?? 0;
    const deleted = files?.deleted ?? 0;
    if (restored === 0 && deleted === 0) {
      parts.push('No file changes to undo.');
    } else {
      const counted = [
        restored > 0 ? `${plural(restored, 'file')} restored` : null,
        deleted > 0 ? `${plural(deleted, 'file')} removed` : null,
      ].filter((p): p is string => p !== null);
      parts.push(`${counted.join(', ')}.`);
    }
    const failed = (files?.mounts ?? []).filter((m) => !m.ok).length;
    if (failed > 0) parts.push(`${plural(failed, 'folder')} could not be restored.`);
  }

  if (response.scope !== 'code') {
    parts.push('Conversation rewound.');
    if (response.conversation === 'synthetic') parts.push(SYNTHETIC_CONVERSATION_NOTE);
  }

  return parts.join(' ');
}

/** What to say after a fork succeeded. */
export function describeFork(name: string, conversation: 'native' | 'synthetic'): string {
  const head = `Forked into ${name}`;
  return conversation === 'synthetic' ? `${head}. ${SYNTHETIC_CONVERSATION_NOTE}` : head;
}

/**
 * Should the composer draft be reseeded with the rewound prompt?
 *
 * Only when the conversation actually moved: a `code` rewind leaves the
 * prompt in the transcript, so putting it back in the composer would invite
 * sending it twice.
 */
export function shouldRestorePrompt(
  scope: RewindScope,
  prompt: string | undefined,
): prompt is string {
  return scope !== 'code' && typeof prompt === 'string' && prompt.trim().length > 0;
}

/**
 * The provenance chip's label.
 *
 * The parent's name is fetched lazily, so for the first frame — and forever,
 * if the parent has since been deleted — there is no name to show. It falls
 * back to the bare fact rather than to "Forked from Forked chat".
 */
export function forkedFromLabel(parentName: string | null | undefined): string {
  const name = parentName?.trim();
  return name ? `Forked from ${name}` : 'Forked chat';
}
