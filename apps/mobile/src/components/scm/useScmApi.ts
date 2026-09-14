// The source-control client, bound to the authenticated fetch.
//
// Separate from `api.ts` so the endpoint table itself stays free of React
// and of the auth provider — `createScmApi` is then testable against a
// mocked fetch in the node test environment.

import { useMemo } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { createScmApi, type ScmApi } from './api';

export function useScmApi(): ScmApi {
  const { fetch } = useAuth();
  return useMemo(() => createScmApi(fetch), [fetch]);
}
