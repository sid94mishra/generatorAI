// ────────────────────────────────────────────────────────────────
// rewindEffects — pulling `chatRewound` out of an effect batch.
//
// `StreamEventRouter` emits `{ op: 'chatRewound', … }` alongside the usual
// invalidations when the server announces `chat.rewound`. The shared
// `applyStreamEffects` deliberately does NOT know what to do with it: a
// rewind moves a query cache and a composer draft, and neither of those is
// part of the block model. So the host partitions it out — this is that
// partition, kept pure so the (fiddly) ordering rule is testable without a
// socket, a store or a screen.
//
// Ordering rule: a rewind invalidates everything that came BEFORE it in the
// same batch anyway, but effects that arrive AFTER it in the batch belong to
// the state the server kept — a fresh turn can legitimately start in the
// same frame. So the remaining effects keep their relative order and are
// still applied; only the rewind itself is lifted out.
// ────────────────────────────────────────────────────────────────

import type { StreamEffect } from '@generatorai/client-core';

/** The `chatRewound` effect, narrowed out of the effect union. */
export type ChatRewoundEffect = Extract<StreamEffect, { op: 'chatRewound' }>;

export interface RewoundPartition {
  /** In arrival order. Normally at most one per batch. */
  rewound: ChatRewoundEffect[];
  /** Everything else, in its original order, for `applyStreamEffects`. */
  rest: StreamEffect[];
}

/**
 * Split `chatRewound` effects out of a batch.
 *
 * Returns the SAME array instance for `rest` when there was nothing to lift,
 * which is every frame of a normal turn — this runs on the 60Hz flush path.
 */
export function partitionRewound(effects: readonly StreamEffect[]): RewoundPartition {
  let found = false;
  for (const effect of effects) {
    if (effect.op === 'chatRewound') {
      found = true;
      break;
    }
  }
  if (!found) return { rewound: [], rest: effects as StreamEffect[] };

  const rewound: ChatRewoundEffect[] = [];
  const rest: StreamEffect[] = [];
  for (const effect of effects) {
    if (effect.op === 'chatRewound') rewound.push(effect);
    else rest.push(effect);
  }
  return { rewound, rest };
}

/**
 * Does this rewind concern the chat on screen?
 *
 * A mux subscription is per chat scope, so in practice it always does — but
 * the scope is a SERVER-side filter and a client that trusted it blindly
 * would rewind the wrong composer the day a broadcast widens. Cheap to
 * check, and the check is the documentation.
 */
export function rewoundMatchesChat(effect: ChatRewoundEffect, chatId: string): boolean {
  return effect.chatId === chatId;
}

/**
 * Did this rewind drop conversation, and is there a prompt to hand back?
 *
 * Claude Code puts the rewound prompt back in the input box so it can be
 * edited and resent. A `code`-scope rewind must NOT: the prompt is still in
 * the transcript, and seeding the composer with it invites sending it twice.
 */
export function restoredPromptFrom(effect: ChatRewoundEffect): string | null {
  if (effect.scope === 'code') return null;
  const prompt = effect.prompt;
  return typeof prompt === 'string' && prompt.trim().length > 0 ? prompt : null;
}
