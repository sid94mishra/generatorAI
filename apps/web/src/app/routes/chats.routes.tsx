// docs/redesign/07-phases.md §P1-S3. Ported in P3 (list), P4 (chat page) and
// P5-09 (create). `chats/new` ranks above `chats/:id` on its own (react-router
// prefers a static segment over a dynamic one) but is listed first for
// readability.
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
    'chats/new',
    () => import('@/features/chats/create/ChatCreatePage.js').then((m) => ({ default: m.ChatCreatePage })),
    // P5-09 (R-1, R-2): the addressable full form T-03 FormWithAside. It
    // renders its own PageHeader (breadcrumb "Chats / New chat").
    { legacyHeader: false, nav: 'chats', title: 'New chat' },
  ),
  defineRoute(
    'chats/:id',
    // The Tasks-panel section registrations (03 §1.5) load with the page.
    () =>
      Promise.all([import('@/app/registries/tasksSections.js'), import('@/features/chat/ChatPage.js')]).then(([, m]) => ({
        default: m.ChatPage,
      })),
    // P4-12: the chat workspace renders its own ChatHeader (T-04).
    { legacyHeader: false, nav: 'chats', title: 'Chat' },
  ),
];
