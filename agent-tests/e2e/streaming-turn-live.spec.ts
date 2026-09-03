// ────────────────────────────────────────────────────────────────
// A real streaming turn, in a real browser, against a real provider.
//
// Every other spec asserts plumbing or replays a fixed SSE sequence. This one
// asserts the thing a user actually experiences: type a prompt, watch tokens
// arrive incrementally, see the turn settle.
//
// Opt-in, because it spends real model budget and takes real time —
// TEST_PLAN.md §2's "live mode":
//
//   E2E_LIVE=1 npx playwright test e2e/streaming-turn-live.spec.ts
//
// It asserts on STRUCTURE and TIMING, never on generated prose: that output
// grew in more than one step (which is what distinguishes streaming from a
// single render at the end), that the turn reached a terminal state, and that
// nothing threw in the page. A model that answers differently every run
// cannot make this flaky.
// ────────────────────────────────────────────────────────────────

import { test, expect } from '../helpers/test';

const LIVE = process.env.E2E_LIVE === '1';

test.describe('Live streaming turn', () => {
  test.skip(!LIVE, 'Set E2E_LIVE=1 to run — this spends real model budget.');

  test('streams a real assistant turn incrementally and settles', async ({ page, gotoApp, seed }) => {
    test.setTimeout(180_000);

    const chatId = await seed.chat({ name: `live-stream-${Date.now()}` });

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

    await gotoApp(`/chats/${chatId}`);

    const composer = page.getByRole('textbox').last();
    await composer.waitFor({ state: 'visible', timeout: 30_000 });
    await composer.fill('Reply with exactly the five words: alpha bravo charlie delta echo');
    await composer.press('Enter');

    // Sample transcript length over time. Streaming shows up as several
    // increases; a single jump at the end would mean we are only seeing the
    // final render, which is the regression this test exists to catch.
    const lengths: number[] = [];
    const started = Date.now();
    let settled = false;

    while (Date.now() - started < 150_000) {
      lengths.push(await page.evaluate(() => (document.body.innerText || '').length).catch(() => 0));
      const tail = lengths.slice(-5);
      if (
        tail.length === 5 &&
        tail.every((n) => n === tail[0]) &&
        tail[0]! > lengths[0]! + 20
      ) {
        settled = true;
        break;
      }
      await page.waitForTimeout(700);
    }

    const growthSteps = lengths.filter((n, i) => i > 0 && n > lengths[i - 1]!).length;
    const totalAdded = lengths.at(-1)! - lengths[0]!;

    expect(totalAdded, 'the turn produced no output at all').toBeGreaterThan(20);
    expect(
      growthSteps,
      `output appeared in ${growthSteps} step(s) — streaming should produce several`,
    ).toBeGreaterThanOrEqual(2);
    expect(settled, 'the turn never reached a stable state').toBe(true);
    expect(pageErrors, `page threw during the turn: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
