// Reload a page bypassing the cache (D-145). The in-app browser previews the
// user's own site while the agent edits it: a plain reload re-validates only
// the document, so a stylesheet the agent just changed could come from the
// cache and the agent would "verify" a fix it cannot see. Playwright's reload
// has no cache option, so this goes through CDP and falls back to the plain
// reload where a CDP session cannot be opened.

import type { Page } from 'playwright';

export async function reloadFresh(page: Page, timeout = 30_000): Promise<void> {
  let session: Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>> | null = null;
  try {
    session = await page.context().newCDPSession(page);
  } catch {
    session = null;
  }
  if (!session) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout });
    return;
  }
  try {
    const loaded = page.waitForEvent('domcontentloaded', { timeout });
    await session.send('Page.reload', { ignoreCache: true });
    await loaded;
  } finally {
    await session.detach().catch(() => undefined);
  }
}
