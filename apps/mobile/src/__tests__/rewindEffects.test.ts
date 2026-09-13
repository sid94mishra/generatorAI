// Partitioning `chatRewound` out of a stream effect batch.
//
// This runs on the 60Hz flush path in `useChatStream`, and it decides two
// things that are hard to see at a glance: that the remaining effects keep
// their order (so a turn that starts in the same frame as the rewind still
// applies), and that a `code`-scope rewind never reseeds the composer.

import { describe, expect, it } from 'vitest';
import type { StreamEffect } from '@generatorai/client-core';

import {
  partitionRewound,
  restoredPromptFrom,
  rewoundMatchesChat,
  type ChatRewoundEffect,
} from '../stream/rewindEffects';

function rewound(over: Partial<ChatRewoundEffect> = {}): ChatRewoundEffect {
  return {
    op: 'chatRewound',
    chatId: 'chat-1',
    turnId: 'turn-7',
    scope: 'all',
    conversation: 'native',
    ...over,
  } as ChatRewoundEffect;
}

const token = (text: string): StreamEffect => ({ op: 'appendToken', key: 'session-1', text });

describe('partitionRewound', () => {
  it('returns the SAME array when there is nothing to lift', () => {
    // The allocation-free path: this is every frame of a normal turn.
    const effects: StreamEffect[] = [token('a'), token('b')];
    const result = partitionRewound(effects);
    expect(result.rewound).toEqual([]);
    expect(result.rest).toBe(effects);
  });

  it('handles an empty batch', () => {
    expect(partitionRewound([]).rewound).toEqual([]);
  });

  it('lifts the rewind out and leaves everything else in order', () => {
    const before = token('before');
    const after = token('after');
    const effect = rewound();
    const result = partitionRewound([before, effect, after]);

    expect(result.rewound).toEqual([effect]);
    expect(result.rest).toEqual([before, after]);
    // Ordering is the point: a fresh turn can legitimately start in the same
    // frame the rewind lands in, and its effects must still apply.
    expect(result.rest[0]).toBe(before);
    expect(result.rest[1]).toBe(after);
  });

  it('lifts several, should a batch ever carry more than one', () => {
    const a = rewound({ turnId: 'turn-1' });
    const b = rewound({ turnId: 'turn-2' });
    const result = partitionRewound([a, token('x'), b]);
    expect(result.rewound).toEqual([a, b]);
    expect(result.rest).toHaveLength(1);
  });

  it('never leaves a chatRewound in the batch handed to the block reducer', () => {
    const result = partitionRewound([rewound(), token('x')]);
    expect(result.rest.some((e) => e.op === 'chatRewound')).toBe(false);
  });
});

describe('rewoundMatchesChat', () => {
  it('accepts its own chat and rejects another', () => {
    expect(rewoundMatchesChat(rewound(), 'chat-1')).toBe(true);
    expect(rewoundMatchesChat(rewound(), 'chat-2')).toBe(false);
  });
});

describe('restoredPromptFrom', () => {
  it('hands the prompt back after a conversation rewind', () => {
    expect(restoredPromptFrom(rewound({ scope: 'all', prompt: 'retry this' }))).toBe('retry this');
    expect(restoredPromptFrom(rewound({ scope: 'conversation', prompt: 'retry this' }))).toBe(
      'retry this',
    );
  });

  it('withholds it after a code-only rewind', () => {
    // The prompt is still in the transcript; reseeding the composer would
    // invite sending the same message twice.
    expect(restoredPromptFrom(rewound({ scope: 'code', prompt: 'retry this' }))).toBeNull();
  });

  it('treats an absent or blank prompt as nothing to restore', () => {
    expect(restoredPromptFrom(rewound({ scope: 'all' }))).toBeNull();
    expect(restoredPromptFrom(rewound({ scope: 'all', prompt: '  \n ' }))).toBeNull();
  });
});
