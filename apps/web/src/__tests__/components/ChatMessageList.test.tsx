// ────────────────────────────────────────────────────────────────
// D8 — the transcript is contained, not windowed.
//
// The decision record chose option (c) over JS virtualization for one stated
// reason: "containment preserves find-in-page, tab order, selection and the
// accessibility tree, all of which windowing breaks". The implementation was
// (a) — `@tanstack/react-virtual` with absolutely positioned rows — so above
// 80 messages all four were broken and nothing said so.
//
// These tests are the four properties, asserted as DOM facts. Against the
// windowed implementation the first three fail: the rows simply are not there.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@generatorai/shared';

import { ChatMessageList } from '@/components/chat/ChatMessageList.js';

afterEach(cleanup);

/** A transcript comfortably past the old 80-message virtualization threshold. */
function transcript(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    sessionId: 's1',
    role: (i % 2 === 0 ? 'user' : 'assistant') as ChatMessage['role'],
    content: `message body number ${i}`,
    timestamp: new Date(1_700_000_000_000 + i),
  }));
}

describe('D8 — every settled message stays in the document', () => {
  it('renders all 200 rows, not a window over them', () => {
    const { container } = render(<ChatMessageList messages={transcript(200)} />);
    expect(container.querySelectorAll('[data-chat-row]')).toHaveLength(200);
  });

  it('keeps the first and last message findable (⌘F / select-all / a11y tree)', () => {
    render(<ChatMessageList messages={transcript(200)} />);
    // A windowed list holds neither of these at the same time: whichever end
    // is off screen is absent from the DOM entirely, so find-in-page cannot
    // match it, select-all cannot copy it and a screen reader cannot reach it.
    expect(screen.getByText('message body number 0')).toBeInTheDocument();
    expect(screen.getByText('message body number 199')).toBeInTheDocument();
    expect(document.body.textContent).toContain('message body number 100');
  });

  it('leaves rows in document order, with no transform-based positioning', () => {
    const { container } = render(<ChatMessageList messages={transcript(200)} />);
    const rows = [...container.querySelectorAll<HTMLElement>('[data-chat-row]')];
    // Absolute positioning + translateY is what breaks selection across rows:
    // a drag selection follows document order, and windowing detaches the two.
    for (const row of rows) {
      expect(row.style.position).not.toBe('absolute');
      expect(row.style.transform).toBe('');
    }
    expect(rows[0]?.textContent).toContain('number 0');
    expect(rows[199]?.textContent).toContain('number 199');
  });
});

describe('D8 — containment is what does the work', () => {
  it('applies content-visibility and an intrinsic size to a long transcript', () => {
    const { container } = render(<ChatMessageList messages={transcript(200)} />);
    const row = container.querySelector<HTMLElement>('[data-chat-row]');
    expect(row?.style.contentVisibility).toBe('auto');
    // `auto <estimate>`: the keyword is what makes the browser remember each
    // row's real height, so the estimate only matters for the first pass.
    expect(row?.style.containIntrinsicSize).toMatch(/^auto /);
  });

  it('does not pay for containment on a short transcript', () => {
    const { container } = render(<ChatMessageList messages={transcript(5)} />);
    const row = container.querySelector<HTMLElement>('[data-chat-row]');
    expect(container.querySelectorAll('[data-chat-row]')).toHaveLength(5);
    expect(row?.style.contentVisibility).toBe('');
  });
});
