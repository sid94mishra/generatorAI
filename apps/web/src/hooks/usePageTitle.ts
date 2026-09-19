// ────────────────────────────────────────────────────────────────
// usePageTitle — publish the name of the entity this page is showing.
//
// Sets the OS window title (desktop windows are otherwise indistinguishable
// in Mission Control, the taskbar and the window switcher) and gives the
// desktop shell's `Open Recent` a document name instead of a section name.
//
// Pass `undefined` while the name is still loading — the previous title stays
// until the real one arrives, rather than flickering through a placeholder.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { usePageTitleStore } from '@/stores/pageTitleStore.js';

const APP_NAME = 'GeneratorAI';

export function usePageTitle(title: string | null | undefined): void {
  const setTitle = usePageTitleStore((s) => s.setTitle);

  useEffect(() => {
    if (title === undefined) return undefined;
    setTitle(title);
    if (typeof document !== 'undefined') {
      document.title = title ? `${title} — ${APP_NAME}` : APP_NAME;
    }
    return () => {
      setTitle(null);
      if (typeof document !== 'undefined') document.title = APP_NAME;
    };
  }, [title, setTitle]);
}
