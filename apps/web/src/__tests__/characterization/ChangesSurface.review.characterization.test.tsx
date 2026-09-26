// ────────────────────────────────────────────────────────────────
// ChangesSurface characterization — inline REVIEW threads and the
// CHECKPOINTS panel.
//
// Pins (09-verification.md §5.3 "Checkpoints"; 03-component-inventory-
// domain.md §6.3 "Characterization behaviours to pin": Send-all only sends
// pending/draft threads, new threads anchor to the current base/head
// checkpoint ids, the comment gutter needs fetched content, jump-to-thread,
// only user comments are editable, review range validation, rewind reports
// per mount).
//
// These assertions must stay UNCHANGED through the P4 split of
// components/diff/ChangesSurface.tsx (P4-02..04); only the import line below
// (and the DiffCodeView mock path, if that file moves) may change.
//
// Mocked: the data layer only (`@/hooks/queries`, `@/hooks/sourceQueries`,
// `@/hooks/reviewQueries`), platform detection (`@/lib/desktop`) and — as
// 09 §5.3 allows — `DiffCodeView`, stubbed to a list of rows. The stub
// renders each source's annotations through the surface's real
// `renderAnnotation`, and exposes a "stub-select <id>" button that fires the
// viewer's `onSelectRange` (lines 1–2, additions) the way a gutter drag does.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewSubmitTarget } from '@/types/review.js';
import {
  checkpoint,
  cs,
  deferred,
  file,
  installDomShims,
  installResizeObserverStub,
  installWorkerStub,
  mount,
  repo,
  resetChangesSurfaceState,
  summaryOf,
  thread,
  useWorkspaceChangeSummaryMock,
} from './helpers/changesSurfaceHarness.js';
import { renderSurface } from './helpers/changesSurfaceRender.js';

vi.mock('@/hooks/queries.js', async (orig) =>
  (await import('./helpers/changesSurfaceHarness.js')).queriesMock(await orig()),
);
vi.mock('@/hooks/sourceQueries.js', async (orig) =>
  (await import('./helpers/changesSurfaceHarness.js')).sourceQueriesMock(await orig()),
);
vi.mock('@/hooks/reviewQueries.js', async (orig) =>
  (await import('./helpers/changesSurfaceHarness.js')).reviewQueriesMock(await orig()),
);
vi.mock('@/lib/desktop.js', async (orig) =>
  (await import('./helpers/changesSurfaceHarness.js')).desktopMock(await orig()),
);
// 09 §5.3: DiffCodeView is stubbed to a list of rows (no Shiki, no workers).
vi.mock('@/components/diff/DiffCodeView.js', async () => ({
  DiffCodeView: (await import('./helpers/changesSurfaceHarness.js')).DiffCodeViewStub,
}));

// Import under test — the only line that changes when P4 moves the file.
import { ChangesSurface } from '@/components/diff/ChangesSurface.js';

const restorers: Array<() => void> = [];
beforeEach(() => {
  resetChangesSurfaceState();
  useWorkspaceChangeSummaryMock.mockClear();
  installDomShims();
  restorers.push(installWorkerStub(), installResizeObserverStub());
});
afterEach(() => {
  while (restorers.length) restorers.pop()?.();
});

const TARGET: ReviewSubmitTarget = { kind: 'chat', chatId: 'chat-1' };
const SCOPE = { scope: 'chat' as const, scopeId: 'chat-1' };

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="diff-row"][data-id="${id}"]`);
  if (!el) throw new Error(`no diff row ${id}`);
  return el;
}
function isExpanded(id: string): boolean {
  return row(id).getAttribute('data-collapsed') === 'false';
}

function singleMount(files = [file('src/a.ts'), file('src/b.ts')]) {
  cs.mounts = [mount('app')];
  cs.summary = summaryOf([repo('app', files)]);
}

async function renderReview(props: Partial<Parameters<typeof ChangesSurface>[0]> = {}) {
  const utils = renderSurface(
    <ChangesSurface
      workspaceId="ws-1"
      enableReview
      reviewScope={SCOPE}
      reviewTarget={TARGET}
      {...props}
    />,
  );
  await screen.findByTestId('changes-count');
  return utils;
}

/** Wait for a file's lazily fetched body (the stub shows newContents). */
async function bodyLoaded(id: string) {
  await waitFor(() =>
    expect(within(row(id)).getByTestId('diff-body').textContent).not.toBe(''),
  );
}

// ── Sending ──────────────────────────────────────────────────────

describe('Review batch', () => {
  const MIXED = [
    thread('t-pending', { status: 'pending' }),
    thread('t-draft', { status: 'draft' }),
    thread('t-sub', { status: 'submitted' }),
    thread('t-addr', { status: 'addressed' }),
    thread('t-res', { status: 'resolved' }),
  ];

  it('counts pending (pending + draft), awaiting and addressed threads (ChangesSurface.tsx:520-530)', async () => {
    singleMount();
    cs.threads = MIXED;
    await renderReview();
    expect(screen.getByText('2 pending comments')).toBeInTheDocument();
    expect(screen.getByText('1 awaiting agent')).toBeInTheDocument();
    expect(screen.getByText('1 addressed')).toBeInTheDocument();
  });

  it('Send all sends ONLY pending/draft threads to the target (ChangesSurface.tsx:641-657)', async () => {
    singleMount();
    cs.threads = MIXED;
    const user = userEvent.setup();
    await renderReview();

    await user.click(screen.getByRole('button', { name: 'Send all' }));

    expect(cs.submitReview.mutateAsync).toHaveBeenCalledWith({
      threadIds: ['t-pending', 't-draft'],
      target: TARGET,
    });
  });

  it('Send all carries the trimmed note; Preview asks for a preview and shows the prompt', async () => {
    singleMount();
    cs.threads = MIXED;
    const user = userEvent.setup();
    await renderReview();

    await user.click(screen.getByRole('button', { name: 'Note' }));
    await user.type(screen.getByRole('textbox', { name: 'Extra instruction for the agent' }), '  be brief  ');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(cs.submitReview.mutateAsync).toHaveBeenLastCalledWith({
      threadIds: ['t-pending', 't-draft'],
      target: TARGET,
      note: 'be brief',
      preview: true,
    });
    expect(await screen.findByText('This will be sent to the agent:')).toBeInTheDocument();
    expect(screen.getByText('PROMPT')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('This will be sent to the agent:')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Send all' }));
    expect(cs.submitReview.mutateAsync).toHaveBeenLastCalledWith({
      threadIds: ['t-pending', 't-draft'],
      target: TARGET,
      note: 'be brief',
    });
  });

  it('the comments popover’s send-all also sends only pending/draft threads (ChangesSurface.tsx:1405-1413)', async () => {
    singleMount();
    cs.threads = MIXED;
    const user = userEvent.setup();
    await renderReview();

    await user.click(screen.getByRole('button', { name: /^Comments \(/ }));
    await user.click(await screen.findByRole('button', { name: 'Send 2 to chat' }));

    expect(cs.submitReview.mutateAsync).toHaveBeenCalledWith({
      threadIds: ['t-pending', 't-draft'],
      target: TARGET,
    });
  });

  it('without a review target Send all is disabled and explains why', async () => {
    singleMount();
    cs.threads = MIXED;
    await renderReview({ reviewTarget: undefined, reviewDisabledReason: 'No chat to send to' });
    expect(screen.getByRole('button', { name: 'Send all' })).toBeDisabled();
    expect(screen.getByText('No chat to send to')).toBeInTheDocument();
  });

  it('review UI is off unless enableReview AND a reviewScope are given (ChangesSurface.tsx:462)', async () => {
    singleMount();
    cs.threads = MIXED;
    renderSurface(<ChangesSurface workspaceId="ws-1" enableReview />);
    await screen.findByTestId('changes-count');
    expect(screen.queryByRole('button', { name: 'Send all' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^stub-select/ })).toBeNull();
  });
});

// ── New threads ──────────────────────────────────────────────────

describe('New threads', () => {
  it('anchor to the summary’s current base/head checkpoint ids, with the selected lines as anchor text (ChangesSurface.tsx:609-639)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReview();
    await bodyLoaded('app::src/a.ts');

    await user.click(screen.getByRole('button', { name: 'stub-select app::src/a.ts' }));
    await user.type(await screen.findByRole('textbox', { name: 'Review comment' }), 'Rename this');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));

    expect(cs.createThread.mutateAsync).toHaveBeenCalledWith({
      scope: 'chat',
      scopeId: 'chat-1',
      alias: 'app',
      path: 'src/a.ts',
      side: 'additions',
      startLine: 1,
      endLine: 2,
      anchorText: 'new src/a.ts\n',
      body: 'Rename this',
      intent: 'fix',
      baseCheckpointId: 'cp-base-app',
      headCheckpointId: 'cp-head-app',
    });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Review comment' })).toBeNull());
    expect(cs.submitReview.mutateAsync).not.toHaveBeenCalled();
  });

  it('with several mounts a thread anchors to ITS OWN mount’s base/head, not the response-level (first mount’s) pair', async () => {
    cs.mounts = [mount('api'), mount('web')];
    cs.summary = summaryOf([repo('api', [file('src/a.ts')]), repo('web', [file('src/b.ts')])]);
    const user = userEvent.setup();
    await renderReview();
    await bodyLoaded('web::src/b.ts');

    await user.click(screen.getByRole('button', { name: 'stub-select web::src/b.ts' }));
    await user.type(await screen.findByRole('textbox', { name: 'Review comment' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));

    // Discrepancy resolved as a defect in P4-04 (03 §6.3 "new threads anchor
    // to the current base/head checkpoint ids"): the ids used to come from the
    // response-level `summary.base/head`, the FIRST mount's resolution. A
    // checkpoint id belongs to one mount, and the server resolves an id from
    // another mount as that mount's baseline (ChangeSummaryService
    // `resolveRevision`), so re-anchoring measured from the wrong revision.
    expect(cs.createThread.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        alias: 'web',
        path: 'src/b.ts',
        baseCheckpointId: 'cp-base-web',
        headCheckpointId: 'cp-head-web',
      }),
    );
  });

  it('"Add & send" creates the thread and sends just that one (ChangesSurface.tsx:631-636)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReview();
    await bodyLoaded('app::src/a.ts');

    await user.click(screen.getByRole('button', { name: 'stub-select app::src/a.ts' }));
    await user.type(await screen.findByRole('textbox', { name: 'Review comment' }), 'Fix it');
    await user.click(screen.getByRole('button', { name: /Add & send/ }));

    await waitFor(() =>
      expect(cs.submitReview.mutateAsync).toHaveBeenCalledWith({
        threadIds: ['thread-new'],
        target: TARGET,
      }),
    );
  });

  it('the header "Comment on" control waits for the file body; its composer validates the line range (ChangesSurface.tsx:1160-1181; ReviewComposerPopover 67-70)', async () => {
    singleMount();
    const gate = deferred<void>();
    cs.fileGate = gate.promise;
    const user = userEvent.setup();
    await renderReview();

    // Auto-expanded (≤3 files) but the body has not arrived: no content to comment on.
    const commentOn = within(row('app::src/a.ts')).getByRole('button', { name: 'Comment on src/a.ts' });
    expect(commentOn).toBeDisabled();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() =>
      expect(within(row('app::src/a.ts')).getByRole('button', { name: 'Comment on src/a.ts' })).toBeEnabled(),
    );

    await user.click(within(row('app::src/a.ts')).getByRole('button', { name: 'Comment on src/a.ts' }));
    await user.type(await screen.findByRole('textbox', { name: 'Review comment' }), 'note');
    expect(screen.getByRole('button', { name: 'Add comment' })).toBeEnabled();

    // The file has one line: ending the range on line 2 is invalid.
    const end = screen.getByRole('spinbutton', { name: 'End line' });
    await user.clear(end);
    await user.type(end, '2');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an ordered range from 1 to 1.');
    expect(screen.getByRole('button', { name: 'Add comment' })).toBeDisabled();
  });
});

// ── Threads in the diff ──────────────────────────────────────────

describe('Threads in the diff', () => {
  it('only the user’s own comments are editable (ReviewThreadCard 275)', async () => {
    singleMount();
    cs.threads = [
      thread('t1', {
        comments: [
          { id: 'c1', threadId: 't1', author: 'user', body: 'Please rename', createdAt: '', updatedAt: '' },
          { id: 'c2', threadId: 't1', author: 'agent', body: 'Renamed', createdAt: '', updatedAt: '' },
        ],
      }),
    ];
    const user = userEvent.setup();
    await renderReview();

    const card = screen.getByTestId('diff-annotation');
    await user.click(within(card).getAllByRole('button')[0]!);
    expect(within(card).getByText('Please rename')).toBeInTheDocument();
    expect(within(card).getByText('Renamed')).toBeInTheDocument();
    expect(within(card).getAllByRole('button', { name: 'Edit comment' })).toHaveLength(1);
  });

  it('jumping to a thread from the comments list expands its file and scrolls to it (ChangesSurface.tsx:706-717)', async () => {
    singleMount(['a', 'b', 'c', 'd'].map((n) => file(`src/${n}.ts`)));
    cs.threads = [thread('t1', { path: 'src/c.ts' })];
    const user = userEvent.setup();
    await renderReview();
    expect(isExpanded('app::src/c.ts')).toBe(false);

    await user.click(screen.getByRole('button', { name: /^Comments \(/ }));
    // The comments list always names the file `<alias>/<path>` — even with a
    // single mount, unlike the rows (ReviewCommentsPopover 88-91).
    await user.click(await screen.findByRole('button', { name: /^app\/src\/c\.ts/ }));

    await waitFor(() => expect(cs.scrolledTo).toEqual(['app::src/c.ts']));
    expect(isExpanded('app::src/c.ts')).toBe(true);
  });

  // Known defect #9, fixed in P4-04: 03 §6.3 says jump-to-thread "opens Kept if
  // needed", as the focusFile / tree paths always did; all three now share
  // `reveal` (blocks/changes/useChangesNavigation.ts).
  it('jumping to a thread on a KEPT file opens the Kept group', async () => {
    singleMount([file('src/a.ts', { kept: true }), file('src/b.ts')]);
    cs.threads = [thread('t1', { path: 'src/a.ts' })];
    const user = userEvent.setup();
    await renderReview();

    await user.click(screen.getByRole('button', { name: /^Comments \(/ }));
    await user.click(await screen.findByRole('button', { name: /^app\/src\/a\.ts/ }));

    await waitFor(() =>
      expect(screen.getByTestId('kept-group-toggle')).toHaveAttribute('aria-expanded', 'true'),
    );
  });
});

// ── Checkpoints panel ────────────────────────────────────────────

describe('Checkpoints panel', () => {
  /**
   * The wrapper around the timeline. Overlay vs beside is expressed only by
   * its layout classes (ChangesSurface.tsx:1786-1792); `absolute` is the one
   * that makes it an overlay.
   */
  function checkpointsWrapper(): HTMLElement {
    const close = screen.getByRole('button', { name: 'Close checkpoints' });
    // close → header row → timeline root → wrapper
    return close.parentElement!.parentElement!.parentElement!;
  }

  async function openPanel(width: number) {
    singleMount();
    cs.observedWidth = width;
    const user = userEvent.setup();
    renderSurface(<ChangesSurface workspaceId="ws-1" />);
    await screen.findByTestId('changes-count');
    await user.click(screen.getByRole('button', { name: 'Checkpoints & rewind' }));
    return user;
  }

  it('is an overlay when the SURFACE is narrower than 760px (ChangesSurface.tsx:254-263, 1781-1802)', async () => {
    await openPanel(640);
    expect(screen.getByRole('button', { name: 'Checkpoints & rewind' })).toHaveAttribute('aria-pressed', 'true');
    expect(checkpointsWrapper()).toHaveClass('absolute');
  });

  it('sits beside the diff when the surface is 760px or wider; Close hides it', async () => {
    const user = await openPanel(760);
    expect(checkpointsWrapper()).not.toHaveClass('absolute');

    await user.click(screen.getByRole('button', { name: 'Close checkpoints' }));
    expect(screen.queryByRole('button', { name: 'Close checkpoints' })).toBeNull();
  });

  it('a host-provided onOpenCheckpoints replaces the built-in panel (ChangesSurface.tsx:1500)', async () => {
    singleMount();
    const onOpenCheckpoints = vi.fn();
    const user = userEvent.setup();
    renderSurface(<ChangesSurface workspaceId="ws-1" onOpenCheckpoints={onOpenCheckpoints} />);
    await screen.findByTestId('changes-count');

    await user.click(screen.getByRole('button', { name: 'Checkpoints & rewind' }));
    expect(onOpenCheckpoints).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Close checkpoints' })).toBeNull();
  });

  it('"Compare" on a checkpoint sets the compare base (ChangesSurface.tsx:1799)', async () => {
    cs.checkpoints = [checkpoint('t1-app', { turnId: 't1', label: 'Turn one' })];
    const user = await openPanel(900);

    await user.click(screen.getByRole('button', { name: 'Compare' }));
    expect(useWorkspaceChangeSummaryMock).toHaveBeenLastCalledWith('ws-1', {
      base: 'turn:t1',
      head: 'working',
    });
  });

  it('Rewind confirms, then restores every mount the turn touched, one request each (CheckpointTimeline 94-122)', async () => {
    cs.checkpoints = [
      checkpoint('before-api', { turnId: 't1', repoAlias: 'api', phase: 'before', label: 'Turn one' }),
      checkpoint('before-web', { turnId: 't1', repoAlias: 'web', phase: 'before', label: 'Turn one' }),
    ];
    cs.restore.mutateAsync.mockResolvedValue({
      workspaceId: 'ws-1',
      checkpointId: 'x',
      preRestoreCheckpointId: 'pre-1',
      restoredPaths: ['src/a.ts'],
      deletedPaths: [],
      skipped: [],
    });
    const user = await openPanel(900);

    await user.click(screen.getByRole('button', { name: 'Rewind' }));
    expect(cs.restore.mutateAsync).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Rewind 2 sources' }));

    await waitFor(() => expect(cs.restore.mutateAsync).toHaveBeenCalledTimes(2));
    expect(cs.restore.mutateAsync).toHaveBeenNthCalledWith(1, { checkpointId: 'before-api' });
    expect(cs.restore.mutateAsync).toHaveBeenNthCalledWith(2, { checkpointId: 'before-web' });
  });
});
