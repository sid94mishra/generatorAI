// The display name of a model id from the live provider catalog (the same
// catalog the picker shows), e.g. for the composer's "Message <model>…".
import { useMemo } from 'react';
import { buildModelPickerCatalog, findPickerModel } from '@generatorai/client-core';
import type { ProviderMark } from '@generatorai/shared';
import { harnessProviderLabel } from '@generatorai/shared/ui-contract';
import { useHarnessProviders } from '@/hooks/harnessQueries.js';

export interface ModelSource {
  /** The model's display name. */
  name: string;
  /** The picker entry that lists it, when that is a sub-provider (an ACP agent): its label and mark. */
  agent?: { label: string; mark?: ProviderMark };
}

/** A model id's display name and, for a sub-provider's model, the agent that serves it. */
export function useModelSource(modelId: string | undefined): ModelSource | undefined {
  const providers = useHarnessProviders();
  return useMemo(() => {
    if (!modelId || !providers.data) return undefined;
    const catalog = buildModelPickerCatalog(providers.data);
    const model = findPickerModel(catalog, modelId);
    if (!model) return undefined;
    const entry = catalog.providers.find((p) => p.key === model.providerKey);
    if (!entry?.subProvider) return { name: model.name };
    return { name: model.name, agent: { label: entry.label, ...(entry.mark ? { mark: entry.mark } : {}) } };
  }, [modelId, providers.data]);
}

export function useModelLabel(modelId: string | undefined): string | undefined {
  return useModelSource(modelId)?.name;
}

/** Who a chat answers as when no named agent drives it: the ACP agent serving its model, else its provider. */
export function useHarnessLabel(provider: string | undefined | null, modelId: string | undefined | null): string | null {
  const source = useModelSource(modelId ?? undefined);
  if (!provider) return null;
  return source?.agent?.label ?? harnessProviderLabel(provider);
}
