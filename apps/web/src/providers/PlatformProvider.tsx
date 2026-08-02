// ────────────────────────────────────────────────────────────────
// PlatformProvider — React context providing HttpPlatformClient
// ────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useMemo } from 'react';
import { HttpPlatformClient } from '../platform/HttpPlatformClient.js';
import type { IPlatformClient } from '@generatorai/shared';

/** Exported for test wrappers; prefer using usePlatform() in app code */
export const PlatformContext = createContext<IPlatformClient | null>(null);

export function usePlatform(): HttpPlatformClient {
  const client = useContext(PlatformContext);
  if (!client) {
    throw new Error('usePlatform must be used within a PlatformProvider');
  }
  return client as HttpPlatformClient;
}

interface PlatformProviderProps {
  baseUrl?: string;
  children: React.ReactNode;
}

export function PlatformProvider({ baseUrl = '', children }: PlatformProviderProps) {
  const client = useMemo(() => new HttpPlatformClient(baseUrl), [baseUrl]);

  return (
    <PlatformContext.Provider value={client}>
      {children}
    </PlatformContext.Provider>
  );
}
