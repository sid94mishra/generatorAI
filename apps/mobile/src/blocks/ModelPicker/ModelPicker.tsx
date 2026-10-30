// MB-03 ModelPicker (MModelPicker, the Turn sheet; New chat's model page; Settings › General later): the provider's
// real models as a plain list (D-131 — no tier sections, no "Recommended" rows), single choice (MD-49: iOS trailing
// ✓, Android leading radio — the kit's radio row); each row shows only what the provider returned — its description,
// a "default" badge when the provider flags the model, mono context ("200K · 1M") when reported. One section per
// provider (with its logo, D-132) unless a provider is chosen. A search field past 12 models. Never offers a
// provider that is not ready (MD-35).
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { ModelPickerCatalog } from '@generatorai/client-core';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Badge } from '../../ui/primitives/Badge';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ProviderLogo } from '../../ui/primitives/ProviderLogo';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { contextLabel, modelSections } from './modelPickerModel';

export { contextLabel, modelSections, type ModelSection } from './modelPickerModel';

export interface ModelPickerProps {
  catalog: ModelPickerCatalog;
  value: { provider: string; model: string } | null;
  onValueChange: (value: { provider: string; model: string }) => void;
  providerFilter?: string | null;
  searchable?: boolean;
}

export function ModelPicker({ catalog, value, onValueChange, providerFilter, searchable }: ModelPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const pool = useMemo(() => catalog.models.filter((m) => !providerFilter || m.provider === providerFilter), [catalog.models, providerFilter]);
  const sections = useMemo(() => modelSections(catalog, { provider: providerFilter, query }), [catalog, providerFilter, query]);
  const showSearch = searchable ?? pool.length > 12;
  return (
    <View className="gap-2">
      {showSearch ? <SearchInput value={query} onChangeText={setQuery} placeholder="Search models" size="compact" testID="model-search" /> : null}
      {sections.length === 0 ? (
        <EmptyState compact icon="model" title={query ? 'No matching models' : 'No models'} description={query ? 'Try a different search.' : 'Sign in to a provider in Settings, then refresh.'} />
      ) : (
        sections.map((section) => (
          <ListSection key={section.provider} {...(providerFilter ? {} : { title: section.title })}>
            {section.models.map((m) => (
              <ListRow
                key={`${m.provider}:${m.id}`}
                kind="radio"
                title={m.name}
                {...(m.description ? { subtitle: m.description } : {})}
                {...(providerFilter ? {} : { leading: <ProviderLogo provider={m.provider} /> })}
                {...(m.isDefault ? { badge: <Badge label="default" size="sm" /> } : {})}
                {...(contextLabel(m) ? { value: contextLabel(m)!, mono: true } : {})}
                selected={value?.model === m.id && value.provider === m.provider}
                onPress={() => onValueChange({ provider: m.provider, model: m.id })}
                testID={`model-row-${m.id}`}
              />
            ))}
          </ListSection>
        ))
      )}
    </View>
  );
}
