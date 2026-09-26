// ────────────────────────────────────────────────────────────────
// Composer — Faux-scripted e2e (docs/redesign/09-verification.md §5.1,
// last paragraph):
//
//   "type `/`, pick a builtin, send → the user bubble appears; ↑ recalls
//    it; attach a file via `setInputFiles`; the "waiting on you" banner
//    comes from a Faux script that asks a question (P2 script hook)."
//
// This drives the REAL server + web app (ChatInput.tsx), with the
// deterministic FauxProvider (D-48 / packages/agent-harness-providers/src/
// providers/faux/FauxProvider.ts) standing in for a real model. The server
// reads GENERATORAI_TEST_FAUX_HARNESS / GENERATORAI_TEST_FAUX_SCRIPT once at
// boot (apps/server/src/composition-root.ts) — this spec cannot set them
// itself, so it self-skips when the fixture is not wired up on the server.
//
// The fixture (fixtures/faux-composer-changes.json) scripts the chat named
// "E2E Composer Faux": one turn that emits text, then an `ask_question`
// entry that opens the pending-interaction gate ChatInput.tsx surfaces as
// the `role="status"` banner with `pendingInteractionLabel` (ChatPage.tsx:
// "The agent is waiting for your answer." for a generic question gate).
//
// Run (three terminals, from the repo root):
//   FAUX=$(pwd)/agent-tests/e2e/fixtures/faux-composer-changes.json
//
//   # 1. server — isolated DB/artifacts/workspaces dirs per
//   #    .claude/CLAUDE.md's "Isolated test servers" rule, PLUS the Faux flags:
//   GENERATORAI_TEST_FAUX_HARNESS=true GENERATORAI_TEST_FAUX_SCRIPT="$FAUX" \
//     DB_PATH=/tmp/gai-e2e/db.sqlite ARTIFACTS_DIR=/tmp/gai-e2e/artifacts \
//     WORKSPACES_DIR=/tmp/gai-e2e/workspaces GENERATORAI_BIND_HOST=127.0.0.1 \
//     pnpm --filter @generatorai/server dev
//
//   # 2. web
//   pnpm --filter @generatorai/web dev
//
//   # 3. this spec — GENERATORAI_TEST_FAUX_SCRIPT is read here too, only to
//   #    decide whether to self-skip (it never reaches the server from here):
//   cd agent-tests && GENERATORAI_TEST_FAUX_SCRIPT="$FAUX" \
//     npx playwright test e2e/composer.spec.ts
// ────────────────────────────────────────────────────────────────

import { test, expect } from '../helpers/test';
import { apiRequest } from '../helpers/api';

const FAUX_SCRIPT = process.env.GENERATORAI_TEST_FAUX_SCRIPT;
const CHAT_NAME = 'E2E Composer Faux';

/** Mirrors subsystems-live.spec.ts's provider-availability check (GET /harness/providers). */
async function fauxProviderReady(): Promise<boolean> {
  const res = await apiRequest<{ providers: Array<{ type: string; ready: boolean }> }>(
    'GET',
    '/harness/providers',
  );
  return res.ok && Array.isArray(res.data?.providers) && res.data.providers.some((p) => p.type === 'faux' && p.ready);
}

test.describe('Composer — Faux-scripted (09 §5.1)', () => {
  test('slash command send, ↑ history recall, file attachment, and the pending-question banner', async ({
    page,
    gotoApp,
    tracker,
  }) => {
    test.skip(
      !FAUX_SCRIPT,
      'Set GENERATORAI_TEST_FAUX_SCRIPT to fixtures/faux-composer-changes.json (same path the server was started with) to run this spec.',
    );
    test.skip(
      !(await fauxProviderReady()),
      'The server is not running with GENERATORAI_TEST_FAUX_HARNESS=true — no "faux" provider is ready.',
    );

    // Seeded directly (not via the `seed` fixture) so the chat's NAME is the
    // fixed key the Faux script fixture is keyed by (FauxScriptFile is keyed
    // by conversation NAME — see FauxProvider.ts's FauxScriptSource comment).
    const created = await apiRequest<{ id: string }>('POST', '/chats', {
      name: CHAT_NAME,
      tags: ['e2e-seed'],
    });
    expect(created.ok, `seed chat failed: ${JSON.stringify(created.data)}`).toBe(true);
    const chatId = created.data.id;
    tracker.track('chat', chatId);

    await gotoApp(`/chats/${chatId}`);

    const composer = page.getByRole('textbox', { name: 'Message' });
    await expect(composer).toBeVisible({ timeout: 10_000 });

    // ── `/` opens the slash menu; pick the "terminal" builtin ──
    // (apps/web/src/components/chat/composer/builtins.ts — always available,
    // no project required — and ChatPage's onBuiltinCommand just focuses the
    // Terminal tab, so it has no side effect that could make this flaky.)
    await composer.fill('/');
    const terminalItem = page.getByRole('button', { name: '/terminal' });
    await expect(terminalItem).toBeVisible({ timeout: 5_000 });
    await terminalItem.click();

    // Selecting turns the command into a pill and clears the text
    // (09 §5.1 "Slash menu"). Typing after that is the command's argument.
    const taskText = `e2e task ${Date.now()}`;
    await composer.fill(taskText);
    await page.getByRole('button', { name: 'Send message' }).click();

    // The user bubble carries the builtin's formatted prompt
    // (BUILTIN_COMMANDS['builtin:terminal'].format), which embeds our typed
    // text verbatim after "Task: ".
    await expect(page.getByText(new RegExp(`Task: ${taskText}`))).toBeVisible({ timeout: 10_000 });

    // ── ↑ in the now-empty composer recalls the raw (pre-format) text ──
    // (ChatInput.tsx handleSend pushes `rawInput`, not the formatted prompt,
    // onto localHistoryRef; navigateHistory requires a collapsed selection
    // with the caret on the first line, which an empty textarea trivially is.)
    await expect(composer).toHaveValue('');
    await composer.click();
    await composer.press('ArrowUp');
    await expect(composer).toHaveValue(taskText);
    await composer.fill('');

    // ── Attach a file (no real file on disk needed — Playwright can hand
    //    the hidden <input type="file"> an in-memory buffer directly) ──
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('e2e attachment contents'),
    });
    const attachmentChip = page.getByTestId('composer-attachment');
    await expect(attachmentChip).toBeVisible({ timeout: 5_000 });
    await expect(attachmentChip).toContainText('note');

    // ── The Faux script's `ask_question` opens the pending-interaction gate.
    //    ChatPage.tsx's pendingInteractionLabel falls through to the generic
    //    "The agent is waiting for your answer." copy for a `question` gate,
    //    rendered by ChatInput.tsx in a `role="status"` banner. ──
    const waitingBanner = page.getByRole('status').filter({ hasText: 'waiting for your answer' });
    await expect(waitingBanner).toBeVisible({ timeout: 15_000 });
  });
});
