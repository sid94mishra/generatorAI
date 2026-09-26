// ────────────────────────────────────────────────────────────────
// ChatInput characterization — ATTACHMENTS and DICTATION.
//
// Pins (09-verification.md §5.1 "Attachments", "Dictation"; 03-component-
// inventory-domain.md §6.1 items 19, 21, 22): the `COMPOSER.attachments`
// gate on pick / paste / drop, `pasted-<ts>.<ext>` names, drop always
// `preventDefault`ed, remove by id, the image hover preview, stem-truncation
// that keeps the extension, muted pending-capture chips; and the dictation
// state labels, the 70 ms-per-word reveal with its 6-word catch-up, pause on
// typing/pasting (not clicking), Cancel's snapshot semantics, "scratch that",
// and the "Voice input" error toast. `useSpeechToText` is the controllable
// fake from `helpers/composerMocks.ts` (09 §5.1 names it).
//
// These assertions must stay unchanged through the P4 split of ChatInput;
// only the marked import line changes when the component moves.
// ────────────────────────────────────────────────────────────────

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chips,
  createComposerHarness,
  sendButton,
  setupComposerTest,
  speech,
  textbox,
  toastSpies,
  type SttStatusFixture,
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
afterEach(() => {
  vi.useRealTimers();
});
const renderComposer = createComposerHarness(ChatInput);

const fileInput = (): HTMLInputElement => document.querySelector('input[type="file"]') as HTMLInputElement;
const txt = (name: string) => new File(['x'], name, { type: 'text/plain' });

describe('ChatInput — picking files (09 §5.1)', () => {
  it('"Attach file" opens the hidden file input; picked files become chips', async () => {
    const user = userEvent.setup();
    renderComposer();
    const click = vi.spyOn(fileInput(), 'click');
    await user.click(screen.getByRole('button', { name: 'Attach file' }));
    expect(click).toHaveBeenCalledTimes(1);
    await user.upload(fileInput(), [txt('a.txt'), txt('b.txt')]);
    expect(chips().map((c) => c.textContent)).toEqual(['a.txt', 'b.txt']);
    // The input is reset so picking the same file again fires change.
    expect(fileInput().value).toBe('');
  });

  it('without COMPOSER.attachments there is no "Attach file" button', () => {
    renderComposer({}, { attachments: false });
    expect(screen.queryByRole('button', { name: 'Attach file' })).not.toBeInTheDocument();
  });

  it('"Attach file" is disabled while the composer is disabled', () => {
    renderComposer({ disabled: true });
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeDisabled();
  });
});

describe('ChatInput — paste (09 §5.1)', () => {
  it('a pasted unnamed image becomes pasted-<ts>.jpg (jpeg → jpg)', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    renderComposer();
    const notPrevented = fireEvent.paste(textbox(), {
      clipboardData: { files: [new File(['img'], '', { type: 'image/jpeg' })] },
    });
    expect(notPrevented).toBe(false);
    expect(chips()).toHaveLength(1);
    expect(chips()[0]).toHaveTextContent('pasted-1700000000000.jpg');
  });

  it('a pasted named file keeps its name', () => {
    renderComposer();
    fireEvent.paste(textbox(), { clipboardData: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] } });
    expect(chips()[0]).toHaveTextContent('shot.png');
  });

  it('a paste with no files is left to the textarea', () => {
    renderComposer();
    expect(fireEvent.paste(textbox(), { clipboardData: { files: [] } })).toBe(true);
    expect(chips()).toHaveLength(0);
  });

  it('without COMPOSER.attachments a pasted file is ignored (not prevented)', () => {
    renderComposer({}, { attachments: false });
    const notPrevented = fireEvent.paste(textbox(), {
      clipboardData: { files: [new File(['img'], '', { type: 'image/png' })] },
    });
    expect(notPrevented).toBe(true);
    expect(chips()).toHaveLength(0);
  });
});

describe('ChatInput — drop (09 §5.1; 03 §6.1 #21)', () => {
  it('dropped files become chips and the drop is preventDefaulted', () => {
    renderComposer();
    expect(fireEvent.dragOver(textbox())).toBe(false);
    expect(fireEvent.drop(textbox(), { dataTransfer: { files: [txt('dropped.txt')] } })).toBe(false);
    expect(chips()[0]).toHaveTextContent('dropped.txt');
  });

  it('without COMPOSER.attachments the drop is ignored but still preventDefaulted', () => {
    renderComposer({}, { attachments: false });
    expect(fireEvent.drop(textbox(), { dataTransfer: { files: [txt('dropped.txt')] } })).toBe(false);
    expect(chips()).toHaveLength(0);
  });
});

describe('ChatInput — chips (09 §5.1; 03 §6.1 #22)', () => {
  it('removes a chip by id, leaving the others', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.upload(fileInput(), [txt('a.txt'), txt('b.txt')]);
    await user.click(screen.getByRole('button', { name: 'Remove a.txt' }));
    expect(chips().map((c) => c.textContent)).toEqual(['b.txt']);
  });

  /** Hover a chip and let the preview's 250 ms open delay elapse on fake time. */
  async function hoverChip(file: File): Promise<void> {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderComposer();
    await user.upload(fileInput(), file);
    await user.hover(chips()[0]!);
    act(() => {
      vi.advanceTimersByTime(400);
    });
  }

  it('an image chip shows a hover preview of the picture', async () => {
    await hoverChip(new File(['png'], 'shot.png', { type: 'image/png' }));
    const previews = await screen.findAllByTestId('image-hover-preview');
    expect(within(previews[0]!).getAllByAltText('shot.png').length).toBeGreaterThan(0);
  });

  it('a non-image chip has no hover preview', async () => {
    await hoverChip(txt('a.txt'));
    expect(screen.queryByTestId('image-hover-preview')).not.toBeInTheDocument();
  });

  it('a long file name keeps its extension in its own element (only the stem truncates)', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.upload(fileInput(), [txt('element-buy-1789123456789.md'), txt('.env'), txt('notes.averyverylongext')]);
    const [long, dot, sentence] = chips();
    expect(within(long!).getByText('element-buy-1789123456789')).toBeInTheDocument();
    expect(within(long!).getByText('.md')).toBeInTheDocument();
    // A dotfile and an "extension" longer than 8 characters are not split.
    expect(within(dot!).getByText('.env')).toBeInTheDocument();
    expect(within(sentence!).getByText('notes.averyverylongext')).toBeInTheDocument();
    expect(long).toHaveAttribute('title', 'element-buy-1789123456789.md');
  });

  it('pending captures render as muted chips titled by source, with remove buttons', async () => {
    const user = userEvent.setup();
    const onRemovePendingCapture = vi.fn();
    renderComposer({
      pendingCaptures: [
        { id: 'c1', file: txt('sel.txt'), source: 'terminal', label: 'Terminal selection' },
        { id: 'c2', file: txt('element-a.md'), source: 'browser' },
      ],
      onRemovePendingCapture,
    });
    expect(chips()).toHaveLength(2);
    expect(chips()[0]).toHaveAttribute('title', 'terminal capture — Terminal selection');
    expect(chips()[1]).toHaveAttribute('title', 'browser capture — element-a.md');
    await user.click(screen.getByRole('button', { name: 'Remove element-a.md' }));
    expect(onRemovePendingCapture).toHaveBeenCalledWith('c2');
  });

  it('pending captures have no remove button without onRemovePendingCapture', () => {
    renderComposer({ pendingCaptures: [{ id: 'c1', file: txt('sel.txt'), source: 'terminal' }] });
    expect(chips()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Remove sel.txt' })).not.toBeInTheDocument();
  });
});

// ── Dictation ─────────────────────────────────────────────────────

const setStatus = (s: SttStatusFixture) => act(() => speech.setStatus(s));
const interim = (t: string) => act(() => speech.options.onInterim?.(t));
const segment = (t: string) => act(() => speech.options.onSegment?.(t));
const startDictation = (status: SttStatusFixture = 'listening') => {
  fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }));
  expect(speech.start).toHaveBeenCalledTimes(1);
  setStatus(status);
};

describe('ChatInput — dictation state labels (09 §5.1)', () => {
  it('walks idle → connecting → listening → paused → transcribing → error', async () => {
    const user = userEvent.setup();
    renderComposer();
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeEnabled();

    startDictation('connecting');
    expect(screen.getByRole('button', { name: 'Cancel voice input' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stop and insert text' })).toBeDisabled();

    setStatus('listening');
    expect(screen.getByRole('button', { name: 'Stop and insert text' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Stop and insert text' }));
    expect(speech.stop).toHaveBeenCalledTimes(1);

    setStatus('paused');
    await user.click(screen.getByRole('button', { name: 'Resume dictation' }));
    expect(speech.resume).toHaveBeenCalledTimes(1);

    setStatus('transcribing');
    expect(screen.getByRole('button', { name: 'Stop and insert text' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Resume dictation' })).not.toBeInTheDocument();

    speech.error = 'Microphone blocked';
    setStatus('error');
    const mic = screen.getByRole('button', { name: 'Start voice input' });
    expect(mic).toHaveAttribute('title', 'Microphone blocked');
  });

  it('renders no mic button when speech is unsupported', () => {
    renderComposer({}, { voiceSupported: false });
    expect(screen.queryByRole('button', { name: 'Start voice input' })).not.toBeInTheDocument();
  });

  it('the mic is disabled while streaming', () => {
    renderComposer({ isStreaming: true, onStop: vi.fn() });
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeDisabled();
  });

  it('errors show the "Voice input" toast', () => {
    renderComposer();
    act(() => speech.options.onError?.('Permission denied'));
    expect(toastSpies.error).toHaveBeenCalledWith('Voice input', expect.anything());
  });
});

describe('ChatInput — dictation reveal (09 §5.1)', () => {
  it('reveals partial text one word every 70 ms', () => {
    vi.useFakeTimers();
    renderComposer();
    startDictation();
    interim('one two three');
    expect(textbox().value).toMatch(/^one$/i);
    act(() => {
      vi.advanceTimersByTime(69);
    });
    expect(textbox().value).toMatch(/^one$/i);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(textbox().value).toMatch(/^one two$/i);
    act(() => {
      vi.advanceTimersByTime(70);
    });
    expect(textbox().value).toMatch(/^one two three$/i);
  });

  it('catches up at once when more than 6 words are pending', () => {
    vi.useFakeTimers();
    renderComposer();
    startDictation();
    interim('one two three four five six seven');
    expect(textbox().value).toMatch(/^one two three four five six seven$/i);
  });

  it('with exactly 6 words pending it still paces word by word', () => {
    vi.useFakeTimers();
    renderComposer();
    startDictation();
    interim('one two three four five six');
    expect(textbox().value).toMatch(/^one$/i);
  });

  it('a committed segment replaces the live partial', () => {
    vi.useFakeTimers();
    renderComposer();
    startDictation();
    interim('hello wor');
    segment('Hello world.');
    expect(textbox()).toHaveValue('Hello world.');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(textbox()).toHaveValue('Hello world.');
  });
});

describe('ChatInput — dictation pause (09 §5.1; 03 §6.1 #19)', () => {
  it('typing pauses listening dictation', async () => {
    const user = userEvent.setup();
    renderComposer();
    startDictation();
    await user.type(textbox(), 'x');
    expect(speech.pause).toHaveBeenCalled();
  });

  it('pasting pauses listening dictation', () => {
    renderComposer();
    startDictation();
    fireEvent.paste(textbox(), { clipboardData: { files: [] } });
    expect(speech.pause).toHaveBeenCalledTimes(1);
  });

  // DISCREPANCY (09 §5.1): the doc says "Typing, pasting or clicking pauses dictation" vs the code,
  // where a click only drops the pending caret restore and detaches the live region
  // (noteManualCaretMove, components/chat/ChatInput.tsx:1596-1599, 1214-1229) and never calls
  // pause — deliberately, per the comment at 1208-1213. 03 §6.1 #19 ("Typing (not clicking)") agrees
  // with the code.
  it('clicking into the box does not pause', () => {
    renderComposer();
    startDictation();
    fireEvent.click(textbox());
    expect(speech.pause).not.toHaveBeenCalled();
  });

  it('keys do not call pause unless the status is listening', () => {
    renderComposer();
    startDictation('paused');
    fireEvent.keyDown(textbox(), { key: 'a' });
    expect(speech.pause).not.toHaveBeenCalled();
  });
});

describe('ChatInput — dictation cancel and "scratch that" (09 §5.1; 03 §6.1 #19)', () => {
  it('Cancel restores the pre-dictation text when the user made no manual edit', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(textbox(), 'Draft:');
    startDictation();
    segment('first sentence.');
    interim('more');
    expect(textbox().value).toMatch(/^Draft: first sentence\. more$/i);
    await user.click(screen.getByRole('button', { name: 'Cancel voice input' }));
    expect(textbox()).toHaveValue('Draft:');
    expect(speech.cancel).toHaveBeenCalledTimes(1);
  });

  it('after a manual edit, Cancel drops only the uncommitted utterance', async () => {
    const user = userEvent.setup();
    renderComposer();
    startDictation();
    segment('kept sentence.');
    const committed = textbox().value;
    await user.type(textbox(), ' typed');
    setStatus('listening');
    interim('uncommitted');
    expect(textbox()).toHaveValue(`${committed} typed uncommitted`);
    await user.click(screen.getByRole('button', { name: 'Cancel voice input' }));
    expect(textbox()).toHaveValue(`${committed} typed`);
  });

  /** A streaming utterance: partial(s), then the committed segment. */
  const utter = (partial: string, committed: string) => {
    interim(partial);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    segment(committed);
  };

  it('"scratch that" at the start of an utterance retracts the previous one and keeps what follows', () => {
    vi.useFakeTimers();
    renderComposer();
    startDictation();
    utter('keep this', 'keep this.');
    utter('drop this', 'drop this.');
    expect(textbox().value).toMatch(/^keep this\. drop this\.$/i);
    // Retraction happens when the live region OPENS on text starting with "scratch that" —
    // here a first partial long enough (> 6 words) to be revealed in one step (ChatInput.tsx:985-993).
    interim('scratch that and put these seven words in');
    expect(textbox().value).toMatch(/^keep this\. and put these seven words in$/i);
    segment('scratch that and put these seven words in.');
    expect(textbox().value).toMatch(/^keep this\. and put these seven words in\.$/i);
  });

  // FIXED in P4-02 (known defect #2; useDictation). Was a DEFECT (09 §5.1): a bare "scratch that" never
  // retracts on web. The word-paced reveal (ChatInput.tsx:1046-1072) opens the live region on
  // "scratch" alone, and writeDictationRegion only honours the command when it OPENS a region
  // (ChatInput.tsx:985-993); the commit then writes an empty utterance and "drop this." stays.
  // Mobile's commitDictation retracts on commit (apps/mobile/src/voice/dictationCommit.ts).
  it('a bare "scratch that" (streaming engine) retracts the previous utterance', () => {
    vi.useFakeTimers();
    renderComposer();
    startDictation();
    utter('keep this', 'keep this.');
    utter('drop this', 'drop this.');
    utter('scratch that', 'scratch that');
    expect(textbox().value).toMatch(/^keep this\.$/i);
  });

  // FIXED in P4-02 (known defect #3). Was a DEFECT (09 §5.1): on a batch engine (segments only, no partials) onSegment inserts the
  // segment verbatim through insertAtCaret (ChatInput.tsx:1149-1153), so "scratch that" is
  // typed into the box ("Keep this. Drop this. Scratch that") instead of retracting "drop this.".
  it('a bare "scratch that" (batch engine) retracts the previous utterance', () => {
    renderComposer();
    startDictation();
    segment('keep this.');
    segment('drop this.');
    segment('scratch that');
    expect(textbox().value).toMatch(/^keep this\.$/i);
  });

  it('onFinal inserts the final text at the caret', async () => {
    renderComposer();
    startDictation();
    act(() => speech.options.onFinal?.('final words'));
    await waitFor(() => expect(textbox().value).toMatch(/final words/i));
    expect(sendButton()).toBeEnabled();
  });
});
