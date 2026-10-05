import { test, expect } from '../helpers/test';
import { apiRequest, sendChatPrompt, waitForPendingInteraction } from '../helpers/api';

// The Activity column (D-92; boards EnhActivityColumn, EnhRailQuickAccess):
//   • the sidebar header's activity toggle opens it, docked beside the sidebar
//     at 1440 px; Needs you / Running / Failed / Recent from the attention
//     feed (SSE) and today's finished items;
//   • a card's hover popover answers a gate inline (Allow once) and the card
//     moves to Recent without a reload;
//   • keyboard: the registry chord (Mod+.) opens it with focus on a card,
//     arrows move, Esc closes it and focus returns to the toggle;
//   • at 1100 px the live items are status-tinted rail tiles with the same
//     popover, and the column opens as an overlay.
//
// Needs the Faux harness with the sandbox script (node scripts/redesign/sandbox.mjs
// — any --port/--web-port): the chat named "Sandbox — Needs Your Review" opens a
// permission gate on its first turn. Skipped otherwise.

const GATE_CHAT = 'Sandbox — Needs Your Review';

async function fauxReady(): Promise<boolean> {
  const res = await apiRequest<{ providers: Array<{ type: string; ready: boolean }> }>('GET', '/harness/providers');
  return res.ok && Array.isArray(res.data?.providers) && res.data.providers.some((p) => p.type === 'faux' && p.ready);
}

/** A chat waiting on its permission gate (Faux script), tracked for cleanup. */
async function seedGateChat(tracker: { track: (kind: string, id: string) => void }): Promise<string> {
  const res = await apiRequest<{ id: string }>('POST', '/chats', { name: GATE_CHAT, tags: ['e2e-seed'], permissionMode: 'default' });
  if (!res.ok || !res.data?.id) throw new Error(`seed chat failed (${res.status})`);
  tracker.track('chat', res.data.id);
  await sendChatPrompt(res.data.id, 'Please apply the config change.');
  const pending = await waitForPendingInteraction(res.data.id, 15_000);
  if (pending.length === 0) throw new Error('the Faux gate did not open');
  return res.data.id;
}

test.describe('Activity column (D-92)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('generatorai:activity');
      } catch {
        /* storage blocked */
      }
    });
  });

  test('opens from the sidebar, answers a gate from the popover, keyboard and Esc', async ({ page, gotoApp, tracker }) => {
    test.skip(!(await fauxReady()), 'Needs the Faux harness (scripts/redesign/sandbox.mjs).');
    await page.setViewportSize({ width: 1440, height: 900 });
    const chatId = await seedGateChat(tracker);
    await gotoApp('/chats');

    const toggle = page.getByTestId('activity-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    const column = page.getByRole('complementary', { name: 'Activity' });
    await expect(column).toHaveAttribute('data-variant', 'docked');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The sidebar's own Needs you list moves into the column while it is open.
    await expect(page.getByTestId('sidebar-needs-you')).toHaveCount(0);

    // The sandbox seeds a pending chat of the same name and Needs you lists oldest first: address this test's card.
    const needsYou = column.getByRole('list', { name: 'Needs you' });
    const ownCard = (list: typeof needsYou) => list.getByRole('link', { name: `Chat: ${GATE_CHAT}` }).and(page.locator(`[href="/chats/${chatId}"]`));
    const card = ownCard(needsYou);
    await expect(card).toBeVisible();

    // Hover → the popover, then answer the gate inline.
    await card.hover();
    const popover = page.getByTestId('activity-popover');
    await expect(popover).toBeVisible();
    await expect(popover.getByTestId('activity-popover-ask')).toContainText('src/config.ts');
    await popover.getByRole('button', { name: `Allow once — ${GATE_CHAT}` }).click();
    await expect(ownCard(needsYou)).toHaveCount(0);
    await expect(ownCard(column.getByRole('list', { name: 'Recent' }))).toBeVisible({
      timeout: 15_000,
    });

    // Esc closes the column and returns focus to its toggle.
    await column.getByRole('link').first().focus();
    await page.keyboard.press('Escape');
    await expect(column).toHaveCount(0);
    await expect(toggle).toBeFocused();

    // The registry chord opens it again, focus on a card; arrows move between cards.
    await page.keyboard.press('ControlOrMeta+Period');
    await expect(page.getByRole('complementary', { name: 'Activity' })).toBeVisible();
    await expect(page.locator('[data-testid="activity-card"] a:focus')).toHaveCount(1);
    await page.keyboard.press('End');
    await expect(page.locator('[data-testid="activity-card"] a:focus')).toHaveCount(1);
  });

  test('kind tabs filter the cards and keep their counts', async ({ page, gotoApp, tracker }) => {
    test.skip(!(await fauxReady()), 'Needs the Faux harness (scripts/redesign/sandbox.mjs).');
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedGateChat(tracker);
    await gotoApp('/');
    await page.getByTestId('activity-toggle').click();
    const tabs = page.getByRole('tablist', { name: 'Activity kind' });
    await tabs.getByRole('tab', { name: /Workflows/ }).click();
    await expect(page.getByRole('list', { name: 'Needs you' }).getByRole('link', { name: `Chat: ${GATE_CHAT}` })).toHaveCount(0);
    await tabs.getByRole('tab', { name: /Chats/ }).click();
    await expect(page.getByRole('list', { name: 'Needs you' }).getByRole('link', { name: `Chat: ${GATE_CHAT}` }).first()).toBeVisible();
  });

  test('narrow window: live items are rail tiles with the popover; the column is an overlay', async ({ page, gotoApp, tracker }) => {
    test.skip(!(await fauxReady()), 'Needs the Faux harness (scripts/redesign/sandbox.mjs).');
    await page.setViewportSize({ width: 1100, height: 760 });
    await seedGateChat(tracker);
    await gotoApp('/chats');

    const tile = page.getByRole('button', { name: `${GATE_CHAT} · needs you` }).first();
    await expect(tile).toBeVisible();
    await tile.click();
    const popover = page.getByTestId('activity-popover');
    await expect(popover).toBeVisible();
    await expect(popover.getByRole('button', { name: 'Open', exact: false }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);

    await page.getByTestId('activity-toggle').click();
    const column = page.getByRole('complementary', { name: 'Activity' });
    await expect(column).toHaveAttribute('data-variant', 'overlay');
    // A press outside it (on the page to its right) closes the overlay.
    await page.mouse.click(1000, 420);
    await expect(column).toHaveCount(0);
  });
});
