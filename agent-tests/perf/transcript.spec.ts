// ────────────────────────────────────────────────────────────────
// 09 §8.2 — transcript virtualization acceptance (D-33 spike).
//
// A real chat (seeded through the API) whose messages endpoint is answered
// with the 2,000-block fixture. Measures scroll smoothness (rAF frame deltas
// over a wheel scroll top → bottom → top), the rendered block count, streaming
// anchoring and "not yanked" (tokens appended through the app's own stream
// store — the module the SSE manager writes, loaded from the Vite dev server),
// and app-level find reaching a turn that is not rendered.
//
// Prints one JSON line per metric group; the go/no-go is recorded in
// docs/redesign/reviews/P4-07-virtualization-spike.md.
// ────────────────────────────────────────────────────────────────

import { expect, test } from '@playwright/test';
import { needle, transcriptMessages } from './fixtures/transcript-2000';

const API = process.env.API_URL || 'http://localhost:3100/api';

async function createChat(): Promise<{ id: string; sessionId: string }> {
  const res = await fetch(`${API}/chats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `perf-transcript-${Date.now()}`, tags: ['perf'] }),
  });
  const chat = (await res.json()) as { id: string; sessionId: string };
  expect(chat.id).toBeTruthy();
  return chat;
}

test('2,000-block transcript: frames, DOM size, anchoring, find', async ({ page }) => {
  const chat = await createChat();
  const messages = transcriptMessages(chat.id, chat.sessionId);
  await page.route(`**/api/chats/${chat.id}/messages**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(messages) }),
  );
  await page.goto(`/chats/${chat.id}`);
  const scroller = page.getByTestId('transcript-scroll');
  await expect(page.getByText(needle(399))).toBeVisible({ timeout: 30_000 });

  // ── Frames + DOM size while wheel-scrolling top → bottom → top ──
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __nodes: number[]; __stop: boolean };
    w.__frames = [];
    w.__nodes = [];
    w.__stop = false;
    let last = performance.now();
    const tick = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const sample = setInterval(() => {
      w.__nodes.push(document.querySelectorAll('[data-gai-block]').length);
      if (w.__stop) clearInterval(sample);
    }, 250);
  });
  const box = await scroller.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const height = await scroller.evaluate((el) => el.scrollHeight);
  const steps = 100;
  for (const dir of [-1, 1, -1]) {
    for (let i = 0; i < steps; i += 1) {
      await page.mouse.wheel(0, (dir * height) / steps);
      await page.waitForTimeout(16);
    }
  }
  const { frames, nodes } = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __nodes: number[]; __stop: boolean };
    w.__stop = true;
    return { frames: w.__frames.slice(2), nodes: w.__nodes };
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const within = frames.filter((d) => d <= 16.7 + 0.5).length / frames.length;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const maxNodes = Math.max(...nodes);
  console.log(JSON.stringify({ metric: 'scroll', frames: frames.length, within16: Number(within.toFixed(3)), p99: Number(p99.toFixed(1)), maxNodes }));

  // ── Streaming anchored: at the bottom, append 500 tokens at 20 ms ──
  await page.getByRole('button', { name: /Jump to latest/ }).click({ timeout: 2000 }).catch(() => undefined);
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const anchored = await page.evaluate(
    async ({ sessionId, STORE_MODULE }) => {
      const mod = (await import(/* @vite-ignore */ STORE_MODULE)) as {
        useStreamStore: { getState(): { startPending(s: string, m: string): void; appendToken(s: string, t: string): void } };
      };
      const store = mod.useStreamStore.getState();
      const el = document.querySelector('[data-testid="transcript-scroll"]') as HTMLElement;
      store.startPending(sessionId, 'perf streaming prompt');
      let worst = 0;
      for (let i = 0; i < 500; i += 1) {
        mod.useStreamStore.getState().appendToken(sessionId, i % 12 === 11 ? ' word\n\n' : ' word');
        await new Promise((r) => setTimeout(r, 20));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        worst = Math.max(worst, el.scrollHeight - el.scrollTop - el.clientHeight);
      }
      return worst;
    },
    { sessionId: chat.sessionId, STORE_MODULE: '/src/stores/streamStore.ts' },
  );
  console.log(JSON.stringify({ metric: 'anchored', worstGapPx: anchored }));

  // ── Not yanked: scroll up 600 px, stream more, scrollTop holds ──
  const yank = await page.evaluate(
    async ({ sessionId, STORE_MODULE }) => {
      const mod = (await import(/* @vite-ignore */ STORE_MODULE)) as {
        useStreamStore: { getState(): { appendToken(s: string, t: string): void } };
      };
      const el = document.querySelector('[data-testid="transcript-scroll"]') as HTMLElement;
      el.scrollTop = el.scrollTop - 600;
      el.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 100));
      const before = el.scrollTop;
      for (let i = 0; i < 100; i += 1) {
        mod.useStreamStore.getState().appendToken(sessionId, ' more');
        await new Promise((r) => setTimeout(r, 20));
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { drift: Math.abs(el.scrollTop - before) };
    },
    { sessionId: chat.sessionId, STORE_MODULE: '/src/stores/streamStore.ts' },
  );
  const jump = page.getByRole('button', { name: /Jump to latest/ });
  const jumpVisible = await jump.isVisible();
  console.log(JSON.stringify({ metric: 'notYanked', driftPx: yank.drift, jumpToLatest: jumpVisible }));

  // ── Find a turn that is not rendered ──
  const offscreen = needle(3);
  const renderedBefore = await page.getByText(offscreen).count();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  const find = page.getByTestId('transcript-find');
  const findOpened = await find.isVisible().catch(() => false);
  if (findOpened) {
    await find.getByRole('textbox').fill(offscreen);
    await expect(page.getByText(offscreen)).toBeVisible({ timeout: 10_000 });
  }
  console.log(JSON.stringify({ metric: 'find', renderedBefore, findOpened, found: findOpened }));

  expect(maxNodes).toBeLessThanOrEqual(3000);
});
