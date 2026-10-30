// ────────────────────────────────────────────────────────────────
// ModelLabel — a model's provider logo + display name from the live provider
// catalog (the picker's catalog), for read-only places that show which model
// ran: Activity details and workers, background task rows and detail (D-132).
// A model the catalog does not list (its provider signed out, or hidden)
// shows its raw id with the provider's logo when the caller knows it.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { buildModelPickerCatalog, findPickerModel } from '@generatorai/client-core';
import { useHarnessProviders } from '@/hooks/harnessQueries.js';
import { cn } from '@/ui/lib/cn.js';
import { ProviderLogo } from '@/ui/primitives/ProviderLogo/ProviderLogo.js';

export interface ModelLabelProps {
  modelId: string;
  /** The provider, when the caller knows it (disambiguates an id two providers serve). */
  provider?: string | undefined;
  /** Mono id instead of the display name. */
  mono?: boolean;
  className?: string;
}

/** Provider logo + model name. */
export function ModelLabel({ modelId, provider, mono = false, className }: ModelLabelProps) {
  const { data } = useHarnessProviders();
  const model = useMemo(
    () => (data ? findPickerModel(buildModelPickerCatalog(data), modelId, provider) : undefined),
    [data, modelId, provider],
  );
  const owner = model?.provider ?? provider;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)} title={model && model.name !== modelId ? modelId : undefined}>
      {owner ? <ProviderLogo provider={owner} size={12} /> : null}
      <span className={cn('min-w-0 truncate', mono && 'font-mono')}>{mono ? modelId : (model?.name ?? modelId)}</span>
    </span>
  );
}
