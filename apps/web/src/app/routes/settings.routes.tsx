// docs/redesign/07-phases.md §P1-S3. `/settings` and `/settings/:section` stay
// a routed page until P6, when the modal (D-26) replaces this module.
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const settingsRoutes: RouteObject[] = [
  defineRoute(
    'settings',
    () => import('@/pages/SettingsPage.js').then((m) => ({ default: m.SettingsPage })),
    { legacyHeader: true, title: 'Settings' },
  ),
  defineRoute(
    'settings/:section',
    () => import('@/pages/SettingsPage.js').then((m) => ({ default: m.SettingsPage })),
    { legacyHeader: true, title: 'Settings' },
  ),
];
