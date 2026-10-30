// ────────────────────────────────────────────────────────────────
// VRT `stories` project (docs/redesign/09-verification.md §4.1, §4.3).
//
// One screenshot per story tagged `vrt` (preview.tsx turns the tag on for
// every story; `!vrt` opts out) in Instrument dark, plus Instrument light and
// Solarized light for `vrt-themes`. The accent is always ink and density is
// the story's own. Baselines: agent-tests/vrt/__screenshots__/stories/.
// ────────────────────────────────────────────────────────────────

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface IndexEntry {
  id: string;
  type: 'story' | 'docs';
  tags?: string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = resolve(HERE, '..', '..', 'apps', 'web', 'storybook-static', 'index.json');

const DARK = { theme: 'instrument', mode: 'dark' } as const;
const THEMED = [DARK, { theme: 'instrument', mode: 'light' }, { theme: 'solarized', mode: 'light' }] as const;

function vrtStories(): IndexEntry[] {
  const index = JSON.parse(readFileSync(INDEX, 'utf8')) as { entries: Record<string, IndexEntry> };
  return Object.values(index.entries).filter((e) => e.type === 'story' && e.tags?.includes('vrt'));
}

for (const story of vrtStories()) {
  const combos = story.tags?.includes('vrt-themes') ? THEMED : [DARK];
  for (const { theme, mode } of combos) {
    const name = `${story.id}-${theme}-${mode}`;
    test(name, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // Relative times in stories come from parameters.fixedNow; this pins the rest.
      await page.clock.setFixedTime(new Date('2026-09-01T10:00:00Z'));
      await page.goto(
        `/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=mode:${mode};theme:${theme};accent:ink`,
      );
      const root = page.locator('#storybook-root');
      await expect(root.locator(':scope > *').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(errors, 'story threw while rendering').toEqual([]);
      await expect(root).toHaveScreenshot(`${name}.png`);
    });
  }
}
