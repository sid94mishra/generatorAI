// ────────────────────────────────────────────────────────────────
// W13 — the settle-before-cancel rule as a SHIPPED conformance suite.
//
// `runCancellationSettlesPendingConformance` is exported from
// `src/conformance/index.ts`, so it is part of the battery every backend must
// pass — not a test local to this package. These cases drive it against the
// FauxProvider (which must pass) and against a deliberately broken harness
// (which must fail), because a conformance suite that cannot fail is not a
// conformance suite.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import type { IAgentHarness } from '@generatorai/core';

import { runCancellationSettlesPendingConformance } from '../../src/conformance/index.js';
import { FauxProvider } from '../../src/providers/faux/FauxProvider.js';

describe('W13 — conformance: cancellation settles pending work', () => {
  it('FauxProvider passes: its abort settles pending tool calls before cancelling', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await runCancellationSettlesPendingConformance(faux, undefined, 3_000);
  });

  it('FAILS a harness whose cancel leaves the handler parked (the deadlock)', async () => {
    // Exactly the bug the rule exists to prevent: `abortConversation` emits a
    // cancelled event and tears the stream down, but never settles the promise
    // the turn is parked on. Every "was a cancelled event emitted?" assertion
    // still passes; only a deadline catches it.
    class DeadlockingHarness {
      private readonly convs = new Set<string>();
      capabilities() {
        return {
          vision: false, reasoning: false, reasoningEfforts: [], planMode: false,
          mcpServers: false, approvalGating: 'none', hostTools: 'none', structuredOutput: 'none', skills: 'none',
          sessionPersistence: false, budgetTracking: false, computerUse: false,
        };
      }
      async createConversation(p: { conversationId: string }) { this.convs.add(p.conversationId); return p.conversationId; }
      hasLiveConversation(id: string) { return this.convs.has(id); }
      async deleteConversation(id: string) { this.convs.delete(id); }
      onConversationEvent(_id: string, _h: unknown) { return () => {}; }
      // Parks forever. Nothing resolves it.
      async sendPromptAndWait() { return new Promise<never>(() => { /* deadlocked */ }); }
      async abortConversation() { /* emits nothing, settles nothing */ }
    }

    await expect(
      runCancellationSettlesPendingConformance(
        new DeadlockingHarness() as unknown as IAgentHarness,
        {
          prompt: 'anything',
          duringTurn: (h, id) => h.abortConversation(id),
        },
        250,
      ),
    ).rejects.toThrow(/had not settled 250ms after cancellation/);
  });

  it('FAILS a harness that settles but emits no terminal event', async () => {
    class SilentHarness {
      private readonly convs = new Set<string>();
      capabilities() {
        return {
          vision: false, reasoning: false, reasoningEfforts: [], planMode: false,
          mcpServers: false, approvalGating: 'none', hostTools: 'none', structuredOutput: 'none', skills: 'none',
          sessionPersistence: false, budgetTracking: false, computerUse: false,
        };
      }
      async createConversation(p: { conversationId: string }) { this.convs.add(p.conversationId); return p.conversationId; }
      hasLiveConversation(id: string) { return this.convs.has(id); }
      async deleteConversation(id: string) { this.convs.delete(id); }
      onConversationEvent(_id: string, _h: unknown) { return () => {}; }
      private release: (() => void) | undefined;
      async sendPromptAndWait() {
        return new Promise<{ content: string }>((resolve) => {
          this.release = () => resolve({ content: '' });
        });
      }
      async abortConversation() { this.release?.(); /* but no terminal event */ }
    }

    await expect(
      runCancellationSettlesPendingConformance(
        new SilentHarness() as unknown as IAgentHarness,
        { prompt: 'anything', duringTurn: (h, id) => h.abortConversation(id) },
        1_000,
      ),
    ).rejects.toThrow(/no terminal event/);
  });

  it('refuses a scenario that never issues a cancellation', async () => {
    const faux = new FauxProvider();
    await faux.initialize();
    await expect(
      runCancellationSettlesPendingConformance(faux, { prompt: 'x' }, 200),
    ).rejects.toThrow(/`duringTurn` issues the cancellation/);
  });
});
