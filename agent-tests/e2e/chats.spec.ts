import { test, expect } from '../helpers/test';
import { apiRequest } from '../helpers/api';

// Phase W2 — Chats list, search, status filter, create dialog, detail.
// Deterministic: chats seeded via API; create-dialog test cleans up after itself.
//
// P3-07 (redesign): the list is now T-01 ListPage on the kit
// (`features/chats/ChatsListPage.tsx`). Selector changes from the legacy
// page (09-verification.md §7.2):
//   - "New Chat" button → "New chat" (F-chats-01; the header action and the
//     empty-state CTA both keep the lowercase spelling the board uses).
//   - The All/Active/Archived seg is a real `role="tablist"`/`role="tab"`
//     (Base UI Tabs) with a live count appended to each tab's name
//     ("Active 3"), so tab lookups match a prefix instead of the exact word.
//   - Bulk select is no longer a separate "Select" mode: the table's
//     checkbox column is always there (DataTable selection), and the
//     floating BulkActionBar's actions are plain "Archive"/"Delete" buttons.

test.describe('Chats list', () => {
  test('renders header, search, select and status filters', async ({ page, gotoApp }) => {
    await gotoApp('/chats');
    await expect(page.getByRole('heading', { name: 'Chats', exact: true, level: 1 })).toBeVisible();
    // The page-header action comes first in DOM order. When the list is empty
    // (fresh DB) the empty state adds a second "New chat" call-to-action —
    // an intentional duplicate, so the first one is the header's.
    await expect(page.getByRole('button', { name: 'New chat', exact: true }).first()).toBeVisible();
    await expect(page.getByPlaceholder(/Search chats/i)).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Active/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Archived/ })).toBeVisible();
  });

  test('seeded chat appears and is searchable', async ({ page, gotoApp, seed }) => {
    const name = `W2 Chat ${Date.now()}`;
    await seed.chat({ name });
    await gotoApp('/chats');
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder(/Search chats/i).fill(name);
    await page.waitForTimeout(300);
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  });

  test('Active filter shows a freshly seeded (active) chat', async ({ page, gotoApp, seed }) => {
    const name = `W2 Active ${Date.now()}`;
    await seed.chat({ name });
    await gotoApp('/chats');
    await page.getByRole('tab', { name: /^Active/ }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Tags filter matches a seeded tag', async ({ page, gotoApp, seed }) => {
    const name = `W2 Tagged ${Date.now()}`;
    const tag = `w2tag${Date.now()}`;
    await seed.chat({ name, tags: [tag] });
    await gotoApp('/chats');
    // Below ~1024px of FilterBar width the four chips collapse into one
    // "Filters" chip (D-56); the "Add a tag filter" textbox is the same in
    // either popup, so the test works whichever the real viewport shows.
    const tagsChip = page.getByRole('button', { name: /^Tags/ });
    const filtersChip = page.getByRole('button', { name: /^Filters/ });
    if (await tagsChip.isVisible().catch(() => false)) await tagsChip.click();
    else await filtersChip.click();
    await page.getByRole('textbox', { name: 'Add a tag filter' }).fill(tag);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('select rows and bulk-archive them', async ({ page, gotoApp, seed }) => {
    const name = `W2 Bulk ${Date.now()}`;
    await seed.chat({ name });
    await gotoApp('/chats');
    await page.getByPlaceholder(/Search chats/i).fill(name);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('checkbox').click();
    await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toBeVisible();
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toBeHidden();
    await page.getByRole('tab', { name: /^Archived/ }).click();
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('row menu archives and unarchives a chat', async ({ page, gotoApp, seed }) => {
    const name = `W2 RowMenu ${Date.now()}`;
    await seed.chat({ name });
    await gotoApp('/chats');
    await page.getByPlaceholder(/Search chats/i).fill(name);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: /^More actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    // Archiving does not remove the row from the "All" scope (only from
    // "Active"): its Status cell becomes the neutral "Archived" chip.
    await expect(row.getByText('Archived', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('tab', { name: /^Active/ }).click();
    await expect(page.getByText(name, { exact: false })).toHaveCount(0, { timeout: 10_000 });

    await page.getByRole('tab', { name: /^Archived/ }).click();
    const archivedRow = page.getByRole('row', { name: new RegExp(name) });
    await archivedRow.getByRole('button', { name: /^More actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Unarchive' }).click();
    await expect(archivedRow).toBeHidden({ timeout: 10_000 });

    await page.getByRole('tab', { name: /^Active/ }).click();
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Create chat dialog', () => {
  test('Create button is gated on a name, then creates and navigates', async ({ page, gotoApp, tracker }) => {
    await gotoApp('/chats');
    await page.getByRole('button', { name: /New chat/i }).first().click();

    const create = page.getByRole('button', { name: /Create Chat/i });
    await expect(create).toBeDisabled();

    const name = `W2 Dialog ${Date.now()}`;
    await page.getByRole('textbox', { name: /Chat Name/i }).fill(name);
    await expect(create).toBeEnabled();
    await create.click();

    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const id = page.url().split('/chats/')[1];
    if (id) tracker.track('chat', id);
  });
});

test.describe('Chat detail', () => {
  test('loads the composer for a seeded chat', async ({ page, gotoApp, seed }) => {
    const id = await seed.chat({ name: `W2 Detail ${Date.now()}` });
    await gotoApp(`/chats/${id}`);
    // Composer input + send control render (SSE connection stays open — use load state).
    await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Send/i })).toBeVisible();
  });

  test('archived chat is hidden from the Active filter', async ({ page, gotoApp, seed }) => {
    const name = `W2 Archive ${Date.now()}`;
    const id = await seed.chat({ name });
    // Archive via API (DELETE archives the chat in this app).
    const res = await apiRequest('DELETE', `/chats/${id}`);
    expect(res.ok).toBeTruthy();

    await gotoApp('/chats');
    await page.getByRole('tab', { name: /^Active/ }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText(name, { exact: false })).toHaveCount(0, { timeout: 10_000 });
  });
});
