// ────────────────────────────────────────────────────────────────
// useAdminApi — the full typed client (control + authoring routes).
//
// `useApi` exposes the thin read-mostly surface. The run, automation and
// codebase CONTROL routes live on `createAdminApi`; whether a call succeeds
// is decided by the route policy, so screens gate the buttons with
// `checkFeature` before offering them.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { createAdminApi, type AdminApi } from '@generatorai/client-core';

import { useAuth } from '../auth/AuthProvider';

export function useAdminApi(): AdminApi {
  const { fetch } = useAuth();
  return useMemo(() => createAdminApi(fetch), [fetch]);
}
