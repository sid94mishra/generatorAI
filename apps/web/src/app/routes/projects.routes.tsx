// docs/redesign/07-phases.md §P1-S3. Ported in P5 (P5-02…P5-06, features/projects).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const projectsRoutes: RouteObject[] = [
  defineRoute(
    'projects',
    () => import('@/features/projects/ProjectsListPage.js').then((m) => ({ default: m.ProjectsListPage })),
    { nav: 'projects', title: 'Projects' },
  ),
  defineRoute(
    'projects/new',
    () => import('@/features/projects/CreateProjectPage.js').then((m) => ({ default: m.CreateProjectPage })),
    { nav: 'projects', title: 'New project' },
  ),
  // R-3: tabs are path segments (codebases|chats|runs|pull-requests|issues|
  // customization|settings); the codebase routes below outrank `:tab`.
  defineRoute(
    'projects/:id/:tab?',
    () => import('@/features/projects/ProjectDetailPage.js').then((m) => ({ default: m.ProjectDetailPage })),
    { nav: 'projects', title: 'Project' },
  ),
  defineRoute(
    'projects/:id/codebases/:cid/:tab?',
    () => import('@/features/projects/CodebaseDetailPage.js').then((m) => ({ default: m.CodebaseDetailPage })),
    { nav: 'projects', title: 'Codebase' },
  ),
  defineRoute(
    'projects/:id/codebases/:cid/pull-requests/:number',
    () => import('@/features/projects/PullRequestPage.js').then((m) => ({ default: m.PullRequestPage })),
    { nav: 'projects', title: 'Pull request' },
  ),
  defineRoute(
    'projects/:id/codebases/:cid/issues/:number',
    () => import('@/features/projects/IssuePage.js').then((m) => ({ default: m.IssuePage })),
    { nav: 'projects', title: 'Issue' },
  ),
];
