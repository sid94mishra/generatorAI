// The display name of a model id from the live provider catalog (the same
// catalog the picker shows), e.g. for the composer's "Message <model>…".
import { useMemo } from 'react';
import { buildModelPickerCatalog, findPickerModel } from '@generatorai/client-core';
import { useHarnessProviders } from '@/hooks/harnessQueries.js';

export function useModelLabel(modelId: string | undefined): string | undefined {
  const providers = useHarnessProviders();
  return useMemo(() => {
    if (!modelId || !providers.data) return undefined;
    return findPickerModel(buildModelPickerCatalog(providers.data), modelId)?.name;
  }, [modelId, providers.data]);
}
