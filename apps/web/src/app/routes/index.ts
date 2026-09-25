// docs/redesign/07-phases.md §P1-S3, docs/redesign/06-desktop-and-shell.md §2.4.
// Concatenates every area's route module into the flat list the router's
// children resolve. Settings stays a page route here until P6 replaces
// `settingsRoutes` with the modal route (D-26).
import type { RouteObject } from 'react-router';
import { homeRoutes } from './home.routes.js';
import { chatsRoutes } from './chats.routes.js';
import { projectsRoutes } from './projects.routes.js';
import { agentsRoutes } from './agents.routes.js';
import { workflowsRoutes } from './workflows.routes.js';
import { automationsRoutes } from './automations.routes.js';
import { scriptsRoutes } from './scripts.routes.js';
import { settingsRoutes } from './settings.routes.js';
import { notFoundRoutes } from './notFound.routes.js';

export const PAGE_ROUTES: RouteObject[] = [
  ...homeRoutes,
  ...chatsRoutes,
  ...projectsRoutes,
  ...agentsRoutes,
  ...workflowsRoutes,
  ...automationsRoutes,
  ...scriptsRoutes,
  ...settingsRoutes,
  ...notFoundRoutes,
];
