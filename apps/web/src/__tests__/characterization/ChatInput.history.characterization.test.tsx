// ────────────────────────────────────────────────────────────────
// ChatInput characterization — PROMPT HISTORY (↑ / ↓) and DRAFT RESTORE.
//
// Pins (09-verification.md §5.1 "Prompt history", "Draft restore";
// 03-component-inventory-domain.md §6.1 items 12–14): ↑ only with a collapsed
// selection on the first line, ↓ only on the last line; newest-first recall
// from the draft; falling through past the oldest; ↓ past the newest restoring
// the parked draft (text + attachments); editing a recalled prompt making it
// the draft; attachment re-materialisation with per-chip failure; the recall
// token discarding stale results; the local 50-entry cap; and the rewind's
// `restoredDraft {text, at}` applied once per `at`.
//
// These assertions must stay unchanged through the P4 split of ChatInput;
// only the marked import line changes when the component moves.
// ────────────────────────────────────────────────────────────────

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  chips,
  createComposerHarness,
  deferred,
  setupComposerTest,
  slashCommand,
  textbox,
  toastSpies,
} from './helpers/renderComposer.js';

// Import under test — the only line that changes when P4 moves the file.
import { Composer as ChatInput } from '@/blocks/composer/index.js';

vi.mock('@/hooks/composerQueries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).composerQueriesModule(await importOriginal()));
vi.mock('@/hooks/queries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).queriesModule(await importOriginal()));
vi.mock('@/hooks/harnessQueries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).harnessQueriesModule(await importOriginal()));
vi.mock('@/hooks/projectQueries.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).projectQueriesModule(await importOriginal()));
vi.mock('@/platform/surfaceCapabilities.js', async (importOriginal) =>
  (await import('./helpers/composerMocks.js')).surfaceCapabilitiesModule(await importOriginal()));
vi.mock('@/hooks/useSpeechToText.js', async () =>
  (await import('./helpers/composerMocks.js')).speechModule());

setupComposerTest();
const renderComposer = createComposerHarness(ChatInput);

interface Att { name: string; mimeType: string; url?: string; file?: File }
const entry = (id: string, text: string, ts: number, attachments: Att[] = []) => ({ id, text, ts, attachments });
const HISTORY = [entry('h1', 'first prompt', 1), entry('h2', 'second prompt', 2), entry('h3', 'third prompt', 3)];

/** Fire ↑/↓ on the textarea; returns whether the composer consumed it (preventDefault). */
const press = (key: 'ArrowUp' | 'ArrowDown'): boolean => !fireEvent.keyDown(textbox(), { key });
const fileInput = (): HTMLInputElement => document.querySelector('input[type="file"]') as HTMLInputElement;

describe('ChatInput — ↑ / ↓ gating (09 §5.1; 03 §6.1 #12)', () => {
  it('↑ on the first line with a collapsed selection recalls the newest prompt', () => {
    renderComposer({ promptHistory: HISTORY });
    expect(press('ArrowUp')).toBe(true);
    expect(textbox()).toHaveValue('third prompt');
  });

  it('↑ with a non-collapsed selection falls through', async () => {
    const user = userEvent.setup();
    renderComposer({ promptHistory: HISTORY });
    await user.type(textbox(), 'draft');
    textbox().setSelectionRange(0, 3);
    expect(press('ArrowUp')).toBe(false);
    expect(textbox()).toHaveValue('draft');
  });

  it('↑ with the caret below the first line falls through', async () => {
    const user = userEvent.setup();
    renderComposer({ promptHistory: HISTORY });
    await user.type(textbox(), 'line one{Shift>}{Enter}{/Shift}line two');
    textbox().setSelectionRange(12, 12);
    expect(press('ArrowUp')).toBe(false);
    expect(textbox()).toHaveValue('line one\nline two');
    textbox().setSelectionRange(3, 3);
    expect(press('ArrowUp')).toBe(true);
    expect(textbox()).toHaveValue('third prompt');
  });

  it('↓ works only with the caret on the last line', async () => {
    renderComposer({ promptHistory: [entry('m1', 'older', 1), entry('m2', 'multi\nline', 2)] });
    press('ArrowUp'); // → "multi\nline", caret at its end (second line)
    expect(textbox()).toHaveValue('multi\nline');
    await waitFor(() => expect(textbox().selectionStart).toBe('multi\nline'.length));
    // On the recalled entry's second line ↑ is ordinary caret movement…
    expect(press('ArrowUp')).toBe(false);
    // …and from its first line it walks on.
    textbox().setSelectionRange(0, 0);
    expect(press('ArrowUp')).toBe(true);
    expect(textbox()).toHaveValue('older');
    press('ArrowDown');
    expect(textbox()).toHaveValue('multi\nline');
    await waitFor(() => expect(textbox().selectionStart).toBe('multi\nline'.length));
    textbox().setSelectionRange(0, 0); // first line, not the last
    expect(press('ArrowDown')).toBe(false);
    expect(textbox()).toHaveValue('multi\nline');
  });

  it('↓ while showing the draft falls through', async () => {
    const user = userEvent.setup();
    renderComposer({ promptHistory: HISTORY });
    await user.type(textbox(), 'draft');
    expect(press('ArrowDown')).toBe(false);
    expect(textbox()).toHaveValue('draft');
  });

  it('with no history, ↑ falls through', () => {
    renderComposer({ promptHistory: [] });
    expect(press('ArrowUp')).toBe(false);
  });

  it('modified arrows (Shift/Alt/Ctrl/Meta) never walk history', () => {
    renderComposer({ promptHistory: HISTORY });
    for (const mod of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) {
      expect(fireEvent.keyDown(textbox(), { key: 'ArrowUp', [mod]: true })).toBe(true);
    }
    expect(textbox()).toHaveValue('');
  });
});

describe('ChatInput — walking history (09 §5.1; 03 §6.1 #12)', () => {
  it('walks newest → oldest, then falls through past the oldest', () => {
    renderComposer({ promptHistory: HISTORY });
    press('ArrowUp');
    press('ArrowUp');
    expect(textbox()).toHaveValue('second prompt');
    press('ArrowUp');
    expect(textbox()).toHaveValue('first prompt');
    expect(press('ArrowUp')).toBe(false);
    expect(textbox()).toHaveValue('first prompt');
  });

  it('↓ past the newest restores the parked draft — text and attachments', async () => {
    const user = userEvent.setup();
    renderComposer({ promptHistory: HISTORY });
    await user.upload(fileInput(), new File(['x'], 'notes.txt', { type: 'text/plain' }));
    await user.type(textbox(), 'my draft');
    textbox().setSelectionRange(0, 0);
    press('ArrowUp');
    expect(textbox()).toHaveValue('third prompt');
    expect(chips()).toHaveLength(0);
    press('ArrowUp');
    press('ArrowDown');
    expect(textbox()).toHaveValue('third prompt');
    press('ArrowDown');
    expect(textbox()).toHaveValue('my draft');
    expect(chips()).toHaveLength(1);
    expect(chips()[0]).toHaveTextContent('notes.txt');
  });

  it('typing into a recalled prompt makes it the draft', async () => {
    const user = userEvent.setup();
    renderComposer({ promptHistory: HISTORY });
    press('ArrowUp');
    await waitFor(() => expect(textbox().selectionStart).toBe('third prompt'.length));
    await user.type(textbox(), '!');
    expect(textbox()).toHaveValue('third prompt!');
    // No longer browsing: ↓ has nowhere to go.
    expect(press('ArrowDown')).toBe(false);
    // ↑ parks the edited text as the draft and ↓ brings it back.
    press('ArrowUp');
    expect(textbox()).toHaveValue('third prompt');
    press('ArrowDown');
    expect(textbox()).toHaveValue('third prompt!');
  });

  it('recall closes an open slash menu', async () => {
    const user = userEvent.setup();
    renderComposer({ promptHistory: HISTORY }, { slashCommands: [slashCommand('review')] });
    await user.type(textbox(), '/');
    expect(screen.getByText('Commands & skills')).toBeInTheDocument();
    // With the menu open ↑ drives the menu, not history (menu navigation takes priority).
    expect(press('ArrowUp')).toBe(true);
    expect(textbox()).toHaveValue('/');
  });
});

describe('ChatInput — recalled attachments (09 §5.1; 03 §6.1 #13)', () => {
  it('re-fetches persisted attachments by URL and reuses in-memory files', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(['png-bytes'], { type: 'image/png' })));
    vi.stubGlobal('fetch', fetchMock);
    const local = new File(['a'], 'local.txt', { type: 'text/plain' });
    renderComposer({
      promptHistory: [
        entry('h1', 'with files', 1, [
          { name: 'shot.png', mimeType: 'image/png', url: '/api/attachments/1' },
          { name: 'local.txt', mimeType: 'text/plain', file: local },
        ]),
      ],
    });
    press('ArrowUp');
    expect(textbox()).toHaveValue('with files');
    await waitFor(() => expect(chips()).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/attachments/1', { cache: 'force-cache' });
    expect(chips().map((c) => c.textContent)).toEqual(['shot.png', 'local.txt']);
  });

  it('a failed fetch drops only that chip and shows a warning; the recall still happens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/bad') ? new Response('gone', { status: 404 }) : new Response(new Blob(['ok'])),
      ),
    );
    renderComposer({
      promptHistory: [
        entry('h1', 'two files', 1, [
          { name: 'good.txt', mimeType: 'text/plain', url: '/a/good' },
          { name: 'bad.txt', mimeType: 'text/plain', url: '/a/bad' },
        ]),
      ],
    });
    press('ArrowUp');
    expect(textbox()).toHaveValue('two files');
    await waitFor(() =>
      expect(toastSpies.error).toHaveBeenCalledWith('Could not restore attachment "bad.txt"', expect.anything()),
    );
    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(chips()[0]).toHaveTextContent('good.txt');
  });

  it('a stale recall does not overwrite a newer one (recall token)', async () => {
    const slow = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => slow.promise));
    renderComposer({
      promptHistory: [
        entry('h1', 'older, no files', 1),
        entry('h2', 'newer, slow file', 2, [{ name: 'slow.txt', mimeType: 'text/plain', url: '/slow' }]),
      ],
    });
    press('ArrowUp');
    expect(textbox()).toHaveValue('newer, slow file');
    press('ArrowUp');
    expect(textbox()).toHaveValue('older, no files');
    await act(async () => slow.resolve(new Response(new Blob(['late']))));
    expect(textbox()).toHaveValue('older, no files');
    expect(chips()).toHaveLength(0);
  });
});

describe('ChatInput — local history (09 §5.1)', () => {
  it('a prompt sent this session is recallable before the server echoes it', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn, promptHistory: [] });
    await user.type(textbox(), 'just sent');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(customSendFn).toHaveBeenCalled());
    expect(textbox()).toHaveValue('');
    press('ArrowUp');
    expect(textbox()).toHaveValue('just sent');
  });

  it('keeps only the last 50 local prompts', async () => {
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn, promptHistory: [] });
    for (let i = 0; i < 51; i += 1) {
      fireEvent.change(textbox(), { target: { value: `p${i}` } });
      fireEvent.keyDown(textbox(), { key: 'Enter' });
      await waitFor(() => expect(customSendFn).toHaveBeenCalledTimes(i + 1));
      await waitFor(() => expect(textbox()).toHaveValue(''));
    }
    for (let i = 0; i < 50; i += 1) expect(press('ArrowUp')).toBe(true);
    expect(textbox()).toHaveValue('p1');
    expect(press('ArrowUp')).toBe(false);
  });
});

describe('ChatInput — restored draft (09 §5.1; 03 §6.1 #14)', () => {
  it('applies the text once per `at`, focuses the box with the caret at the end, and never sends', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    const r = renderComposer({ customSendFn, restoredDraft: { text: 'rewound prompt', at: 1 } });
    expect(textbox()).toHaveValue('rewound prompt');
    await waitFor(() => expect(textbox()).toHaveFocus());
    expect(textbox().selectionStart).toBe('rewound prompt'.length);
    expect(textbox().selectionEnd).toBe('rewound prompt'.length);

    await user.type(textbox(), ' edited');
    // Same token again (a re-render with a fresh object): ignored.
    r.update({ restoredDraft: { text: 'rewound prompt', at: 1 } });
    expect(textbox()).toHaveValue('rewound prompt edited');

    // A new token is a new offer, even with the same text.
    r.update({ restoredDraft: { text: 'rewound prompt', at: 2 } });
    expect(textbox()).toHaveValue('rewound prompt');
    expect(customSendFn).not.toHaveBeenCalled();
  });

  it('leaves history mode: ↓ after a restore does not bring back a parked draft', async () => {
    const r = renderComposer({ promptHistory: HISTORY });
    press('ArrowUp');
    expect(textbox()).toHaveValue('third prompt');
    r.update({ restoredDraft: { text: 'from rewind', at: 5 } });
    expect(textbox()).toHaveValue('from rewind');
    expect(press('ArrowDown')).toBe(false);
    expect(textbox()).toHaveValue('from rewind');
  });
});
