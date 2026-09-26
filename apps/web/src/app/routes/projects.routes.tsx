// docs/redesign/07-phases.md §P1-S3. Ported in P5.
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const projectsRoutes: RouteObject[] = [
  defineRoute(
    'projects',
    () => import('@/pages/ProjectsListPage.js').then((m) => ({ default: m.ProjectsListPage })),
    { legacyHeader: true, nav: 'projects', title: 'Projects' },
  ),
  defineRoute(
    'projects/new',
    () => import('@/pages/CreateProjectPage.js').then((m) => ({ default: m.CreateProjectPage })),
    { legacyHeader: true, nav: 'projects', title: 'Create Project' },
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
