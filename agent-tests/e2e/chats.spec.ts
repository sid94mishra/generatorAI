import { test, expect } from '../helpers/test';
import { apiRequest } from '../helpers/api';

// Phase W2 — Chats list, search, status filter, create dialog, detail.
// Deterministic: chats seeded via API; create-dialog test cleans up after itself.

test.describe('Chats list', () => {
  test('renders header, search, select and status filters', async ({ page, gotoApp }) => {
    await gotoApp('/chats');
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Chat/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Search chats/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Active', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archived', exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'Active', exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Create chat dialog', () => {
  test('Create button is gated on a name, then creates and navigates', async ({ page, gotoApp, tracker }) => {
    await gotoApp('/chats');
    await page.getByRole('button', { name: /New Chat/i }).first().click();

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
    await page.getByRole('button', { name: 'Active', exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText(name, { exact: false })).toHaveCount(0, { timeout: 10_000 });
  });
});
