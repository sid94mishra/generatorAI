// ────────────────────────────────────────────────────────────────
// B-01 ModelPicker — the connected block (03 §2.1). Every surface that picks
// a model for a chat, a turn, an agent or a stage uses it.
//
// Data: `useHarnessProviders()` (one cache entry for every picker) turned into
// client-core's read model with `buildModelPickerCatalog` HERE, in a memo —
// not through `useModelPickerCatalog` — so tests that mock the provider hooks
// by module drive this block as well. Refresh = `useRefreshHarnessProviders`
// (a blocking re-probe of every provider). The popover opens on the selected
// model's provider or the catalog's `defaultProvider`, never on one that is
// not ready (D-55, G-09).
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { buildModelPickerCatalog } from '@generatorai/client-core';
import { useHarnessProviders, useRefreshHarnessProviders } from '@/hooks/harnessQueries.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { ModelPickerView, type ModelPickerVariant } from './ModelPicker.view.js';

export interface ModelPickerProps {
  /** Selected model id ('' = none). */
  value: string;
  onChange: (modelId: string) => void;
  /** `chip` (default): the composer toolbar chip. `field`: a full-width form control. */
  variant?: ModelPickerVariant;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  /** Accessible name of the trigger. Default "Select model". */
  ariaLabel?: string;
  disabled?: boolean;
}

/** Provider + model picker bound to the live provider catalog. */
export function ModelPicker({ value, onChange, variant = 'chip', side, align, ariaLabel, disabled }: ModelPickerProps) {
  const providers = useHarnessProviders();
  const refresh = useRefreshHarnessProviders();
  const openSettings = useSettingsUiStore((s) => s.openSettings);
  const catalog = useMemo(() => (providers.data ? buildModelPickerCatalog(providers.data) : undefined), [providers.data]);

  return (
    <ModelPickerView
      value={value}
      onSelect={onChange}
      catalog={catalog}
      loading={providers.isLoading}
      refreshing={refresh.isPending}
      onRefresh={() => refresh.mutate()}
      onOpenProviderSettings={() => openSettings('providers')}
      variant={variant}
      side={side}
      align={align}
      ariaLabel={ariaLabel}
      disabled={disabled}
    />
  );
}
