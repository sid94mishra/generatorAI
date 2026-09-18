// The project authoring client, bound to the authenticated fetch.

import { useMemo } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { createProjectsApi, type ProjectsApi } from './api';

export function useProjectsApi(): ProjectsApi {
  const { fetch } = useAuth();
  return useMemo(() => createProjectsApi(fetch), [fetch]);
}
