// ────────────────────────────────────────────────────────────────
// ChangesSurface characterization — VIEW: states, compare base, tree/list,
// view settings, expansion, focus, multi-mount, workspace files, editor.
// (The checkpoints panel is in ChangesSurface.review.characterization.test.tsx.)
//
// Pins (09-verification.md §5.3 "Compare against", "Tree/list", "Expand",
// "Focus", "Multi-mount and workspace files", "States";
// 03-component-inventory-domain.md §6.3 "Characterization behaviours to pin").
//
// These assertions must stay UNCHANGED through the P4 split of
// components/diff/ChangesSurface.tsx (P4-02..04); only the import line below
// (and the DiffCodeView mock path, if that file moves) may change.
//
// Mocked: the data layer only (`@/hooks/queries`, `@/hooks/sourceQueries`,
// `@/hooks/reviewQueries`), platform detection (`@/lib/desktop`) and — as
// 09 §5.3 allows — `DiffCodeView`, stubbed to a list of rows that renders
// the surface's real per-file header. The file tree (ChangesTree over
// @pierre/trees) is REAL; its rows live in the tree's shadow root.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  checkpoint,
  cs,
  file,
  installDomShims,
  installWorkerStub,
  mount,
  repo,
  resetChangesSurfaceState,
  summaryOf,
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
vi.mock('@/blocks/diff/DiffCodeView.js', async () => ({
  DiffCodeView: (await import('./helpers/changesSurfaceHarness.js')).DiffCodeViewStub,
}));

// Import under test — the only line that changes when P4 moves the file.
import { ChangesPanel as ChangesSurface } from '@/blocks/changes/ChangesPanel.js';

const restorers: Array<() => void> = [];
beforeEach(() => {
  resetChangesSurfaceState();
  useWorkspaceChangeSummaryMock.mockClear();
  installDomShims();
  restorers.push(installWorkerStub());
});
afterEach(() => {
  while (restorers.length) restorers.pop()?.();
});

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="diff-row"][data-id="${id}"]`);
  if (!el) throw new Error(`no diff row ${id}`);
  return el;
}
function isExpanded(id: string): boolean {
  return row(id).getAttribute('data-collapsed') === 'false';
}
/** The real file tree renders its rows into a shadow root. */
function treeRoot(): ShadowRoot | null {
  return document.querySelector('file-tree-container')?.shadowRoot ?? null;
}
function treeItem(path: string): HTMLElement | null {
  return treeRoot()?.querySelector<HTMLElement>(`[role="treeitem"][data-item-path="${path}"]`) ?? null;
}

const FOUR = ['a', 'b', 'c', 'd'].map((n) => file(`src/${n}.ts`));

function singleMount(files = FOUR) {
  cs.mounts = [mount('app')];
  cs.summary = summaryOf([repo('app', files)]);
}

async function renderReady(props: Partial<Parameters<typeof ChangesSurface>[0]> = {}) {
  const utils = renderSurface(<ChangesSurface workspaceId="ws-1" {...props} />);
  await screen.findByTestId('changes-count');
  return utils;
}

// ── States ───────────────────────────────────────────────────────

describe('States', () => {
  it('no workspace → "No workspace yet — …" and no toolbar (ChangesSurface.tsx:1281-1287)', () => {
    renderSurface(<ChangesSurface />);
    expect(
      screen.getByText('No workspace yet — changes appear once the agent starts working.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('changes-count')).toBeNull();
  });

  it('summary loading → "Loading changes…" (ChangesSurface.tsx:1665-1668)', () => {
    cs.summaryLoading = true;
    renderSurface(<ChangesSurface workspaceId="ws-1" />);
    expect(screen.getByText('Loading changes…')).toBeInTheDocument();
    expect(screen.getByTestId('changes-count')).toHaveTextContent('0 changes');
  });

  it('empty summary → "No changes detected in this workspace." and no bulk actions (ChangesSurface.tsx:1669-1672)', async () => {
    cs.summary = summaryOf([]);
    await renderReady();
    expect(screen.getByText('No changes detected in this workspace.')).toBeInTheDocument();
    expect(screen.getByTestId('changes-count')).toHaveTextContent('0 changes');
    expect(screen.queryByTestId('keep-all')).toBeNull();
    expect(screen.queryByTestId('undo-all')).toBeNull();
  });

  it('changes-count is singular for one file and plural otherwise (ChangesSurface.tsx:1308-1310)', async () => {
    singleMount([file('src/a.ts')]);
    const { rerenderSurface } = await renderReady();
    expect(screen.getByTestId('changes-count')).toHaveTextContent(/^1 change$/);

    singleMount();
    rerenderSurface(<ChangesSurface workspaceId="ws-1" />);
    expect(screen.getByTestId('changes-count')).toHaveTextContent(/^4 changes$/);
  });

  it('Refresh refetches the summary (ChangesSurface.tsx:1505-1513)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(cs.summaryRefetch).toHaveBeenCalledTimes(1);
  });
});

// ── Compare against ──────────────────────────────────────────────

describe('Compare against', () => {
  async function openCompare() {
    const trigger = screen.getByRole('combobox', { name: 'Compare against' });
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    });
    return screen.getByRole('listbox');
  }

  it('first fetches {base:"baseline", head:"working"} ("This run"), or the defaultBase; defaultBase seeds once', async () => {
    singleMount();
    const { rerenderSurface } = await renderReady();
    expect(useWorkspaceChangeSummaryMock).toHaveBeenLastCalledWith('ws-1', {
      base: 'baseline',
      head: 'working',
    });
    expect(screen.getByRole('combobox', { name: 'Compare against' })).toHaveTextContent('This run');
    rerenderSurface(<ChangesSurface workspaceId="ws-2" defaultBase="stage:s1" />);
    // defaultBase seeds state once; a later prop change does not reset it.
    expect(useWorkspaceChangeSummaryMock).toHaveBeenLastCalledWith('ws-2', {
      base: 'baseline',
      head: 'working',
    });
  });

  it('a chat on a git mount opens on "Uncommitted changes" (base head) (D-162)', async () => {
    cs.mounts = [mount('app', { git: { isRepo: true, branch: 'feat/x' } })];
    cs.summary = summaryOf([repo('app', FOUR)]);
    await renderReady({ chatId: 'chat-1', defaultBase: 'head' });
    expect(useWorkspaceChangeSummaryMock).toHaveBeenLastCalledWith('ws-1', { base: 'head', head: 'working' });
    expect(screen.getByRole('combobox', { name: 'Compare against' })).toHaveTextContent('Uncommitted changes');
  });

  it('offers Uncommitted changes, This chat and Last turn — one entry for the newest turn, not one per checkpoint (D-162)', async () => {
    cs.mounts = [
      mount('api', { git: { isRepo: true, baseCommit: 'c0ffee', baseRef: 'main', branch: 'feat/x' } }),
      mount('docs'),
    ];
    cs.summary = summaryOf([repo('api', [file('src/a.ts')])]);
    cs.checkpoints = [
      checkpoint('base', { kind: 'baseline' }),
      checkpoint('t1-api', { turnId: 't1', label: 'Fix login', repoAlias: 'api', createdAt: '2026-09-01T10:00:00.000Z' }),
      checkpoint('t2-api', { turnId: 't2', label: 'Fix logout', repoAlias: 'api', createdAt: '2026-09-01T10:05:00.000Z' }),
      checkpoint('pre', { kind: 'pre_restore' }),
      checkpoint('m1', { kind: 'manual', label: 'Snapshot' }),
    ];
    await renderReady({ chatId: 'chat-1' });

    await openCompare();
    const labels = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(/^Uncommitted changes/);
    expect(labels[1]).toMatch(/^This chat/);
    expect(labels[2]).toMatch(/^Last turn/);
  });

  it('choosing an option refetches with {base:<selector>, head:"working"}', async () => {
    cs.mounts = [mount('app', { git: { isRepo: true, branch: 'feat/x' } })];
    cs.summary = summaryOf([repo('app', FOUR)]);
    cs.checkpoints = [checkpoint('t1-app', { turnId: 't1', label: 'Turn one' })];
    await renderReady({ chatId: 'chat-1', defaultBase: 'head' });
    // A full pointer sequence: Base UI Select commits on the pointer, not on a bare synthetic click.
    const user = userEvent.setup();

    for (const [name, base] of [
      [/^Last turn/, 'turn:t1'],
      [/^This chat/, 'baseline'],
      [/^Uncommitted changes/, 'head'],
    ] as const) {
      await openCompare();
      await user.click(screen.getByRole('option', { name }));
      expect(useWorkspaceChangeSummaryMock).toHaveBeenLastCalledWith('ws-1', {
        base,
        head: 'working',
      });
    }
  });
});

// ── Tree / list and view settings ────────────────────────────────

describe('File tree and view settings', () => {
  it('the tree is hidden by default; "Show file tree" docks it and flips to "Hide file tree" (ChangesSurface.tsx:241, 1419-1425)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();

    const show = screen.getByRole('button', { name: 'Show file tree' });
    expect(show).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('file-tree-container')).toBeNull();

    await user.click(show);
    const hide = screen.getByRole('button', { name: 'Hide file tree' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(treeItem('src/a.ts')).not.toBeNull());
    // The tree lists only the changed files.
    expect(treeRoot()?.querySelectorAll('[role="treeitem"][data-item-type="file"]')).toHaveLength(4);

    await user.click(hide);
    expect(document.querySelector('file-tree-container')).toBeNull();
  });

  it('"View settings" holds Unified/Split and Wrap lines; they drive the viewer (ChangesSurface.tsx:1440-1475)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();
    const viewer = screen.getByTestId('diff-viewer-main');
    expect(viewer).toHaveAttribute('data-view-mode', 'unified');
    expect(viewer).toHaveAttribute('data-wrap-lines', 'false');

    await user.click(screen.getByRole('button', { name: 'View settings' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Unified view' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Split view' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Wrap lines' })).toHaveAttribute('aria-checked', 'false');

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Split view' }));
    expect(screen.getByTestId('diff-viewer-main')).toHaveAttribute('data-view-mode', 'split');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Split view' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Unified view' })).toHaveAttribute('aria-checked', 'false');

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Wrap lines' }));
    expect(screen.getByTestId('diff-viewer-main')).toHaveAttribute('data-wrap-lines', 'true');
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Wrap lines' }));
    expect(screen.getByTestId('diff-viewer-main')).toHaveAttribute('data-wrap-lines', 'false');
  });

  it('picking a tree position in the settings popover also opens the tree (ChangesSurface.tsx:1476-1494)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', { name: 'View settings' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Left' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Right' }));

    expect(screen.getByRole('menuitemcheckbox', { name: 'Right' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Left' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Hide file tree' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('file-tree-container')).not.toBeNull();
  });
});

// ── Expansion ────────────────────────────────────────────────────

describe('Expand / collapse', () => {
  it('a change set of 3 files or fewer is auto-expanded (ChangesSurface.tsx:752-758)', async () => {
    singleMount(FOUR.slice(0, 3));
    await renderReady();
    await waitFor(() => expect(isExpanded('app::src/a.ts')).toBe(true));
    expect(isExpanded('app::src/b.ts')).toBe(true);
    expect(isExpanded('app::src/c.ts')).toBe(true);
    expect(screen.getByRole('button', { name: 'Collapse all files' })).toBeInTheDocument();
  });

  it('4 or more files start collapsed; Expand all / Collapse all toggle every openable file (ChangesSurface.tsx:1426-1436)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();
    expect(FOUR.map((f) => isExpanded(`app::${f.path}`))).toEqual([false, false, false, false]);

    await user.click(screen.getByRole('button', { name: 'Expand all files' }));
    expect(FOUR.map((f) => isExpanded(`app::${f.path}`))).toEqual([true, true, true, true]);

    await user.click(screen.getByRole('button', { name: 'Collapse all files' }));
    expect(FOUR.map((f) => isExpanded(`app::${f.path}`))).toEqual([false, false, false, false]);
  });

  it('clicking a row (or its chevron) toggles that file only (ChangesSurface.tsx:1020-1066)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(row('app::src/b.ts')).getByRole('button', { name: 'Expand src/b.ts' }));
    expect(isExpanded('app::src/b.ts')).toBe(true);
    expect(isExpanded('app::src/a.ts')).toBe(false);
    await user.click(within(row('app::src/b.ts')).getByTitle('src/b.ts'));
    expect(isExpanded('app::src/b.ts')).toBe(false);
  });

  it('binary and too-large files cannot be opened and are excluded from Expand all (ChangesSurface.tsx:744-750, 990)', async () => {
    singleMount([
      ...FOUR.slice(0, 3),
      file('img/logo.png', { isBinary: true }),
      file('data/huge.json', { isTooLarge: true }),
    ]);
    const user = userEvent.setup();
    await renderReady();

    const bin = row('app::img/logo.png');
    expect(within(bin).getByText('binary')).toBeInTheDocument();
    expect(within(bin).getByRole('button', { name: 'Expand img/logo.png' })).toBeDisabled();
    const big = row('app::data/huge.json');
    expect(within(big).getByText('too large')).toBeInTheDocument();
    expect(within(big).getByRole('button', { name: 'Expand data/huge.json' })).toBeDisabled();

    await user.click(within(bin).getByTitle('img/logo.png'));
    expect(isExpanded('app::img/logo.png')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Expand all files' }));
    expect(isExpanded('app::src/a.ts')).toBe(true);
    expect(isExpanded('app::img/logo.png')).toBe(false);
    expect(isExpanded('app::data/huge.json')).toBe(false);
    // Every OPENABLE file is open, so the control reads "Collapse all".
    expect(screen.getByRole('button', { name: 'Collapse all files' })).toBeInTheDocument();
  });

  it('Expand all is disabled when nothing can be opened', async () => {
    singleMount([file('a.png', { isBinary: true }), file('b.bin', { isTooLarge: true })]);
    await renderReady();
    expect(screen.getByRole('button', { name: 'Expand all files' })).toBeDisabled();
  });
});

// ── Focus ────────────────────────────────────────────────────────

describe('Focus', () => {
  it('focusFile expands the file and scrolls to it; the same token does not re-fire, a new one does (ChangesSurface.tsx:794-806)', async () => {
    singleMount();
    const user = userEvent.setup();
    const { rerenderSurface } = await renderReady({ focusFile: { path: 'src/c.ts', token: 1 } });

    await waitFor(() => expect(isExpanded('app::src/c.ts')).toBe(true));
    expect(cs.scrolledTo).toEqual(['app::src/c.ts']);

    // The user collapses it; re-rendering with the SAME token changes nothing.
    await user.click(within(row('app::src/c.ts')).getByRole('button', { name: 'Collapse src/c.ts' }));
    rerenderSurface(<ChangesSurface workspaceId="ws-1" focusFile={{ path: 'src/c.ts', token: 1 }} />);
    expect(isExpanded('app::src/c.ts')).toBe(false);
    expect(cs.scrolledTo).toEqual(['app::src/c.ts']);

    // A fresh token re-fires for the same path.
    rerenderSurface(<ChangesSurface workspaceId="ws-1" focusFile={{ path: 'src/c.ts', token: 2 }} />);
    await waitFor(() => expect(isExpanded('app::src/c.ts')).toBe(true));
    expect(cs.scrolledTo).toEqual(['app::src/c.ts', 'app::src/c.ts']);
  });

  it('focusFile waits for the summary to list the file (ChangesSurface.tsx:791-798)', async () => {
    singleMount();
    const { rerenderSurface } = await renderReady({ focusFile: { path: 'src/new.ts', token: 1 } });
    expect(cs.scrolledTo).toEqual([]);

    singleMount([...FOUR, file('src/new.ts')]);
    rerenderSurface(<ChangesSurface workspaceId="ws-1" focusFile={{ path: 'src/new.ts', token: 1 }} />);
    await waitFor(() => expect(cs.scrolledTo).toEqual(['app::src/new.ts']));
    expect(isExpanded('app::src/new.ts')).toBe(true);
  });

  it('focusFile marks the row active — the tree selects the same path (ChangesSurface.tsx:800, 1689)', async () => {
    singleMount();
    const user = userEvent.setup();
    const { rerenderSurface } = await renderReady();
    await user.click(screen.getByRole('button', { name: 'Show file tree' }));
    await waitFor(() => expect(treeItem('src/d.ts')).not.toBeNull());

    rerenderSurface(<ChangesSurface workspaceId="ws-1" focusFile={{ path: 'src/d.ts', token: 7 }} />);
    await waitFor(() => expect(treeItem('src/d.ts')).toHaveAttribute('aria-selected', 'true'));
    expect(cs.scrolledTo).toEqual(['app::src/d.ts']);
  });

  it('a multi-mount focusFile path is the alias-prefixed display path', async () => {
    cs.mounts = [mount('api'), mount('web')];
    cs.summary = summaryOf([
      repo('api', [file('src/a.ts'), file('src/b.ts')]),
      repo('web', [file('src/a.ts'), file('src/c.ts')]),
    ]);
    await renderReady({ focusFile: { path: 'web/src/a.ts', token: 1 } });
    await waitFor(() => expect(cs.scrolledTo).toEqual(['web::src/a.ts']));
    expect(isExpanded('web::src/a.ts')).toBe(true);
    expect(isExpanded('api::src/a.ts')).toBe(false);
  });

  it('clicking a file in the tree expands it and scrolls to it (ChangesSurface.tsx:808-822)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();
    await user.click(screen.getByRole('button', { name: 'Show file tree' }));
    await waitFor(() => expect(treeItem('src/b.ts')).not.toBeNull());

    await user.click(treeItem('src/b.ts')!);

    await waitFor(() => expect(cs.scrolledTo).toEqual(['app::src/b.ts']));
    expect(isExpanded('app::src/b.ts')).toBe(true);
    expect(treeItem('src/b.ts')).toHaveAttribute('aria-selected', 'true');
  });

  function twoMounts() {
    cs.mounts = [mount('api'), mount('web')];
    cs.summary = summaryOf([
      repo('api', [file('src/a.ts')]),
      repo('web', [file('src/x.ts'), file('src/y.ts')]),
    ]);
  }

  it('clicking a mount group scrolls to that mount’s first file and CLEARS the active row (ChangesSurface.tsx:1530-1535)', async () => {
    twoMounts();
    const user = userEvent.setup();
    const { rerenderSurface } = await renderReady();
    await user.click(screen.getByRole('button', { name: 'Show file tree' }));
    await waitFor(() => expect(treeItem('api/src/a.ts')).not.toBeNull());
    rerenderSurface(<ChangesSurface workspaceId="ws-1" focusFile={{ path: 'api/src/a.ts', token: 1 }} />);
    await waitFor(() => expect(treeItem('api/src/a.ts')).toHaveAttribute('aria-selected', 'true'));

    await user.click(within(screen.getByTestId('mount-groups')).getByRole('button', { name: /^web/ }));

    expect(cs.scrolledTo).toEqual(['api::src/a.ts', 'web::src/x.ts']);
    // DISCREPANCY (09 §5.3): "a mount-group click sets the active row" — the
    // code sets the active path to null instead (ChangesSurface.tsx:1534), so
    // nothing is highlighted afterwards.
    await waitFor(() => expect(treeItem('api/src/a.ts')).toHaveAttribute('aria-selected', 'false'));
    expect(treeItem('web/src/x.ts')).toHaveAttribute('aria-selected', 'false');
  });

  // Known defect #8, fixed in P4-04: the mount-group click parked the scroll
  // and relied on `setActivePath(null)` to re-render and flush it; with no
  // active row React bailed out and the scroll was lost. A scroll request now
  // always commits a render (blocks/changes/useChangesNavigation.ts).
  it('with no active row, clicking a mount group still scrolls to its first file', async () => {
    twoMounts();
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(screen.getByTestId('mount-groups')).getByRole('button', { name: /^web/ }));
    expect(cs.scrolledTo).toEqual(['web::src/x.ts']);
  });
});

// ── Multi-mount, workspace files, editor ─────────────────────────

describe('Multi-mount and workspace files', () => {
  it('no mount-groups bar and no alias prefix with a single mount (ChangesSurface.tsx:340-345, 1522)', async () => {
    singleMount();
    await renderReady();
    expect(screen.queryByTestId('mount-groups')).toBeNull();
    expect(within(row('app::src/a.ts')).getByTitle('src/a.ts')).toHaveTextContent(/^src\/a\.ts$/);
  });

  it('with more than one mount the bar names each group, its branch and its stats (ChangesSurface.tsx:1517-1558)', async () => {
    cs.mounts = [mount('api', { git: { branch: 'feat/api' } }), mount('web')];
    cs.summary = summaryOf([
      repo('api', [file('src/a.ts')]),
      repo('web', [file('src/x.ts'), file('src/y.ts')]),
    ]);
    await renderReady();

    const buttons = within(screen.getByTestId('mount-groups')).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('api');
    expect(buttons[0]).toHaveTextContent('feat/api');
    expect(buttons[0]).toHaveTextContent('1 file');
    expect(buttons[0]).toHaveTextContent('+3 −1');
    expect(buttons[1]).toHaveTextContent('2 files');
    expect(buttons[1]).toHaveAttribute('title', '/work/web');
  });

  it('while mounts are still loading, the summary’s repo count decides multi-mount (ChangesSurface.tsx:340)', async () => {
    cs.mounts = [];
    cs.summary = summaryOf([repo('api', [file('src/a.ts')]), repo('web', [file('src/b.ts')])]);
    await renderReady();
    expect(screen.getByTestId('mount-groups')).toBeInTheDocument();
    expect(within(row('web::src/b.ts')).getByTitle('web/src/b.ts')).toBeInTheDocument();
  });

  it('workspace-root files are hidden behind a toggle when a codebase is present (ChangesSurface.tsx:323-329, 1333-1355)', async () => {
    cs.mounts = [mount('app')];
    cs.summary = summaryOf([
      repo('.', [file('NOTES.md'), file('state.json')], { kind: 'root' }),
      repo('app', [file('src/a.ts')]),
    ]);
    const user = userEvent.setup();
    await renderReady();

    const toggle = screen.getByTestId('changes-workspace-files-toggle');
    expect(toggle).toHaveTextContent('+2 workspace files');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('changes-count')).toHaveTextContent('1 change');
    expect(document.querySelector('[data-id=".::NOTES.md"]')).toBeNull();

    await user.click(toggle);
    expect(screen.getByTestId('changes-workspace-files-toggle')).toHaveTextContent('Hide workspace files');
    expect(screen.getByTestId('changes-workspace-files-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('changes-count')).toHaveTextContent('3 changes');
    expect(row('.::NOTES.md')).toBeInTheDocument();

    await user.click(screen.getByTestId('changes-workspace-files-toggle'));
    expect(screen.getByTestId('changes-workspace-files-toggle')).toHaveTextContent('+2 workspace files');
  });

  it('no workspace-files toggle when nothing is hidden (ChangesSurface.tsx:1333)', async () => {
    // Root-only workspace (no codebase): the root files ARE the work.
    cs.mounts = [];
    cs.summary = summaryOf([repo('.', [file('script.py')], { kind: 'root' })]);
    const { rerenderSurface } = await renderReady();
    expect(screen.queryByTestId('changes-workspace-files-toggle')).toBeNull();
    expect(row('.::script.py')).toBeInTheDocument();

    singleMount();
    rerenderSurface(<ChangesSurface workspaceId="ws-1" />);
    expect(screen.queryByTestId('changes-workspace-files-toggle')).toBeNull();
  });
});

describe('Open in editor', () => {
  it('hidden when no editor is available and not on desktop (ChangesSurface.tsx:306-309)', async () => {
    singleMount();
    cs.editors = [{ id: 'code', available: false }];
    await renderReady();
    expect(screen.queryByTestId('open-file-in-editor')).toBeNull();
  });

  it('shown when an editor is available; opens <mount path>/<file> (ChangesSurface.tsx:314-321)', async () => {
    singleMount();
    cs.editors = [{ id: 'code', available: true }];
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(row('app::src/b.ts')).getByTestId('open-file-in-editor'));
    expect(cs.openInEditor.mutate).toHaveBeenCalledWith({ path: '/work/app/src/b.ts' });
    // Clicking the control does not toggle the row.
    expect(isExpanded('app::src/b.ts')).toBe(false);
  });

  it('shown on desktop even without a detected editor', async () => {
    singleMount();
    cs.isDesktop = true;
    await renderReady();
    expect(within(row('app::src/a.ts')).getByTestId('open-file-in-editor')).toBeInTheDocument();
  });
});
