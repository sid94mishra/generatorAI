// docs/redesign/07-phases.md §P1-S3. Ported in P3 (list) and P4 (chat page).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const chatsRoutes: RouteObject[] = [
  defineRoute(
    'chats',
    () => import('@/features/chats/ChatsListPage.js').then((m) => ({ default: m.ChatsListPage })),
    // P3-07: the first page ported to the kit. It renders its own PageHeader
    // (T-01); RouteSlot's LegacyHeader (P3-04) honours the flag.
    { legacyHeader: false, nav: 'chats', title: 'Chats' },
  ),
  defineRoute(
    'chats/:id',
    // The Tasks-panel section registrations (03 §1.5) load with the page.
    () =>
      Promise.all([import('@/app/registries/tasksSections.js'), import('@/pages/ChatPage.js')]).then(([, m]) => ({
        default: m.ChatPage,
      })),
    { legacyHeader: true, nav: 'chats', title: 'Chat' },
  ),
];
