// ────────────────────────────────────────────────────────────────
// ChatInput characterization — SEND.
//
// Pins (09-verification.md §5.1 "Send", "Stop / two-phase stop" rendering,
// "Blocking bars"; 03-component-inventory-domain.md §6.1 items 2, 3, 8–11,
// 20, 22): the canSend truth table, Enter / Shift / Ctrl / Cmd semantics
// gated on `sendShortcut`, the `sendingRef` re-entrancy guard, canned prompts
// for attachment-only sends, slash-command formatting + template failure,
// builtin commands awaited before dispatch, draft restore on a send error,
// the IME-Enter DEFECT, the Stop control's rendering, and the workspace-prep /
// pending-interaction bars.
//
// These assertions must stay unchanged through the P4 split of ChatInput;
// only the marked import line changes when the component moves.
// ────────────────────────────────────────────────────────────────

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  builtinCommand,
  chips,
  composerState,
  createComposerHarness,
  deferred,
  sendButton,
  setupComposerTest,
  slashCommand,
  streamSpies,
  textbox,
  toastSpies,
} from './helpers/renderComposer.js';

// Import under test — the only line that changes when P4 moves the file.
import { ChatInput } from '@/components/chat/ChatInput.js';

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

const fileInput = (): HTMLInputElement => document.querySelector('input[type="file"]') as HTMLInputElement;
const capture = (name = 'element-buy-1.md', id = 'cap-1') => ({
  id,
  file: new File(['note'], name, { type: 'text/markdown' }),
  source: 'browser' as const,
});

describe('ChatInput — canSend truth table (09 §5.1; 03 §6.1 #2)', () => {
  type Content = 'text' | 'pill' | 'attachments' | 'captures';
  type Blocker = 'none' | 'disabled' | 'loading' | 'interaction' | 'workspace-prep';

  async function arrange(content: Content) {
    const user = userEvent.setup();
    const r = renderComposer(
      content === 'captures' ? { pendingCaptures: [capture('notes.md')] } : {},
      { slashCommands: [slashCommand('review')] },
    );
    if (content === 'text') await user.type(textbox(), 'hello');
    if (content === 'pill') {
      await user.type(textbox(), '/rev');
      await user.keyboard('{Enter}');
      expect(screen.getByRole('button', { name: 'Remove /review command' })).toBeInTheDocument();
    }
    if (content === 'attachments') {
      await user.upload(fileInput(), new File(['x'], 'a.txt', { type: 'text/plain' }));
      expect(chips()).toHaveLength(1);
    }
    return r;
  }

  function block(r: Awaited<ReturnType<typeof arrange>>, blocker: Blocker) {
    if (blocker === 'disabled') r.update({ disabled: true });
    if (blocker === 'loading') {
      composerState.sendPending = true;
      r.update({});
    }
    if (blocker === 'interaction') r.update({ pendingInteractionLabel: 'Waiting on you' });
    if (blocker === 'workspace-prep') r.update({ workspacePrep: { status: 'preparing' } });
  }

  it('is false with nothing to send', () => {
    renderComposer();
    expect(sendButton()).toBeDisabled();
  });

  const contents: Content[] = ['text', 'pill', 'attachments', 'captures'];
  const blockers: Blocker[] = ['none', 'disabled', 'loading', 'interaction', 'workspace-prep'];
  for (const content of contents) {
    for (const blocker of blockers) {
      const expected = blocker === 'none';
      it(`${content} × ${blocker} → Send ${expected ? 'enabled' : 'disabled'}`, async () => {
        const r = await arrange(content);
        block(r, blocker);
        if (expected) expect(sendButton()).toBeEnabled();
        else expect(sendButton()).toBeDisabled();
      });
    }
  }

  it('whitespace-only text does not count', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(textbox(), '   ');
    expect(sendButton()).toBeDisabled();
  });
});

describe('ChatInput — Enter semantics (09 §5.1; 03 §6.1 #3)', () => {
  it('plain Enter sends the trimmed text through customSendFn and clears the box', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn });
    await user.type(textbox(), '  hello there  ');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(customSendFn).toHaveBeenCalledTimes(1));
    expect(customSendFn).toHaveBeenCalledWith({ prompt: 'hello there', attachments: [], mode: 'auto' });
    expect(streamSpies.startPending).toHaveBeenCalledWith('s1', 'hello there');
    expect(textbox()).toHaveValue('');
  });

  it.each([
    ['Shift', '{Shift>}{Enter}{/Shift}'],
    ['Ctrl', '{Control>}{Enter}{/Control}'],
    ['Cmd', '{Meta>}{Enter}{/Meta}'],
  ])('%s+Enter inserts a newline at the caret instead of sending', async (_label, keys) => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn });
    await user.type(textbox(), 'abcd');
    textbox().setSelectionRange(2, 2);
    await user.keyboard(keys);
    expect(textbox()).toHaveValue('ab\ncd');
    // The caret lands after the inserted newline (restored on the next frame).
    await waitFor(() => expect(textbox().selectionStart).toBe(3));
    expect(customSendFn).not.toHaveBeenCalled();
  });

  it('on a surface without sendShortcut, Enter never sends (the button still does)', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn }, { sendShortcut: false });
    await user.type(textbox(), 'hello');
    await user.keyboard('{Enter}');
    expect(customSendFn).not.toHaveBeenCalled();
    // Enter is left to the textarea's own newline behaviour.
    expect(textbox()).toHaveValue('hello\n');
    await user.click(sendButton());
    await waitFor(() => expect(customSendFn).toHaveBeenCalledTimes(1));
  });

  it('a second Enter while a send is in flight is ignored (sendingRef)', async () => {
    const inFlight = deferred();
    const customSendFn = vi.fn(() => inFlight.promise);
    // Captures keep canSend true after the text clears, so only the guard stops the second send.
    renderComposer({ customSendFn, pendingCaptures: [capture('notes.md')] });
    fireEvent.keyDown(textbox(), { key: 'Enter' });
    fireEvent.keyDown(textbox(), { key: 'Enter' });
    await waitFor(() => expect(customSendFn).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(textbox(), { key: 'Enter' });
    await act(async () => inFlight.resolve());
    expect(customSendFn).toHaveBeenCalledTimes(1);
    // Released once the first send settles.
    fireEvent.keyDown(textbox(), { key: 'Enter' });
    await waitFor(() => expect(customSendFn).toHaveBeenCalledTimes(2));
  });

  // FIXED in P4-02 (known defect #1; useComposerKeymap). Was: handleKeyDown (ChatInput.tsx:1299-1311) never checked
  // `e.nativeEvent.isComposing` / keyCode 229, so the Enter that confirms an IME candidate
  // (Japanese, Chinese, Korean input) sent the half-composed message.
  it('does not send on Enter during IME composition', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn });
    await user.type(textbox(), 'にほん');
    fireEvent.keyDown(textbox(), { key: 'Enter', keyCode: 229, isComposing: true });
    await act(async () => {});
    expect(customSendFn).not.toHaveBeenCalled();
  });

  it('without customSendFn, sends through useSendPrompt with the files', async () => {
    const user = userEvent.setup();
    renderComposer();
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    await user.upload(fileInput(), file);
    await user.type(textbox(), 'look');
    await user.click(sendButton());
    await waitFor(() => expect(composerState.mutateAsync).toHaveBeenCalledTimes(1));
    expect(composerState.mutateAsync).toHaveBeenCalledWith({ prompt: 'look', attachments: [file] });
  });

  it('awaits onBeforeSend before dispatching, and passes the agent mode', async () => {
    const user = userEvent.setup();
    const before = deferred();
    const onBeforeSend = vi.fn(() => before.promise);
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ onBeforeSend, customSendFn, agentMode: 'plan' });
    await user.type(textbox(), 'plan it');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onBeforeSend).toHaveBeenCalled());
    expect(customSendFn).not.toHaveBeenCalled();
    await act(async () => before.resolve());
    await waitFor(() => expect(customSendFn).toHaveBeenCalledWith({ prompt: 'plan it', attachments: [], mode: 'plan' }));
  });
});

describe('ChatInput — attachment-only sends (09 §5.1; 03 §6.1 #9)', () => {
  it('attachments with an empty prompt send the canned sentence', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn });
    const file = new File(['x'], 'report.pdf', { type: 'application/pdf' });
    await user.upload(fileInput(), file);
    await user.click(sendButton());
    await waitFor(() => expect(customSendFn).toHaveBeenCalled());
    expect(customSendFn).toHaveBeenCalledWith({
      prompt: 'Please take a look at the attached file(s).',
      attachments: [file],
      mode: 'auto',
    });
  });

  it.each(['element-buy-17.md', 'region-17.png'])(
    'a capture named %s uses the browser-comment sentence (captures stay with the page)',
    async (name) => {
      const user = userEvent.setup();
      const customSendFn = vi.fn(async () => undefined);
      renderComposer({ customSendFn, pendingCaptures: [capture(name)] });
      await user.click(sendButton());
      await waitFor(() => expect(customSendFn).toHaveBeenCalled());
      expect(customSendFn).toHaveBeenCalledWith({
        prompt:
          'Please address the attached browser comment(s). Each .md file has my note and the element it is about; the .png shows it.',
        attachments: [],
        mode: 'auto',
      });
    },
  );
});

describe('ChatInput — slash-command send (09 §5.1; 03 §6.1 #8, #11)', () => {
  it('applies cmd.format(raw, template) with the loaded template', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    const cmd = slashCommand('review', { loadTemplate: async () => 'TEMPLATE' });
    renderComposer({ customSendFn }, { slashCommands: [cmd] });
    await user.type(textbox(), '/review');
    await user.keyboard('{Enter}');
    await user.type(textbox(), 'the diff');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(customSendFn).toHaveBeenCalled());
    expect(customSendFn).toHaveBeenCalledWith({ prompt: '[review]{TEMPLATE} the diff', attachments: [], mode: 'auto' });
  });

  it('a template load failure toasts a warning and formats the raw input without a template', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    const cmd = slashCommand('review', { loadTemplate: async () => Promise.reject(new Error('404')) });
    renderComposer({ customSendFn }, { slashCommands: [cmd] });
    await user.type(textbox(), '/review');
    await user.keyboard('{Enter}');
    await user.type(textbox(), 'the diff');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(customSendFn).toHaveBeenCalled());
    expect(toastSpies.warning).toHaveBeenCalledWith('Could not load the "review" prompt template', expect.anything());
    expect(customSendFn).toHaveBeenCalledWith({ prompt: '[review] the diff', attachments: [], mode: 'auto' });
  });

  it('a builtin awaits onBuiltinCommand(id) before dispatch', async () => {
    const user = userEvent.setup();
    const builtin = deferred();
    const onBuiltinCommand = vi.fn(() => builtin.promise);
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn, onBuiltinCommand }, { slashCommands: [builtinCommand('browser')] });
    await user.type(textbox(), '/browser');
    await user.keyboard('{Enter}');
    await user.type(textbox(), 'open the app');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onBuiltinCommand).toHaveBeenCalledWith('builtin:browser'));
    expect(customSendFn).not.toHaveBeenCalled();
    await act(async () => builtin.resolve());
    await waitFor(() =>
      expect(customSendFn).toHaveBeenCalledWith({
        prompt: 'Use the integrated browser.\n\nTask: open the app',
        attachments: [],
        mode: 'auto',
      }),
    );
  });

  it("a builtin's onBuiltinCommand failure is swallowed and the send goes ahead", async () => {
    const user = userEvent.setup();
    const onBuiltinCommand = vi.fn(async () => Promise.reject(new Error('panel failed')));
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn, onBuiltinCommand }, { slashCommands: [builtinCommand('terminal')] });
    await user.type(textbox(), '/terminal');
    await user.keyboard('{Enter}');
    await user.type(textbox(), 'ls');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(customSendFn).toHaveBeenCalledTimes(1));
    expect(textbox()).toHaveValue('');
    expect(streamSpies.clearStream).not.toHaveBeenCalled();
  });

  it('a non-builtin command does not call onBuiltinCommand', async () => {
    const user = userEvent.setup();
    const onBuiltinCommand = vi.fn();
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn, onBuiltinCommand }, { slashCommands: [slashCommand('review')] });
    await user.type(textbox(), '/review');
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(customSendFn).toHaveBeenCalled());
    expect(onBuiltinCommand).not.toHaveBeenCalled();
  });
});

describe('ChatInput — send failure (09 §5.1; 03 §6.1 #10)', () => {
  it('restores text, command pill and attachments, and clears the stream', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => Promise.reject(new Error('409')));
    renderComposer({ customSendFn }, { slashCommands: [slashCommand('review')] });
    await user.type(textbox(), '/review');
    await user.keyboard('{Enter}');
    await user.upload(fileInput(), new File(['x'], 'a.txt', { type: 'text/plain' }));
    await user.type(textbox(), 'the diff');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(streamSpies.clearStream).toHaveBeenCalledWith('s1'));
    expect(textbox()).toHaveValue('the diff');
    expect(screen.getByRole('button', { name: 'Remove /review command' })).toBeInTheDocument();
    expect(chips()).toHaveLength(1);
    expect(sendButton()).toBeEnabled();
  });
});

describe('ChatInput — Stop rendering (09 §5.1; 03 §6.1 #20)', () => {
  it('shows Send, not Stop, when not streaming', () => {
    renderComposer({ isStreaming: false, onStop: vi.fn() });
    expect(sendButton()).toBeInTheDocument();
  });

  it('while streaming, the Stop button is named by stopState.label and disabled while !enabled', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const r = renderComposer({
      isStreaming: true,
      onStop,
      stopState: { label: 'Stop', enabled: true, forceAvailable: false },
    });
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    r.update({ stopState: { label: 'Stopping…', enabled: false, forceAvailable: false } });
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
  });

  it('without stopState the Stop button is "Stop generation" and enabled', () => {
    renderComposer({ isStreaming: true, onStop: vi.fn() });
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeEnabled();
  });

  it('forceAvailable renders the "Force reset" pill', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    renderComposer({
      isStreaming: true,
      onStop,
      stopState: { label: 'Force reset', enabled: true, forceAvailable: true },
    });
    const pill = screen.getByRole('button', { name: 'Force reset' });
    expect(pill).toHaveAttribute('title', 'The turn did not stop gracefully — reset it');
    await user.click(pill);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('streaming without onStop keeps the Send button', () => {
    renderComposer({ isStreaming: true });
    expect(sendButton()).toBeInTheDocument();
  });
});

describe('ChatInput — blocking bars (09 §5.1)', () => {
  it.each(['pending', 'preparing'] as const)(
    'workspace prep %s blocks Send but not typing',
    async (status) => {
      const user = userEvent.setup();
      renderComposer({ workspacePrep: { status } });
      expect(screen.getByTestId('workspace-prep-bar')).toHaveAttribute('role', 'status');
      await user.type(textbox(), 'still typing');
      expect(textbox()).toHaveValue('still typing');
      expect(sendButton()).toBeDisabled();
    },
  );

  it('workspace prep error shows workspace-prep-error with Retry and Edit sources, and does not block Send', async () => {
    const user = userEvent.setup();
    const onRetryWorkspacePrep = vi.fn();
    const onEditSources = vi.fn();
    renderComposer({
      workspacePrep: { status: 'error', error: 'clone failed' },
      onRetryWorkspacePrep,
      onEditSources,
    });
    const bar = screen.getByTestId('workspace-prep-error');
    expect(bar).toHaveTextContent('clone failed');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await user.click(screen.getByRole('button', { name: 'Edit sources' }));
    expect(onRetryWorkspacePrep).toHaveBeenCalledTimes(1);
    expect(onEditSources).toHaveBeenCalledTimes(1);
    await user.type(textbox(), 'go');
    expect(sendButton()).toBeEnabled();
  });

  it('workspace prep ready renders no bar', () => {
    renderComposer({ workspacePrep: { status: 'ready' } });
    expect(screen.queryByTestId('workspace-prep-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-prep-error')).not.toBeInTheDocument();
  });

  it('pendingInteractionLabel shows the status banner; "Cancel and send" calls onCancelPendingInteraction', async () => {
    const user = userEvent.setup();
    const onCancelPendingInteraction = vi.fn();
    renderComposer({ pendingInteractionLabel: 'Waiting on your plan review', onCancelPendingInteraction });
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Waiting on your plan review');
    await user.click(screen.getByRole('button', { name: 'Cancel and send' }));
    expect(onCancelPendingInteraction).toHaveBeenCalledTimes(1);
    // Typing stays possible; only Send is held back.
    await user.type(textbox(), 'x');
    expect(sendButton()).toBeDisabled();
  });
});
