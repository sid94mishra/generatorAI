// docs/redesign/07-phases.md §P1-S3. Ported in P5.
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const projectsRoutes: RouteObject[] = [
  defineRoute(
    'projects',
    () => import('@/features/projects/ProjectsListPage.js').then((m) => ({ default: m.ProjectsListPage })),
    { legacyHeader: false, nav: 'projects', title: 'Projects' },
  ),
  defineRoute(
    'projects/new',
    () => import('@/features/projects/CreateProjectPage.js').then((m) => ({ default: m.CreateProjectPage })),
    { legacyHeader: false, nav: 'projects', title: 'New project' },
  ),
  defineRoute(
    'projects/:id',
    () => import('@/pages/ProjectDetailPage.js').then((m) => ({ default: m.ProjectDetailPage })),
    { legacyHeader: true, nav: 'projects', title: 'Project' },
  ),
  defineRoute(
    'projects/:id/codebases/:cid',
    () => import('@/pages/CodebaseDetailPage.js').then((m) => ({ default: m.CodebaseDetailPage })),
    { legacyHeader: true, nav: 'projects', title: 'Codebase' },
  ),
  defineRoute(
    'projects/:id/codebases/:cid/pull-requests/:number',
    () => import('@/pages/PullRequestPage.js').then((m) => ({ default: m.PullRequestPage })),
    { legacyHeader: true, nav: 'projects', title: 'Pull Request' },
  ),
];
