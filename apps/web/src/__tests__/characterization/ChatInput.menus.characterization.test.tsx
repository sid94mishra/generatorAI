// ────────────────────────────────────────────────────────────────
// ChatInput characterization — the `/` SLASH menu and the `@` MENTION menu.
//
// Pins (09-verification.md §5.1 "Slash menu", "@ mention"; 03-component-
// inventory-domain.md §6.1 items 4–7, 22): when each menu opens, the fuzzy
// filter and its 50 cap, ↑/↓ wrap-around, Enter/Tab select, Escape keeps the
// text, the command pill and Backspace-removes-pill, the 120 ms close after
// blur, and mention selection (text removal, `text/plain` chip, "Attaching…",
// de-duplication, failure toast).
//
// These assertions must stay unchanged through the P4 split of ChatInput;
// only the marked import line changes when the component moves.
// ────────────────────────────────────────────────────────────────

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chips,
  createComposerHarness,
  deferred,
  menuRows,
  mentionFile,
  setupComposerTest,
  slashCommand,
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
afterEach(() => {
  vi.useRealTimers();
});
const renderComposer = createComposerHarness(ChatInput);

const slashHeader = () => screen.queryByText('Commands & skills');
const mentionHeader = () => screen.queryByText('Attach a file');
const COMMANDS = [
  slashCommand('review', { description: 'Check the diff' }),
  slashCommand('deploy', { description: 'Ship it to production' }),
  slashCommand('explain', { description: 'Explain some code' }),
];

describe('ChatInput — slash menu opening (09 §5.1; 03 §6.1 #6)', () => {
  it('opens when the value starts with "/" and lists the commands', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/');
    expect(slashHeader()).toBeInTheDocument();
    expect(menuRows('/')).toHaveLength(3);
    expect(menuRows('/review')[0]).toHaveAccessibleName(/Check the diff/);
  });

  it('does not open when "/" is not at the start of the value', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), 'run /rev');
    expect(slashHeader()).not.toBeInTheDocument();
  });

  it('closes once the caret leaves the first token, and reopens on a click back inside it', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/rev some args');
    expect(slashHeader()).not.toBeInTheDocument();
    textbox().setSelectionRange(3, 3);
    fireEvent.click(textbox());
    expect(slashHeader()).toBeInTheDocument();
    // The query is the text between "/" and the caret.
    expect(menuRows('/')).toHaveLength(1);
    expect(menuRows('/review')).toHaveLength(1);
  });

  it('does not open while a command is already active', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/review');
    await user.keyboard('{Enter}');
    await user.type(textbox(), '/');
    expect(slashHeader()).not.toBeInTheDocument();
    expect(textbox()).toHaveValue('/');
  });
});

describe('ChatInput — slash menu filtering (09 §5.1)', () => {
  it('fuzzy-matches the name', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/rvw');
    expect(menuRows('/').map((b) => b.textContent)).toEqual([expect.stringContaining('/review')]);
  });

  it('fuzzy-matches the description', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/production');
    expect(menuRows('/').map((b) => b.textContent)).toEqual([expect.stringContaining('/deploy')]);
  });

  it('shows "No matching commands" when nothing matches', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/zzz');
    expect(screen.getByText('No matching commands')).toBeInTheDocument();
  });

  it('with no matching row, Enter is not consumed by the menu and sends the raw "/text" (1271)', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn }, { slashCommands: COMMANDS });
    await user.type(textbox(), '/zzz');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(customSendFn).toHaveBeenCalledWith({ prompt: '/zzz', attachments: [], mode: 'auto' }));
  });

  it('caps the list at 50', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 60 }, (_, i) => slashCommand(`cmd${String(i).padStart(2, '0')}`));
    renderComposer({}, { slashCommands: many });
    await user.type(textbox(), '/cmd');
    expect(menuRows('/cmd')).toHaveLength(50);
  });
});

describe('ChatInput — slash menu keyboard (09 §5.1; 03 §6.1 #4, #5)', () => {
  it('↑ from the first row wraps to the last; Enter selects it', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(screen.getByRole('button', { name: 'Remove /explain command' })).toBeInTheDocument();
  });

  it('↓ past the last row wraps to the first', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByRole('button', { name: 'Remove /review command' })).toBeInTheDocument();
  });

  it('Tab selects the active row', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/');
    await user.keyboard('{ArrowDown}{Tab}');
    expect(screen.getByRole('button', { name: 'Remove /deploy command' })).toBeInTheDocument();
  });

  it('clicking a row selects it', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/');
    await user.click(menuRows('/explain')[0]!);
    expect(screen.getByRole('button', { name: 'Remove /explain command' })).toBeInTheDocument();
  });

  it('Escape closes the menu only; the text is kept', async () => {
    const user = userEvent.setup();
    const customSendFn = vi.fn(async () => undefined);
    renderComposer({ customSendFn }, { slashCommands: COMMANDS });
    await user.type(textbox(), '/rev');
    await user.keyboard('{Escape}');
    expect(slashHeader()).not.toBeInTheDocument();
    expect(textbox()).toHaveValue('/rev');
    expect(screen.queryByRole('button', { name: /^Remove \// })).not.toBeInTheDocument();
    expect(customSendFn).not.toHaveBeenCalled();
  });

  it('selecting turns the command into a pill, clears the text and shows the argHint placeholder', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/rev');
    await user.keyboard('{Enter}');
    expect(textbox()).toHaveValue('');
    expect(slashHeader()).not.toBeInTheDocument();
    expect(screen.getByText('/review')).toBeInTheDocument();
    expect(textbox()).toHaveAttribute('placeholder', 'Arguments for review…');
  });

  it('Backspace on empty text removes the pill; with text it edits the text', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/rev');
    await user.keyboard('{Enter}');
    await user.type(textbox(), 'ab');
    await user.keyboard('{Backspace}');
    expect(textbox()).toHaveValue('a');
    expect(screen.getByRole('button', { name: 'Remove /review command' })).toBeInTheDocument();
    await user.keyboard('{Backspace}{Backspace}');
    expect(screen.queryByRole('button', { name: 'Remove /review command' })).not.toBeInTheDocument();
    expect(textbox()).toHaveAttribute('placeholder', 'Ask anything');
  });

  it('the pill\'s "Remove /x command" button removes it', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/rev');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Remove /review command' }));
    expect(screen.queryByText('/review')).not.toBeInTheDocument();
  });
});

describe('ChatInput — menu closes 120 ms after blur (09 §5.1)', () => {
  it('stays open for 119 ms after blur and closes at 120 ms', async () => {
    const user = userEvent.setup();
    renderComposer({}, { slashCommands: COMMANDS });
    await user.type(textbox(), '/');
    expect(slashHeader()).toBeInTheDocument();
    vi.useFakeTimers();
    fireEvent.blur(textbox());
    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(slashHeader()).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(slashHeader()).not.toBeInTheDocument();
  });
});

describe('ChatInput — @ mention (09 §5.1; 03 §6.1 #6, #7)', () => {
  const FILES = [mentionFile('src/app.ts'), mentionFile('src/api/client.ts'), mentionFile('README.md')];

  it('needs a workspaceId', async () => {
    const user = userEvent.setup();
    renderComposer({}, { fileIndex: FILES });
    await user.type(textbox(), '@app');
    expect(mentionHeader()).not.toBeInTheDocument();
  });

  it('opens for "@" at the start or after whitespace, filtering label and path', async () => {
    const user = userEvent.setup();
    renderComposer({ workspaceId: 'ws1' }, { fileIndex: FILES });
    await user.type(textbox(), '@');
    expect(mentionHeader()).toBeInTheDocument();
    expect(menuRows(/^(app\.ts|client\.ts|README\.md)/)).toHaveLength(3);
    await user.clear(textbox());
    await user.type(textbox(), 'look at @api');
    expect(mentionHeader()).toBeInTheDocument();
    // "api" matches client.ts only through its path (src/api/client.ts).
    expect(menuRows(/^(app\.ts|client\.ts|README\.md)/)).toHaveLength(1);
    expect(menuRows(/^client\.ts/)).toHaveLength(1);
  });

  it('does not open for an "@" inside a word', async () => {
    const user = userEvent.setup();
    renderComposer({ workspaceId: 'ws1' }, { fileIndex: FILES });
    await user.type(textbox(), 'mail@app');
    expect(mentionHeader()).not.toBeInTheDocument();
  });

  it('closes once whitespace separates the "@" from the caret', async () => {
    const user = userEvent.setup();
    renderComposer({ workspaceId: 'ws1' }, { fileIndex: FILES });
    await user.type(textbox(), '@app');
    expect(mentionHeader()).toBeInTheDocument();
    await user.type(textbox(), ' ');
    expect(mentionHeader()).not.toBeInTheDocument();
  });

  it('shows the loading row while the file index loads', async () => {
    const user = userEvent.setup();
    renderComposer({ workspaceId: 'ws1' }, { fileIndex: [], fileIndexLoading: true });
    await user.type(textbox(), '@');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('selection removes the @query, shows "Attaching…" while loading, then adds a text/plain chip', async () => {
    const user = userEvent.setup();
    const load = deferred<{ content: string }>();
    const customSendFn = vi.fn(async () => undefined);
    const r = renderComposer(
      { workspaceId: 'ws1', customSendFn },
      { fileIndex: FILES, getWorkspaceFileContent: () => load.promise },
    );
    await user.type(textbox(), 'see @app now');
    textbox().setSelectionRange(8, 8); // caret right after "@app"
    fireEvent.click(textbox());
    expect(mentionHeader()).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(textbox()).toHaveValue('see  now');
    expect(mentionHeader()).not.toBeInTheDocument();
    expect(screen.getByText('Attaching…')).toBeInTheDocument();
    expect(r.getWorkspaceFileContent).toHaveBeenCalledWith('ws1', 'src/app.ts', 'workspace', undefined);
    await act(async () => load.resolve({ content: 'export const app = 1;' }));
    expect(screen.queryByText('Attaching…')).not.toBeInTheDocument();
    expect(chips()).toHaveLength(1);
    // The chip is labelled by the PATH (stem + extension spans).
    expect(chips()[0]).toHaveTextContent('src/app.ts');
    expect(screen.getByRole('button', { name: 'Remove src/app.ts' })).toBeInTheDocument();
    // Caret goes back to where the "@" was.
    await waitFor(() => expect(textbox().selectionStart).toBe(4));

    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(customSendFn).toHaveBeenCalled());
    const sent = (customSendFn.mock.calls[0] as unknown as [{ attachments: File[] }])[0].attachments;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.name).toBe('app.ts');
    expect(sent[0]!.type).toBe('text/plain');
    expect(await sent[0]!.text()).toBe('export const app = 1;');
  });

  it('passes the worktree alias through for a worktree file', async () => {
    const user = userEvent.setup();
    const r = renderComposer(
      { workspaceId: 'ws1' },
      { fileIndex: [mentionFile('lib/x.ts', { source: 'worktree', worktreeAlias: 'feat' })] },
    );
    await user.type(textbox(), '@x');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(r.getWorkspaceFileContent).toHaveBeenCalledWith('ws1', 'lib/x.ts', 'worktree', 'feat');
  });

  // The de-duplication key is the file PATH (a mention chip's label is its path),
  // components/chat/ChatInput.tsx:691.
  it('does not add the same file twice', async () => {
    const user = userEvent.setup();
    renderComposer({ workspaceId: 'ws1' }, { fileIndex: FILES });
    await user.type(textbox(), '@readme');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(chips()).toHaveLength(1));
    await user.type(textbox(), '@readme');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('Attaching…')).not.toBeInTheDocument());
    expect(chips()).toHaveLength(1);
  });

  it('a fetch failure toasts "Could not attach {label}" and adds no chip', async () => {
    const user = userEvent.setup();
    renderComposer(
      { workspaceId: 'ws1' },
      { fileIndex: FILES, getWorkspaceFileContent: async () => Promise.reject(new Error('403')) },
    );
    await user.type(textbox(), '@readme');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(toastSpies.error).toHaveBeenCalledWith('Could not attach README.md', expect.anything()));
    expect(chips()).toHaveLength(0);
    expect(screen.queryByText('Attaching…')).not.toBeInTheDocument();
  });

  it('↑/↓ and Escape drive the mention menu like the slash menu', async () => {
    const user = userEvent.setup();
    renderComposer({ workspaceId: 'ws1' }, { fileIndex: FILES });
    await user.type(textbox(), '@');
    await user.keyboard('{Escape}');
    expect(mentionHeader()).not.toBeInTheDocument();
    expect(textbox()).toHaveValue('@');
    fireEvent.click(textbox());
    await user.keyboard('{ArrowUp}{Enter}');
    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(chips()[0]).toHaveTextContent('README.md');
  });
});
