import { useMemo } from 'react';
import { useAdminApi } from '../../services/api/useAdminApi';
import { createProjectActions } from './projectActions';

export function useProjectsApi() {
  const admin = useAdminApi();
  return useMemo(() => createProjectActions(admin), [admin]);
}
