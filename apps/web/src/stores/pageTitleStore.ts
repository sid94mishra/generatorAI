// ────────────────────────────────────────────────────────────────
// pageTitleStore — the name of the thing currently on screen.
//
// Routes know their section ("Chats"); only the page knows the document
// ("Desktop audit chat"). Two places need the difference:
//
//   • the OS window title, which otherwise reads "GeneratorAI" for every
//     window in Mission Control / the taskbar, and
//   • the desktop shell's `File ▸ Open Recent`, which listed the section name
//     for every entry, so three different chats all read "Chats".
//
// Pages publish through `usePageTitle`; nothing reads this store directly
// except the shell integration and the title effect.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

interface PageTitleState {
  /** Name of the entity on screen, or null on list/section pages. */
  title: string | null;
  setTitle: (title: string | null) => void;
}

export const usePageTitleStore = globalSingleton('pageTitleStore', () =>
  create<PageTitleState>((set) => ({
    title: null,
    setTitle: (title) => set((s) => (s.title === title ? s : { title })),
  })),
);
