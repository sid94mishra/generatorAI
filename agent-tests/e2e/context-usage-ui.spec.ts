// ────────────────────────────────────────────────────────────────
// Context-usage E2E (UI) — the composer, the picker and the gauge
// must agree, and none of them may render half-loaded.
//
// The regression this guards: the composer advertised a model's
// prompt+completion total (264K) while the gauge divided by the
// provider's real prompt budget (200K), so the same model reported
// two different context sizes on the same screen.
// ────────────────────────────────────────────────────────────────

import { test, expect } from '../helpers/test';
import { API_BASE } from '../helpers/api';
import type { Page } from '@playwright/test';

interface CatalogModel {
  id: string;
  provider?: string;
  promptTokenLimit?: number;
  longContext?: { promptTokenLimit?: number };
}

async function catalog(): Promise<CatalogModel[]> {
  const res = await fetch(`${API_BASE}/harness/models`);
  return (await res.json()) as CatalogModel[];
}

/** Read the gauge's own data attributes — the numbers it actually rendered. */
async function readGauge(page: Page) {
  const trigger = page.locator('[data-testid="context-usage-trigger"]').first();
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  return {
    pct: await trigger.getAttribute('data-context-pct'),
    used: await trigger.getAttribute('data-context-used'),
    limit: await trigger.getAttribute('data-context-limit'),
    source: await trigger.getAttribute('data-context-source'),
  };
}

test.describe('composer catalog gating', () => {
  test('shows a skeleton until models resolve, never a half-loaded picker', async ({ page, gotoApp, seed }) => {
    const id = await seed.chat({ name: `Ctx Gate ${Date.now()}` });

    // Hold the catalog response so the loading state is observable rather
    // than a sub-frame flash.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    await page.route('**/api/harness/providers**', async (route) => {
      await gate;
      await route.continue();
    });

    await gotoApp(`/chats/${id}`);

    const skeleton = page.locator('[data-testid="chat-input-skeleton"]');
    await expect(skeleton).toBeVisible({ timeout: 20_000 });
    // Nothing model-derived may render while the catalog is unknown.
    await expect(page.locator('[data-testid="context-usage-trigger"]')).toHaveCount(0);

    release();
    await expect(skeleton).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('[data-testid="context-usage-trigger"]').first()).toBeVisible();
  });

  test('opening a chat fetches the model catalog exactly once', async ({ page, gotoApp, seed }) => {
    const id = await seed.chat({ name: `Ctx Perf ${Date.now()}` });

    const calls: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/\/api\/(harness\/(models|providers)|copilot\/models)/.test(u)) calls.push(u);
    });

    await gotoApp(`/chats/${id}`);
    await expect(page.locator('[data-testid="context-usage-trigger"]').first())
      .toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);

    // The composer and the picker share one cached query. More than one
    // request means we regressed to duplicate cold provider probes, each of
    // which spawns a provider CLI.
    expect(calls, `catalog requests:\n${calls.join('\n')}`).toHaveLength(1);
  });
});

test.describe('gauge honesty', () => {
  test('renders no fill before the first response', async ({ page, gotoApp, seed }) => {
    const id = await seed.chat({ name: `Ctx Empty ${Date.now()}` });
    await gotoApp(`/chats/${id}`);

    const g = await readGauge(page);
    // "—" rather than a confident 0% measured against a guessed window.
    expect(g.source).toBe('none');
    expect(g.pct).toBe('');
  });

  test('the denominator is a limit the catalog actually publishes', async ({ page, gotoApp, seed }) => {
    const models = await catalog();
    const published = new Set<number>();
    for (const m of models) {
      if (m.promptTokenLimit) published.add(m.promptTokenLimit);
      if (m.longContext?.promptTokenLimit) published.add(m.longContext.promptTokenLimit);
    }
    test.skip(published.size === 0, 'no model publishes a prompt limit');

    const id = await seed.chat({ name: `Ctx Denom ${Date.now()}` });
    await gotoApp(`/chats/${id}`);

    const g = await readGauge(page);
    if (g.limit) {
      // Never a hardcoded fallback (the old table's 128_000 default).
      expect(published.has(Number(g.limit)), `gauge limit ${g.limit} is not in the catalog`).toBeTruthy();
    }
  });

  test('the popover opens and reports its data source', async ({ page, gotoApp, seed }) => {
    const id = await seed.chat({ name: `Ctx Popover ${Date.now()}` });
    await gotoApp(`/chats/${id}`);

    await page.locator('[data-testid="context-usage-trigger"]').first().click();
    const pop = page.locator('[data-testid="context-usage-popover"]');
    await expect(pop).toBeVisible({ timeout: 10_000 });
    await expect(pop).toContainText(/Context window/i);
  });
});
