// docs/redesign/07-phases.md §P1-S3. Ported in P3 (list) and P4 (chat page).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const chatsRoutes: RouteObject[] = [
  defineRoute(
    'chats',
    () => import('@/pages/ChatsListPage.js').then((m) => ({ default: m.ChatsListPage })),
    { legacyHeader: true, nav: 'chats', title: 'Chats' },
  ),
  defineRoute(
    'chats/:id',
    () => import('@/pages/ChatPage.js').then((m) => ({ default: m.ChatPage })),
    { legacyHeader: true, nav: 'chats', title: 'Chat' },
  ),
];
