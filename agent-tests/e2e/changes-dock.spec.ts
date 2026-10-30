// ────────────────────────────────────────────────────────────────
// Changes dock — dummy repo + Faux file_edit script (docs/redesign/
// 09-verification.md §5.3, last paragraph):
//
//   "Keep one file → the Kept count goes up; Undo one file → the file is
//    restored on disk (check with `git status` in the dummy repo); Undo
//    all → the confirm dialog, then a clean tree."
//
// Drives the REAL server + web app's Changes panel (apps/web/src/blocks/
// changes/ChangesPanel.tsx) against a THROWAWAY git repo created
// by scripts/redesign/make-dummy-repo.mjs (never this checkout — .claude/
// CLAUDE.md "Git/SCM features: test against a throwaway dummy repo").
//
// A chat is seeded with that repo as a `gitRepositories` local-folder source
// (CreateChatSchema — "Local folder paths to use as working directory"),
// and the deterministic FauxProvider (D-48) is scripted, via
// GENERATORAI_TEST_FAUX_SCRIPT, to edit two files and add a third real file
// under the resolved workspace directory when the chat's one prompt is sent
// — see fixtures/faux-composer-changes.json's "E2E Changes Faux" entry and
// FauxProvider.ts's "file_edit" script entries.
//
// Like composer.spec.ts, the server reads GENERATORAI_TEST_FAUX_HARNESS /
// GENERATORAI_TEST_FAUX_SCRIPT once at boot and this spec cannot set them —
// it self-skips only when no Faux provider is ready.
//
// Cross-platform: the dummy repo lives under os.tmpdir() (never this
// checkout) and every filesystem/git check uses Node's path/child_process
// APIs (execFileSync with an argv array, no shell), so this runs unmodified
// on Windows, Linux and macOS (.claude/CLAUDE.md's cross-platform rule).
//
// Run: the sandbox (scripts/redesign/sandbox.mjs) loads every
// fixtures/faux-*.json by default (scripts/redesign/lib/sandbox-faux.mjs):
//   node scripts/redesign/sandbox.mjs --port=3341 --web-port=5341
//   cd agent-tests && TARGET_URL=http://localhost:5341 API_URL=http://localhost:3341/api \
//     npx playwright test e2e/changes-dock.spec.ts
// Any other server needs GENERATORAI_TEST_FAUX_HARNESS=true and
// GENERATORAI_TEST_FAUX_SCRIPT=<a script with this conversation> in ITS
// environment — setting it for the test runner does nothing.
// ────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { test, expect } from '../helpers/test';
import { apiRequest, sendChatPrompt } from '../helpers/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
// agent-tests/e2e/ → repo root → scripts/redesign/make-dummy-repo.mjs
const MAKE_DUMMY_REPO = join(__dirname, '..', '..', 'scripts', 'redesign', 'make-dummy-repo.mjs');

const CHAT_NAME = 'E2E Changes Faux';

/** Mirrors subsystems-live.spec.ts's provider-availability check (GET /harness/providers). */
async function fauxProviderReady(): Promise<boolean> {
  const res = await apiRequest<{ providers: Array<{ type: string; ready: boolean }> }>(
    'GET',
    '/harness/providers',
  );
  return res.ok && Array.isArray(res.data?.providers) && res.data.providers.some((p) => p.type === 'faux' && p.ready);
}

/**
 * Creates a throwaway dummy repo (under os.tmpdir(), via make-dummy-repo.mjs
 * — never this checkout) and resets its working tree to a clean HEAD: the
 * script's own preset leaves several working-tree edits in place (09
 * §5.3/§6.6 fixture), which would show up as pre-existing Changes-dock rows
 * and confuse the "clean tree" assertion at the end of this test.
 *
 * Returns the clone's absolute path (`work/`) — NOT necessarily the same
 * directory the server ends up materialising as the chat's workspace; see
 * `resolveWorkspaceDir` below, which reads that from the API instead of
 * assuming it.
 */
function createCleanDummyRepo(): string {
  // make-dummy-repo.mjs has no exports — it is a CLI script that prints the
  // `work/` path to stdout as its last line when run directly. Invoked via
  // `process.execPath` (not a `node` on PATH, and never a shell), matching
  // D-48's "spawns no .cmd shim on any OS" convention.
  const stdout = execFileSync(process.execPath, [MAKE_DUMMY_REPO], { encoding: 'utf8' });
  const work = stdout.trim().split('\n').pop()!.trim();

  // Undo the script's preset working-tree edits (modified/added/deleted/
  // renamed/untracked files) so the Faux script's own file_edit entries are
  // the ONLY changes the Changes dock will show.
  execFileSync('git', ['-C', work, 'reset', '--hard', 'HEAD']);
  execFileSync('git', ['-C', work, 'clean', '-fd']);

  return work;
}

function gitStatusPorcelain(dir: string): string {
  return execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
}

/** Mirrors subsystems-live.spec.ts's workspaceForChat helper. */
async function workspaceIdForChat(chatId: string): Promise<string | undefined> {
  const res = await apiRequest<Array<{ id: string; ownerId?: string }>>('GET', '/workspaces');
  if (!res.ok || !Array.isArray(res.data)) return undefined;
  return res.data.find((w) => w.ownerId === chatId)?.id;
}

/**
 * The directory the SERVER actually materialised for this workspace — may
 * be the dummy repo's `work/` path in place, or a worktree/copy of it
 * (09 §5.3's own e2e note: "check how the server materialises workspaces and
 * assert on the right directory"). `WorkspaceInfo.workingDirectory` is the
 * agent's cwd (packages/shared/src/types/Workspace.ts — "mounts[0] is the
 * agent's cwd"), i.e. exactly where FauxProvider's `file_edit` entries write.
 */
async function resolveWorkspaceDir(workspaceId: string): Promise<string> {
  const res = await apiRequest<{ workingDirectory: string; prepStatus: string }>(
    'GET',
    `/workspaces/${workspaceId}`,
  );
  if (!res.ok || !res.data?.workingDirectory) {
    throw new Error(`could not resolve workspace ${workspaceId}: ${JSON.stringify(res.data)}`);
  }
  return res.data.workingDirectory;
}

async function waitForWorkspaceReady(workspaceId: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (true) {
    const res = await apiRequest<{ prepStatus?: string; prepError?: string }>('GET', `/workspaces/${workspaceId}`);
    if (res.ok && res.data?.prepStatus === 'ready') return;
    if (res.ok && res.data?.prepStatus === 'error') {
      throw new Error(`workspace ${workspaceId} failed to prepare: ${res.data.prepError}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`workspace ${workspaceId} did not become ready within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

test.describe('Changes dock — dummy repo + Faux file_edit (09 §5.3)', () => {
  test('Keep one file, Undo one file, Undo all → clean tree', async ({ page, gotoApp, tracker }) => {
    test.skip(
      !(await fauxProviderReady()),
      'The server is not running with GENERATORAI_TEST_FAUX_HARNESS=true — no "faux" provider is ready.',
    );

    const repoDir = createCleanDummyRepo();

    try {
      // Seeded directly (not via the `seed` fixture, whose `chat()` helper
      // does not expose `gitRepositories`) — the chat's NAME is the fixed
      // key the Faux script fixture is keyed by.
      const created = await apiRequest<{ id: string }>('POST', '/chats', {
        name: CHAT_NAME,
        tags: ['e2e-seed'],
        gitRepositories: [{ url: repoDir, alias: 'dummy' }],
      });
      expect(created.ok, `seed chat failed: ${JSON.stringify(created.data)}`).toBe(true);
      const chatId = created.data.id;
      tracker.track('chat', chatId);

      const workspaceId = await workspaceIdForChat(chatId);
      test.skip(!workspaceId, 'chat did not receive a workspace');
      await waitForWorkspaceReady(workspaceId!);
      const workspaceDir = await resolveWorkspaceDir(workspaceId!);

      // Drive the Faux script's three file_edit entries (see
      // fixtures/faux-composer-changes.json's "E2E Changes Faux" turn).
      await sendChatPrompt(chatId, 'Please make the changes we discussed.');

      await gotoApp(`/chats/${chatId}`);

      // Open the right pane; the web surface defaults it to the Changes tab
      // (surfaceCapabilities.ts defaultRightPaneTab — diffRendering supported).
      await page.getByTestId('dock-toggle').click();
      const changesTab = page.getByTestId('right-pane-tab-changes');
      await expect(changesTab).toBeVisible({ timeout: 10_000 });
      await changesTab.click();

      // Wait for the three Faux-scripted edits to land and be summarised.
      await expect(
        page.getByTestId('changes-count'),
        `no scripted edits — does the server's GENERATORAI_TEST_FAUX_SCRIPT script "${CHAT_NAME}"? (the sandbox loads fixtures/faux-*.json)`,
      ).toHaveText(/3 changes?/, { timeout: 20_000 });

      // ── Keep one file → the Kept count appears/goes up ──
      await page.getByRole('button', { name: 'Keep src/app.ts' }).click();
      await expect(page.getByTestId('changes-kept-count')).toContainText('1 kept', { timeout: 10_000 });

      // ── Undo one file → confirm inline, then the file is restored on disk ──
      await page.getByRole('button', { name: 'Undo changes to src/util.ts' }).click();
      await page.getByTestId('confirm-undo-file').click();
      await expect
        .poll(() => gitStatusPorcelain(workspaceDir).includes('src/util.ts'), { timeout: 10_000 })
        .toBe(false);

      // ── Undo all → the confirm dialog, then a clean tree ──
      await page.getByTestId('undo-all').click();
      const undoAllDialog = page.getByRole('alertdialog').filter({ hasText: 'Undo all changes?' });
      await expect(undoAllDialog).toBeVisible({ timeout: 5_000 });
      await undoAllDialog.getByRole('button', { name: 'Undo all', exact: true }).click();

      await expect.poll(() => gitStatusPorcelain(workspaceDir), { timeout: 15_000 }).toBe('');
      await expect(page.getByTestId('changes-count')).toHaveText(/0 changes?/, { timeout: 10_000 });
    } finally {
      // The dummy repo lives under os.tmpdir() — clean up what we created
      // here. The server's own workspace copy/worktree (wherever it put it)
      // is left to the server's normal workspace lifecycle: deleting the
      // chat via `tracker` above does not synchronously delete it.
      rmSync(dirname(repoDir), { recursive: true, force: true });
    }
  });
});
