// The rewind/fork option model: the three choices, why they are disabled,
// and the sentences reported afterwards. Pure data — the sheet renders it,
// so asserting it here is asserting what the user reads.

import { describe, expect, it } from 'vitest';
import type { RewindChatResponse } from '@generatorai/client-core';

import {
  DEFAULT_REWIND_SCOPE,
  REWIND_OPTIONS,
  SYNTHETIC_CONVERSATION_NOTE,
  describeFork,
  describeRewind,
  forkedFromLabel,
  rewindBlockedReason,
  rewindOptions,
  shouldRestorePrompt,
} from '../components/chat/rewindOptions';

function response(over: Partial<RewindChatResponse> = {}): RewindChatResponse {
  return {
    chatId: 'c1',
    turnId: 't1',
    scope: 'all',
    conversation: 'native',
    ...over,
  };
}

describe('rewind option model', () => {
  it('offers exactly the three Claude Code scopes, with `all` leading', () => {
    expect(REWIND_OPTIONS.map((o) => o.scope)).toEqual(['all', 'conversation', 'code']);
    expect(DEFAULT_REWIND_SCOPE).toBe('all');
  });

  it('gives every row a stable testID and a one-line explanation', () => {
    for (const option of REWIND_OPTIONS) {
      expect(option.testID).toBe(`rewind-sheet-${option.scope}`);
      expect(option.help.length).toBeGreaterThan(0);
      // One line, not a paragraph: the row has two lines of room.
      expect(option.help).not.toContain('\n');
    }
  });

  it('says shell commands are covered — the thing the SDKs do not cover', () => {
    const code = REWIND_OPTIONS.find((o) => o.scope === 'code');
    expect(code?.help).toContain('shell commands');
  });

  it('is available when nothing is in the way', () => {
    expect(rewindBlockedReason()).toBeNull();
    expect(rewindOptions().every((o) => !o.disabled)).toBe(true);
  });

  it('disables every row while a turn streams, and says why', () => {
    const options = rewindOptions({ streaming: true });
    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(option.disabled).toBe(true);
      expect(option.disabledReason).toMatch(/turn to finish/i);
    }
  });

  it('ranks the reasons so the most fundamental one wins', () => {
    // A message with no turn id cannot be rewound at all, streaming or not.
    expect(rewindBlockedReason({ missingTurn: true, streaming: true, archived: true })).toMatch(
      /not part of a recorded turn/i,
    );
    expect(rewindBlockedReason({ archived: true, streaming: true })).toMatch(/archived/i);
  });
});

describe('describeRewind', () => {
  it('reports file counts for a code-only rewind and says nothing about the conversation', () => {
    const message = describeRewind(
      response({
        scope: 'code',
        conversation: 'skipped',
        files: { mounts: [{ alias: '.', ok: true }], restored: 3, deleted: 1, skipped: 0 },
      }),
    );
    expect(message).toContain('3 files restored');
    expect(message).toContain('1 file removed');
    expect(message).not.toContain('Conversation rewound');
  });

  it('singularises one file', () => {
    const message = describeRewind(
      response({
        scope: 'code',
        conversation: 'skipped',
        files: { mounts: [], restored: 1, deleted: 0, skipped: 0 },
      }),
    );
    expect(message).toContain('1 file restored');
    expect(message).not.toContain('1 files');
  });

  it('says so when a turn changed nothing, rather than implying success at nothing', () => {
    const message = describeRewind(
      response({ scope: 'all', files: { mounts: [], restored: 0, deleted: 0, skipped: 0 } }),
    );
    expect(message).toContain('No file changes to undo.');
    expect(message).toContain('Conversation rewound.');
  });

  it('surfaces a mount that could not be restored', () => {
    const message = describeRewind(
      response({
        scope: 'code',
        conversation: 'skipped',
        files: {
          mounts: [
            { alias: '.', ok: true },
            { alias: 'docs', ok: false, error: 'dirty' },
          ],
          restored: 2,
          deleted: 0,
          skipped: 0,
        },
      }),
    );
    expect(message).toContain('1 folder could not be restored.');
  });

  it('appends the synthetic note only when the provider had no native rewind', () => {
    expect(describeRewind(response({ scope: 'conversation', conversation: 'synthetic' }))).toContain(
      SYNTHETIC_CONVERSATION_NOTE,
    );
    expect(describeRewind(response({ scope: 'conversation', conversation: 'native' }))).not.toContain(
      SYNTHETIC_CONVERSATION_NOTE,
    );
    // `code` never touches the conversation, so the note would be a lie.
    expect(
      describeRewind(response({ scope: 'code', conversation: 'synthetic' })),
    ).not.toContain(SYNTHETIC_CONVERSATION_NOTE);
  });
});

describe('shouldRestorePrompt', () => {
  it('hands the prompt back when the conversation moved', () => {
    expect(shouldRestorePrompt('all', 'fix the header')).toBe(true);
    expect(shouldRestorePrompt('conversation', 'fix the header')).toBe(true);
  });

  it('does NOT reseed the composer after a code-only rewind', () => {
    // The prompt is still in the transcript; putting it back in the box is
    // an invitation to send it a second time.
    expect(shouldRestorePrompt('code', 'fix the header')).toBe(false);
  });

  it('ignores an absent or blank prompt', () => {
    expect(shouldRestorePrompt('all', undefined)).toBe(false);
    expect(shouldRestorePrompt('all', '   ')).toBe(false);
  });
});

describe('fork wording', () => {
  it('names the new chat', () => {
    expect(describeFork('Auth refactor (fork)', 'native')).toBe('Forked into Auth refactor (fork)');
  });

  it('warns when the fork was seeded rather than branched natively', () => {
    expect(describeFork('X (fork)', 'synthetic')).toContain(SYNTHETIC_CONVERSATION_NOTE);
  });

  it('falls back when the parent chat name is unknown', () => {
    expect(forkedFromLabel('Auth refactor')).toBe('Forked from Auth refactor');
    // No name yet (lazy fetch) or no parent left: state the fact, do not
    // render "Forked from Forked chat".
    expect(forkedFromLabel(null)).toBe('Forked chat');
    expect(forkedFromLabel(undefined)).toBe('Forked chat');
    expect(forkedFromLabel('  ')).toBe('Forked chat');
  });
});
