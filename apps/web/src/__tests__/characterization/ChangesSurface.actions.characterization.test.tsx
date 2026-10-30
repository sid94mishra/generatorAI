// ────────────────────────────────────────────────────────────────
// ChangesSurface characterization — per-file and bulk review ACTIONS.
//
// Pins (09-verification.md §5.3 "Keep", "Undo", "Kept"; 03-component-
// inventory-domain.md §6.3 "Characterization behaviours to pin"):
//   Keep / Unkeep / Keep all request bodies, per-row (not global) busy state,
//   Undo one (inline confirm, repo-relative path, only with a base tree-ish),
//   Undo all (destructive confirm dialog), skipped-path warning toast, the
//   dismissible error banner, the "Kept (N)" group and server-side kept state.
//
// These assertions must stay UNCHANGED through the P4 split of
// components/diff/ChangesSurface.tsx (P4-02..04); only the import line below
// (and the DiffCodeView mock path, if that file moves) may change.
//
// Mocked: the data layer only (`@/hooks/queries`, `@/hooks/sourceQueries`,
// `@/hooks/reviewQueries`), platform detection (`@/lib/desktop`) and — as
// 09 §5.3 allows — `DiffCodeView`, stubbed to a list of rows that renders
// the surface's real per-file header. Harness: ./helpers/changesSurfaceHarness.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  cs,
  deferred,
  discardOk,
  file,
  installDomShims,
  installWorkerStub,
  mount,
  repo,
  resetChangesSurfaceState,
  summaryOf,
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

let restoreWorker: () => void = () => {};
beforeEach(() => {
  resetChangesSurfaceState();
  installDomShims();
  restoreWorker = installWorkerStub();
});
afterEach(() => {
  restoreWorker();
});

/** The stub's row for one diff source id (`<alias>::<path>`). */
function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="diff-row"][data-id="${id}"]`);
  if (!el) throw new Error(`no diff row ${id}`);
  return el;
}
function queryRow(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="diff-row"][data-id="${id}"]`);
}

function singleMount(files = [file('src/a.ts'), file('src/b.ts')]) {
  cs.mounts = [mount('app')];
  cs.summary = summaryOf([repo('app', files)]);
}

async function renderReady() {
  const utils = renderSurface(<ChangesSurface workspaceId="ws-1" />);
  await screen.findByTestId('changes-count');
  return utils;
}

// ── Keep ─────────────────────────────────────────────────────────

describe('Keep', () => {
  it('Keep sends {keep:[{alias, path, blob}]} with the file’s current newBlob (ChangesSurface.tsx:891-907)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(row('app::src/a.ts')).getByTestId('keep-file'));

    expect(cs.review.mutateAsync).toHaveBeenCalledTimes(1);
    expect(cs.review.mutateAsync).toHaveBeenCalledWith({
      keep: [{ alias: 'app', path: 'src/a.ts', blob: 'new-src/a.ts' }],
    });
  });

  it('Keep on a deleted file sends blob "" (no head blob) (ChangesSurface.tsx:897-898)', async () => {
    singleMount([file('src/gone.ts', { status: 'deleted', newBlob: undefined })]);
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(row('app::src/gone.ts')).getByTestId('keep-file'));

    expect(cs.review.mutateAsync).toHaveBeenCalledWith({
      keep: [{ alias: 'app', path: 'src/gone.ts', blob: '' }],
    });
  });

  it('shows a spinner on the busy ROW only — other rows and Keep all stay enabled (ChangesSurface.tsx:267-274)', async () => {
    singleMount();
    const pending = deferred<unknown>();
    cs.review.mutateAsync.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    await renderReady();

    const keepA = within(row('app::src/a.ts')).getByTestId('keep-file');
    await user.click(keepA);

    expect(keepA).toBeDisabled();
    expect(within(keepA).getByRole('status')).toBeInTheDocument();
    const keepB = within(row('app::src/b.ts')).getByTestId('keep-file');
    expect(keepB).toBeEnabled();
    expect(within(keepB).queryByRole('status')).toBeNull();
    // Per-row, not a bulk operation: the header controls are untouched.
    expect(screen.getByTestId('keep-all')).toBeEnabled();
    expect(screen.getByTestId('undo-all')).toBeEnabled();

    await act(async () => {
      pending.resolve({});
      await pending.promise;
    });
    expect(within(row('app::src/a.ts')).getByTestId('keep-file')).toBeEnabled();
  });

  it('Unkeep on a kept row sends {unkeep:[{alias, path}]} (ChangesSurface.tsx:909-924)', async () => {
    singleMount([file('src/a.ts', { kept: true }), file('src/b.ts')]);
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByTestId('kept-group-toggle'));
    await user.click(within(row('app::src/a.ts')).getByTestId('unkeep-file'));

    expect(cs.review.mutateAsync).toHaveBeenCalledWith({
      unkeep: [{ alias: 'app', path: 'src/a.ts' }],
    });
  });

  it('a kept row offers Unkeep instead of Keep', async () => {
    singleMount([file('src/a.ts', { kept: true }), file('src/b.ts')]);
    const user = userEvent.setup();
    await renderReady();
    await user.click(screen.getByTestId('kept-group-toggle'));

    const kept = row('app::src/a.ts');
    expect(within(kept).getByTestId('unkeep-file')).toBeInTheDocument();
    expect(within(kept).queryByTestId('keep-file')).toBeNull();
    expect(within(row('app::src/b.ts')).getByTestId('keep-file')).toBeInTheDocument();
  });

  it('Keep all sends {keepAll:true} with NO confirm dialog (ChangesSurface.tsx:927-937)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByTestId('keep-all'));

    expect(cs.review.mutateAsync).toHaveBeenCalledWith({ keepAll: true });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Keep all is disabled while a bulk operation runs (and so is Undo all) (ChangesSurface.tsx:1368, 1382)', async () => {
    singleMount();
    const pending = deferred<unknown>();
    cs.review.mutateAsync.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByTestId('keep-all'));
    expect(screen.getByTestId('keep-all')).toBeDisabled();
    expect(screen.getByTestId('undo-all')).toBeDisabled();

    await act(async () => {
      pending.resolve({});
      await pending.promise;
    });
    expect(screen.getByTestId('keep-all')).toBeEnabled();
    expect(screen.getByTestId('undo-all')).toBeEnabled();
  });

  it('Keep all is disabled when every file is already kept (ChangesSurface.tsx:1368)', async () => {
    singleMount([file('src/a.ts', { kept: true }), file('src/b.ts', { kept: true })]);
    await renderReady();

    expect(screen.getByTestId('keep-all')).toBeDisabled();
    expect(screen.getByTestId('undo-all')).toBeEnabled();
  });
});

// ── Undo ─────────────────────────────────────────────────────────

describe('Undo one file', () => {
  it('opens an inline confirm first; confirming sends discard {files:[{alias, path}]} (ChangesSurface.tsx:1124-1150, 861-882)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(row('app::src/a.ts')).getByTestId('undo-file'));
    expect(cs.discard.mutateAsync).not.toHaveBeenCalled();
    const confirm = within(row('app::src/a.ts')).getByTestId('confirm-undo-file');
    expect(confirm).toHaveTextContent('Confirm undo');
    // Only the row being confirmed swaps its controls.
    expect(within(row('app::src/b.ts')).queryByTestId('confirm-undo-file')).toBeNull();

    await user.click(confirm);

    expect(cs.discard.mutateAsync).toHaveBeenCalledWith({
      files: [{ alias: 'app', path: 'src/a.ts' }],
      base: 'baseline',
    });
    // The confirm closes once the discard settles.
    await waitFor(() =>
      expect(within(row('app::src/a.ts')).queryByTestId('confirm-undo-file')).toBeNull(),
    );
  });

  it('Cancel on the inline confirm restores the row without discarding', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(row('app::src/a.ts')).getByTestId('undo-file'));
    await user.click(within(row('app::src/a.ts')).getByRole('button', { name: 'Cancel' }));

    expect(within(row('app::src/a.ts')).queryByTestId('confirm-undo-file')).toBeNull();
    expect(within(row('app::src/a.ts')).getByTestId('undo-file')).toBeInTheDocument();
    expect(cs.discard.mutateAsync).not.toHaveBeenCalled();
  });

  it('with several mounts the row SHOWS the alias prefix but the discard path is REPO-RELATIVE (ChangesSurface.tsx:866-869)', async () => {
    cs.mounts = [mount('api'), mount('web')];
    cs.summary = summaryOf([
      repo('api', [file('src/server.ts')]),
      repo('web', [file('src/app.tsx')]),
    ]);
    const user = userEvent.setup();
    await renderReady();

    const webRow = row('web::src/app.tsx');
    // Display path carries the alias when there is more than one mount…
    expect(within(webRow).getByTitle('web/src/app.tsx')).toHaveTextContent('web/src/app.tsx');

    await user.click(within(webRow).getByTestId('undo-file'));
    await user.click(within(row('web::src/app.tsx')).getByTestId('confirm-undo-file'));

    // …but the restore path never does: a mount's base tree is that mount's tree.
    expect(cs.discard.mutateAsync).toHaveBeenCalledWith({
      files: [{ alias: 'web', path: 'src/app.tsx' }],
      base: 'baseline',
    });
  });

  // Known defect #7, fixed in P4-04: Undo/Keep/Unkeep used to strip a leading
  // `<alias>/` from a path that is ALREADY repo-relative, so `api/handler.ts`
  // inside the mount `api` was sent as `handler.ts`, a different file. The
  // summary's path is now sent as-is (blocks/changes/useFileActions.ts).
  it('a repo-relative path that starts with the mount alias is sent unchanged', async () => {
    cs.mounts = [mount('api'), mount('web')];
    cs.summary = summaryOf([
      repo('api', [file('api/handler.ts')]),
      repo('web', [file('src/app.tsx')]),
    ]);
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(row('api::api/handler.ts')).getByTestId('undo-file'));
    await user.click(within(row('api::api/handler.ts')).getByTestId('confirm-undo-file'));

    expect(cs.discard.mutateAsync).toHaveBeenCalledWith({
      files: [{ alias: 'api', path: 'api/handler.ts' }],
      base: 'baseline',
    });
  });

  it('Undo is offered only for a mount whose base resolved a tree-ish (ChangesSurface.tsx:446-458, 839-842)', async () => {
    cs.mounts = [mount('api'), mount('web')];
    cs.summary = summaryOf([
      repo('api', [file('src/server.ts')]),
      // No tree-ish on this mount's base → nothing to restore from.
      repo('web', [file('src/app.tsx')], { base: { kind: 'baseline', id: 'cp-web' } }),
    ]);
    await renderReady();

    expect(within(row('api::src/server.ts')).getByTestId('undo-file')).toBeInTheDocument();
    expect(within(row('web::src/app.tsx')).queryByTestId('undo-file')).toBeNull();
    // Keep does not depend on the base.
    expect(within(row('web::src/app.tsx')).getByTestId('keep-file')).toBeInTheDocument();
  });

  it('a repo without its own base falls back to the response-level base (ChangesSurface.tsx:449-451)', async () => {
    cs.mounts = [mount('app')];
    const s = summaryOf([repo('app', [file('src/a.ts')], { base: undefined })]);
    s.base = { kind: 'checkpoint', id: 'cp-top', treeish: 'tree-top' };
    cs.summary = s;
    await renderReady();

    expect(within(row('app::src/a.ts')).getByTestId('undo-file')).toBeInTheDocument();
  });
});

describe('Undo all', () => {
  it('asks "Undo all changes?" in a destructive dialog, then sends {all:true} (ChangesSurface.tsx:945-967)', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByTestId('undo-all'));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Undo all changes?')).toBeInTheDocument();
    // Destructive confirm: Cancel, not the destructive action, takes focus.
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(cs.discard.mutateAsync).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Undo all' }));

    expect(cs.discard.mutateAsync).toHaveBeenCalledWith({ all: true, base: 'baseline' });
  });

  it('cancelling the dialog discards nothing', async () => {
    singleMount();
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByTestId('undo-all'));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(cs.discard.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('Undo results', () => {
  it('skipped paths raise a warning toast naming the reason and the display paths (ChangesSurface.tsx:845-859)', async () => {
    singleMount();
    cs.discard.mutateAsync.mockResolvedValueOnce(
      discardOk({ skipped: [{ alias: 'app', path: 'src/a.ts', reason: 'symlink' }] }),
    );
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(row('app::src/a.ts')).getByTestId('undo-file'));
    await user.click(within(row('app::src/a.ts')).getByTestId('confirm-undo-file'));

    expect(await screen.findByText('1 file was skipped')).toBeInTheDocument();
    expect(screen.getByText('symlink. src/a.ts')).toBeInTheDocument();
  });

  it('several skipped paths pluralise, de-duplicate reasons and list at most four', async () => {
    singleMount();
    const skipped = ['a', 'b', 'c', 'd', 'e'].map((n) => ({
      alias: 'app',
      path: `src/${n}.ts`,
      reason: n === 'e' ? 'outside' : 'symlink',
    }));
    cs.discard.mutateAsync.mockResolvedValueOnce(discardOk({ skipped }));
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByTestId('undo-all'));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Undo all' }));

    expect(await screen.findByText('5 files were skipped')).toBeInTheDocument();
    expect(
      screen.getByText('symlink, outside. src/a.ts, src/b.ts, src/c.ts, src/d.ts…'),
    ).toBeInTheDocument();
  });

  it('a thrown failure shows the dismissible error banner (ChangesSurface.tsx:874-876, 1643-1655)', async () => {
    singleMount();
    cs.discard.mutateAsync.mockRejectedValueOnce(new Error('restore refused'));
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(row('app::src/a.ts')).getByTestId('undo-file'));
    await user.click(within(row('app::src/a.ts')).getByTestId('confirm-undo-file'));

    const banner = await screen.findByText(/Could not complete that action: restore refused/);
    await user.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Could not complete that action/)).toBeNull();
  });

  it('a mount reported as failed (ok:false) shows its error in the banner (ChangesSurface.tsx:872-873)', async () => {
    singleMount();
    cs.discard.mutateAsync.mockResolvedValueOnce(
      discardOk({ mounts: [{ alias: 'app', ok: false, restored: 0, deleted: 0, error: 'dirty index' }] }),
    );
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByTestId('undo-all'));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Undo all' }));

    expect(await screen.findByText(/Could not complete that action: dirty index/)).toBeInTheDocument();
  });

  it('a failed Keep uses the same banner', async () => {
    singleMount();
    cs.review.mutateAsync.mockRejectedValueOnce(new Error('keep failed'));
    const user = userEvent.setup();
    await renderReady();

    await user.click(within(row('app::src/a.ts')).getByTestId('keep-file'));

    expect(await screen.findByText(/Could not complete that action: keep failed/)).toBeInTheDocument();
  });
});

// ── Kept group ───────────────────────────────────────────────────

describe('Kept (N) group', () => {
  it('moves kept files into a collapsed "Kept (N)" group and counts them in the header (ChangesSurface.tsx:1311-1315, 1736-1773)', async () => {
    singleMount([file('src/a.ts', { kept: true }), file('src/b.ts'), file('src/c.ts')]);
    const user = userEvent.setup();
    await renderReady();

    expect(screen.getByTestId('changes-count')).toHaveTextContent('3 changes');
    expect(screen.getByTestId('changes-kept-count')).toHaveTextContent('2 to review · 1 kept');
    const group = screen.getByTestId('kept-group');
    const toggle = within(group).getByTestId('kept-group-toggle');
    expect(toggle).toHaveTextContent('Kept (1)');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Collapsed: the kept file is not in the list.
    expect(queryRow('app::src/a.ts')).toBeNull();
    expect(queryRow('app::src/b.ts')).not.toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(group).getByTestId('diff-viewer-kept')).toContainElement(row('app::src/a.ts'));

    await user.click(toggle);
    expect(queryRow('app::src/a.ts')).toBeNull();
  });

  it('no Kept group and no kept count when nothing is kept', async () => {
    singleMount();
    await renderReady();
    expect(screen.queryByTestId('kept-group')).toBeNull();
    expect(screen.queryByTestId('changes-kept-count')).toBeNull();
  });

  it('when everything is kept the main list says so (ChangesSurface.tsx:1723-1725)', async () => {
    singleMount([file('src/a.ts', { kept: true })]);
    await renderReady();
    expect(
      screen.getByText('Everything has been reviewed. Kept files are listed below.'),
    ).toBeInTheDocument();
  });

  it('focusing a kept file opens the group automatically (ChangesSurface.tsx:801-803)', async () => {
    singleMount([file('src/a.ts', { kept: true }), file('src/b.ts')]);
    renderSurface(<ChangesSurface workspaceId="ws-1" focusFile={{ path: 'src/a.ts', token: 1 }} />);

    const toggle = await screen.findByTestId('kept-group-toggle');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
    expect(row('app::src/a.ts')).toBeInTheDocument();
    expect(cs.scrolledTo).toContain('app::src/a.ts');
  });

  it('kept state is server-side: a file the summary no longer reports as kept drops out of the group (ChangesSurface.tsx:884-889)', async () => {
    singleMount([file('src/a.ts', { kept: true }), file('src/b.ts')]);
    const { rerenderSurface } = await renderReady();
    expect(screen.getByTestId('kept-group-toggle')).toHaveTextContent('Kept (1)');

    // The agent edited a.ts again: the server's head blob moved, `kept` is gone.
    cs.summary = summaryOf([
      repo('app', [file('src/a.ts', { newBlob: 'new-src/a.ts-v2' }), file('src/b.ts')]),
    ]);
    rerenderSurface(<ChangesSurface workspaceId="ws-1" />);

    expect(screen.queryByTestId('kept-group')).toBeNull();
    expect(screen.queryByTestId('changes-kept-count')).toBeNull();
    expect(within(screen.getByTestId('diff-viewer-main')).getByText('src/a.ts')).toBeInTheDocument();
  });
});
