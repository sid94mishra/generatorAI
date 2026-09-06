// ────────────────────────────────────────────────────────────────
// ChatPage — does not re-render on every streamed token
//
// Mounting the real `ChatPage` needs its whole dependency graph live (SSE,
// several platform endpoints some hooks call directly rather than through
// `IPlatformClient`, `fetch`, a highlight Worker, …) — exactly the situation
// `RightPanePanels.test.tsx` describes for `RightPane`'s panels, and it
// solves it the same way this test does: a small harness that reproduces
// the REAL mechanism against the REAL `useStreamStore`, and counts renders
// with a bump-a-counter component, rather than mounting the whole page.
//
// The mechanism under test is exactly what `ChatPage.tsx` does today:
//   - the page subscribes to NARROW, primitive-returning selectors
//     (status, turnUserMessage, a derived boolean, …) instead of the whole
//     per-session record, whose identity `appendToken` replaces on every
//     streamed token (see `streamStore.test.ts`: "appendToken merges
//     consecutive text blocks" — the record is still recreated even though
//     the block count does not change);
//   - the one place that needs the live, per-token `blocks`/`text` is an
//     isolated leaf (`LiveTranscript` in ChatPage.tsx) that subscribes to
//     the full record ITSELF, so its frequent re-renders never propagate up
//     to the page.
//
// If `ChatPage.tsx` regresses back to `useStreamStore((s) =>
// s.streams[sessionId])` at the page level, the "old" case below is exactly
// what would happen: every token re-renders the whole page.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { useStreamStore } from '@/stores/streamStore.js';

const SESSION_ID = 'sess-1';

beforeEach(() => {
  useStreamStore.setState({ streams: {} });
});
afterEach(cleanup);

describe('ChatPage — stream subscription does not re-render the page on every token', () => {
  it('BEFORE (whole-record selector at the page level): every token re-renders the page', () => {
    let pageRenders = 0;

    function OldPage() {
      pageRenders++;
      // This is exactly the pattern ChatPage.tsx used to use.
      const stream = useStreamStore((s) => s.streams[SESSION_ID]);
      return <div data-testid="text">{stream?.text ?? ''}</div>;
    }

    render(<OldPage />);
    const before = pageRenders;

    // Each token is its own `act()` — a real SSE stream delivers tokens as
    // separate events (separate commits), not one batched update. Looping
    // `appendToken` inside a SINGLE `act()` would let React 18's automatic
    // batching coalesce all 60 into one commit, which is not what streaming
    // actually does and would hide the bug this test exists to catch.
    for (let i = 0; i < 60; i++) {
      act(() => {
        useStreamStore.getState().appendToken(SESSION_ID, 'x');
      });
    }

    // 60 "token frames" — the whole-record selector re-renders on every one.
    expect(pageRenders).toBe(before + 60);
  });

  it('AFTER (narrow selectors + an isolated leaf): the page renders once; only the leaf tracks tokens', () => {
    let pageRenders = 0;
    let transcriptRenders = 0;

    // Mirrors `LiveTranscript` in ChatPage.tsx: the ONE place that
    // subscribes to the full live record, isolated behind its own
    // component boundary.
    function LiveTranscript({ sessionId }: { sessionId: string }) {
      transcriptRenders++;
      const stream = useStreamStore((s) => s.streams[sessionId]);
      return <div data-testid="text">{stream?.text ?? ''}</div>;
    }

    // Mirrors ChatPage.tsx's own top-level selectors: primitives derived
    // from the record, which `appendToken` does not change (status stays
    // 'streaming', block count does not grow — see streamStore.test.ts).
    function NewPage({ sessionId }: { sessionId: string }) {
      pageRenders++;
      const streamStatus = useStreamStore((s) => s.streams[sessionId]?.status);
      const blocksLength = useStreamStore((s) => s.streams[sessionId]?.blocks.length ?? 0);
      return (
        <div>
          <span data-testid="status">{streamStatus ?? 'idle'}</span>
          <span data-testid="blocks">{blocksLength}</span>
          <LiveTranscript sessionId={sessionId} />
        </div>
      );
    }

    render(<NewPage sessionId={SESSION_ID} />);
    const pageBefore = pageRenders;
    const transcriptBefore = transcriptRenders;

    act(() => {
      // First token: status flips idle -> streaming, a text block is
      // created. This is the one legitimate page-level re-render.
      useStreamStore.getState().appendToken(SESSION_ID, 'h');
    });
    expect(pageRenders).toBe(pageBefore + 1);
    expect(transcriptRenders).toBe(transcriptBefore + 1);

    const pageAfterFirstToken = pageRenders;
    const transcriptAfterFirstToken = transcriptRenders;

    // 59 more "token frames", each its own commit (see the note above about
    // why each is a separate `act()`). Status and block count are unchanged
    // (appendToken merges into the existing text block), so the page's
    // selectors keep returning the SAME primitives and Zustand skips the
    // re-render. Only the leaf, which needs the growing text, re-renders.
    for (let i = 0; i < 59; i++) {
      act(() => {
        useStreamStore.getState().appendToken(SESSION_ID, 'i');
      });
    }

    expect(pageRenders).toBe(pageAfterFirstToken);
    expect(transcriptRenders).toBe(transcriptAfterFirstToken + 59);
  });
});
