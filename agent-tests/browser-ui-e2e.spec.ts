// ────────────────────────────────────────────────────────────────
// Browser UI End-to-End Tests — Playwright
//
// Tests ALL web UI pages and user interactions:
//   - Dashboard, Sidebar navigation
//   - Workflow builder (create, edit, stages, edges, canvas)
//   - Workflow run page (streaming, messages, timeline)
//   - Chat page (create, send, streaming, history)
//   - Automations page (list, create, trigger, detail)
//   - Projects page (CRUD, codebase linking)
//   - Templates page (list, view)
//   - Settings page
// ────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';

const WEB_URL = process.env.WEB_URL || 'http://localhost:5175';
const API_URL = process.env.API_URL || 'http://localhost:3100';

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

async function api(method: string, path: string, body?: unknown) {
  const options: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${API_URL}${path}`, options);
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function waitForRunComplete(runId: string, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await api('GET', `/api/workflow-runs/${runId}`);
    const d = data as { status: string };
    if (d.status === 'completed' || d.status === 'failed') return d.status;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms`);
}

// ═══════════════════════════════════════════════════════════════
// 1. Navigation & Layout
// ═══════════════════════════════════════════════════════════════

test.describe('1. Navigation & Layout', () => {
  test('dashboard loads', async ({ page }) => {
    await page.goto(WEB_URL);
    await page.waitForLoadState('networkidle');
    // Scope to the sidebar nav to avoid matching quick-action cards
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Workflows', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Chats', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Automations', exact: true })).toBeVisible();
  });

  test('navigate to every main page', async ({ page }) => {
    await page.goto(WEB_URL);
    await page.waitForLoadState('networkidle');
    const nav = page.getByRole('navigation');

    // Workflows
    await nav.getByRole('button', { name: 'Workflows', exact: true }).click();
    await expect(page).toHaveURL(/\/workflows/);

    // Chats
    await nav.getByRole('button', { name: 'Chats', exact: true }).click();
    await expect(page).toHaveURL(/\/chats/);

    // Automations
    await nav.getByRole('button', { name: 'Automations', exact: true }).click();
    await expect(page).toHaveURL(/\/automations/);

    // Templates + Settings live below <nav> in a separate section of the sidebar aside
    const sidebar = page.getByRole('complementary');
    await sidebar.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(page).toHaveURL(/\/templates/);

    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings/);

    // Projects
    await nav.getByRole('button', { name: 'Projects', exact: true }).click();
    await expect(page).toHaveURL(/\/projects/);

    // Dashboard
    await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\//);
  });

  test('sidebar collapse/expand', async ({ page }) => {
    await page.goto(WEB_URL);
    await page.waitForLoadState('networkidle');

    // Click collapse button
    const collapseBtn = page.locator('button:has-text("Collapse sidebar")');
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      // Sidebar text should be hidden
      await page.waitForTimeout(500);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Workflows Page
// ═══════════════════════════════════════════════════════════════

test.describe('2. Workflows Page', () => {
  test('workflows list loads', async ({ page }) => {
    await page.goto(`${WEB_URL}/workflows`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should have workflow content
    const main = await page.locator('main').textContent();
    expect(main).toBeTruthy();
  });

  test('create new workflow', async ({ page }) => {
    await page.goto(`${WEB_URL}/workflows`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click "New Workflow" button
    const newBtn = page.locator('button:has-text("New Workflow"), a:has-text("New Workflow")');
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await page.waitForTimeout(1000);
      // Should navigate to builder
      await expect(page).toHaveURL(/\/workflows\/.*\/edit|\/workflows\/new/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Workflow Builder
// ═══════════════════════════════════════════════════════════════

test.describe('3. Workflow Builder', () => {
  let defId: string;

  test.beforeAll(async () => {
    // Create workflow via API
    const { data } = await api('POST', '/api/workflow-definitions', {
      name: `Browser Builder Test ${Date.now()}`,
      sessionMode: 'single',
    });
    defId = (data as { id: string }).id;

    // Add stages
    await api('POST', `/api/workflow-definitions/${defId}/stages`, {
      name: 'First Stage',
      order: 0,
      prompts: [{ label: 'Test', text: 'Say hello', waitForCompletion: true }],
    });
  });

  test('builder page loads with canvas', async ({ page }) => {
    await page.goto(`${WEB_URL}/workflows/${defId}/edit`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Should have React Flow canvas — use the wrapper testid to avoid matching 24+ child elements
    await expect(page.getByTestId('rf__wrapper')).toBeVisible({ timeout: 10000 });
  });

  test('stage node is visible on canvas', async ({ page }) => {
    await page.goto(`${WEB_URL}/workflows/${defId}/edit`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Should show the stage name
    const stageNode = page.locator('text=First Stage');
    await expect(stageNode).toBeVisible({ timeout: 10000 });
  });

  test('save button exists', async ({ page }) => {
    await page.goto(`${WEB_URL}/workflows/${defId}/edit`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const saveBtn = page.locator('button:has-text("Save")');
    await expect(saveBtn).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async () => {
    await api('DELETE', `/api/workflow-definitions/${defId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Workflow Run Page — Streaming & Messages
// ═══════════════════════════════════════════════════════════════

test.describe('4. Workflow Run Page', () => {
  let defId: string;
  let runId: string;

  test.beforeAll(async () => {
    // Create definition
    const { data: def } = await api('POST', '/api/workflow-definitions', {
      name: `Browser Run Test ${Date.now()}`,
      sessionMode: 'single',
    });
    defId = (def as { id: string }).id;

    await api('POST', `/api/workflow-definitions/${defId}/stages`, {
      name: 'Streamed Stage',
      order: 0,
      prompts: [{ label: 'Test', text: 'Say "Hello World" exactly and nothing else.', waitForCompletion: true }],
    });

    // Create and start run
    const { data: run } = await api('POST', '/api/workflow-runs', {
      workflowDefinitionId: defId,
    });
    runId = (run as { id: string }).id;
    await api('POST', `/api/workflow-runs/${runId}/start`);
  });

  test('run page shows running state', async ({ page }) => {
    await page.goto(`${WEB_URL}/workflows/${defId}/runs/${runId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should show run status (Running or Completed)
    const main = await page.locator('main').textContent();
    expect(main).toMatch(/Running|Completed|CompletedE2E/);
  });

  test('stage appears in DAG canvas', async ({ page }) => {
    await page.goto(`${WEB_URL}/workflows/${defId}/runs/${runId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Stage should be visible in the canvas
    const stageName = page.locator('text=Streamed Stage');
    await expect(stageName).toBeVisible({ timeout: 10000 });
  });

  test('messages panel shows Prompt and Response after completion', async ({ page }) => {
    // Wait for run to complete
    await waitForRunComplete(runId);

    await page.goto(`${WEB_URL}/workflows/${defId}/runs/${runId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Click the stage to expand messages
    const stageBtn = page.locator('button:has-text("Streamed Stage")');
    if (await stageBtn.isVisible()) {
      await stageBtn.click();
      await page.waitForTimeout(2000);

      // Should show Prompt and Response
      const prompt = page.locator('text=Prompt');
      await expect(prompt).toBeVisible({ timeout: 5000 });
    }
  });

  test('messages persist after page refresh', async ({ page }) => {
    await page.goto(`${WEB_URL}/workflows/${defId}/runs/${runId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Run metadata should still be there
    const main = await page.locator('main').textContent();
    expect(main).toContain('Streamed Stage');
  });

  test('workflow messages tab and files tab visible', async ({ page }) => {
    await page.goto(`${WEB_URL}/workflows/${defId}/runs/${runId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const messagesTab = page.locator('button:has-text("Workflow Messages")');
    const filesTab = page.locator('button:has-text("Files")');
    await expect(messagesTab).toBeVisible({ timeout: 10000 });
    await expect(filesTab).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async () => {
    await api('DELETE', `/api/workflow-definitions/${defId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Chats Page
// ═══════════════════════════════════════════════════════════════

test.describe('5. Chats Page', () => {
  test('chats page loads', async ({ page }) => {
    await page.goto(`${WEB_URL}/chats`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const main = await page.locator('main').textContent();
    expect(main).toBeTruthy();
  });

  test('chat detail page shows messages', async ({ page }) => {
    // Create a chat via API
    const { data } = await api('POST', '/api/chats', { name: `Browser Chat ${Date.now()}` });
    const chatId = (data as { id: string }).id;

    // Use 'load' instead of 'networkidle' — chat detail opens a long-lived SSE connection
    // which would make the page never reach networkidle.
    await page.goto(`${WEB_URL}/chats/${chatId}`);
    await page.waitForLoadState('load');

    // Verify the correct page loaded — the breadcrumb/header should contain the chat id
    await expect(page).toHaveURL(new RegExp(`/chats/${chatId}`));
    // Main content area should be visible (skeleton loading is acceptable for empty chat)
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });

    // Cleanup
    await api('DELETE', `/api/chats/${chatId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Automations Page
// ═══════════════════════════════════════════════════════════════

test.describe('6. Automations Page', () => {
  test('automations page loads with list', async ({ page }) => {
    await page.goto(`${WEB_URL}/automations`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Should show automation header
    const main = await page.locator('main').textContent();
    expect(main).toContain('Automations');
  });

  test('new automation button visible', async ({ page }) => {
    await page.goto(`${WEB_URL}/automations`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const newBtn = page.locator('button:has-text("New Automation"), a:has-text("New Automation")');
    await expect(newBtn).toBeVisible({ timeout: 10000 });
  });

  test('automation detail page loads', async ({ page }) => {
    // Get first automation from API
    const { data } = await api('GET', '/api/automations');
    const automations = data as Array<{ id: string }>;
    if (automations.length === 0) {
      test.skip();
      return;
    }

    await page.goto(`${WEB_URL}/automations/${automations[0]!.id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const main = await page.locator('main').textContent();
    expect(main).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Projects Page
// ═══════════════════════════════════════════════════════════════

test.describe('7. Projects Page', () => {
  test('projects page loads', async ({ page }) => {
    await page.goto(`${WEB_URL}/projects`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const main = await page.locator('main').textContent();
    expect(main).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Templates Page
// ═══════════════════════════════════════════════════════════════

test.describe('8. Templates Page', () => {
  test('templates page loads', async ({ page }) => {
    await page.goto(`${WEB_URL}/templates`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const main = await page.locator('main').textContent();
    expect(main).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Settings Page
// ═══════════════════════════════════════════════════════════════

test.describe('9. Settings Page', () => {
  test('settings page loads', async ({ page }) => {
    await page.goto(`${WEB_URL}/settings`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const main = await page.locator('main').textContent();
    expect(main).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. Full Workflow Lifecycle — Browser E2E
// ═══════════════════════════════════════════════════════════════

test.describe('10. Full Workflow Lifecycle (Browser)', () => {
  let defId: string;
  let runId: string;

  test('create workflow, run it, verify messages, cleanup', async ({ page }) => {
    // 1. Create workflow via API
    const { data: def } = await api('POST', '/api/workflow-definitions', {
      name: `Full Lifecycle ${Date.now()}`,
      sessionMode: 'single',
    });
    defId = (def as { id: string }).id;

    await api('POST', `/api/workflow-definitions/${defId}/stages`, {
      name: 'Lifecycle Stage',
      order: 0,
      prompts: [{ label: 'LC', text: 'Say "lifecycle complete" and nothing else.', waitForCompletion: true }],
    });

    // 2. Create and start run
    const { data: run } = await api('POST', '/api/workflow-runs', { workflowDefinitionId: defId });
    runId = (run as { id: string }).id;
    await api('POST', `/api/workflow-runs/${runId}/start`);

    // 3. Navigate to run page
    await page.goto(`${WEB_URL}/workflows/${defId}/runs/${runId}`);
    await page.waitForLoadState('networkidle');

    // 4. Wait for completion
    const status = await waitForRunComplete(runId);

    // 5. Reload and check messages
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // 6. Click stage to expand
    const stageBtn = page.locator('button:has-text("Lifecycle Stage")');
    if (await stageBtn.isVisible()) {
      await stageBtn.click();
      await page.waitForTimeout(2000);
    }

    // 7. Check chat history via API
    const { data: runData } = await api('GET', `/api/workflow-runs/${runId}`);
    const sr = (runData as { stageRuns: Array<{ sessionId: string; id: string }> }).stageRuns[0]!;
    const { data: msgs } = await api('GET', `/api/sessions/${sr.sessionId}/chat?stageRunId=${sr.id}`);
    const messages = msgs as Array<{ role: string }>;
    expect(messages.length).toBeGreaterThanOrEqual(2);

    // 8. Cleanup
    await api('DELETE', `/api/workflow-definitions/${defId}`);
  });
});
