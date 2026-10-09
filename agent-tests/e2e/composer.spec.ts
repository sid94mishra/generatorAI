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
// itself. It self-skips only when no Faux provider is ready; a Faux server
// whose script lacks "E2E Composer Faux" fails with a message saying so.
//
// The fixture (fixtures/faux-composer-changes.json) scripts the chat named
// "E2E Composer Faux": one turn that emits text, then an `ask_question`
// entry that opens the pending-interaction gate ChatInput.tsx surfaces as
// the `role="status"` banner with `pendingInteractionLabel` (ChatPage.tsx:
// "The agent is waiting for your answer." for a generic question gate).
//
// Run: the sandbox (scripts/redesign/sandbox.mjs) loads every
// fixtures/faux-*.json by default (scripts/redesign/lib/sandbox-faux.mjs):
//   node scripts/redesign/sandbox.mjs --port=3341 --web-port=5341
//   cd agent-tests && TARGET_URL=http://localhost:5341 API_URL=http://localhost:3341/api \
//     npx playwright test e2e/composer.spec.ts
// Any other server needs GENERATORAI_TEST_FAUX_HARNESS=true and
// GENERATORAI_TEST_FAUX_SCRIPT=<a script with this conversation> in ITS
// environment (plus the isolated DB_PATH / ARTIFACTS_DIR / WORKSPACES_DIR /
// GENERATORAI_BIND_HOST of .claude/CLAUDE.md) — setting it for the test
// runner does nothing.
// ────────────────────────────────────────────────────────────────

import { test, expect } from '../helpers/test';
import { apiRequest } from '../helpers/api';

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
    await expect(
      waitingBanner,
      `no scripted ask_question — does the server's GENERATORAI_TEST_FAUX_SCRIPT script "${CHAT_NAME}"? (the sandbox loads fixtures/faux-*.json)`,
    ).toBeVisible({ timeout: 15_000 });
  });
});
