// ────────────────────────────────────────────────────────────────
// Model picker sheet.
//
// The web picker is a dropdown with a provider rail down the left. That
// layout needs horizontal room a phone does not have, so the same
// information becomes a searchable sectioned list: provider headers, model
// rows, and the capability metadata (context size, reasoning, vision) as a
// subtitle rather than a hover popover — there is no hover on a phone.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { RefreshCw, Search, Sparkles } from 'lucide-react-native';
import type { ModelInfo } from '@generatorai/client-core';

import { Sheet, SheetRow, SheetSection } from '../ui/Sheet';
import { IconButton } from '../ui/Button';
import { Field } from '../ui/Form';
import { Badge } from '../ui/primitives';
import { EmptyState, LoadingState } from '../ui/States';
import { useModelGroups, promptLimit } from '../../api/useModels';
import { useTheme } from '../../theme/ThemeProvider';

/** "264K" / "1M" — the shorthand the web picker uses. */
export function formatTokens(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function describe(model: ModelInfo): string {
  const parts: string[] = [];
  const ctx = formatTokens(promptLimit(model));
  if (ctx) parts.push(`${ctx} context`);
  if (model.supportsReasoning) parts.push('reasoning');
  if (model.category) parts.push(model.category);
  return parts.join(' · ');
}

export function ModelSheet({
  visible,
  onClose,
  models,
  loading,
  selectedId,
  onSelect,
  onRefresh,
}: {
  visible: boolean;
  onClose: () => void;
  models: ModelInfo[] | undefined;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh?: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models?.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.provider ?? '').toLowerCase().includes(q),
    );
  }, [models, query]);

  const groups = useModelGroups(filtered);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Model"
      detents={[0.75, 0.92]}
      action={
        onRefresh ? (
          <IconButton
            accessibilityLabel="Refresh models"
            icon={<RefreshCw size={18} color={colors['muted-foreground']} />}
            onPress={onRefresh}
          />
        ) : undefined
      }
    >
      <View className="px-4 py-3">
        <Field
          placeholder="Search models"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search models"
        />
      </View>

      {loading && !models ? (
        <LoadingState label="Loading catalogue…" />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No models"
          message={
            query
              ? 'No model matches that search.'
              : 'No provider is authenticated. Connect one from Settings › Providers.'
          }
          icon={<Search size={22} color={colors['muted-foreground']} />}
        />
      ) : (
        groups.map((group) => (
          <View key={group.provider}>
            <SheetSection
              title={group.label}
              right={
                <Text className="text-xs text-muted-foreground">{group.models.length}</Text>
              }
            />
            {group.models.map((model) => (
              <SheetRow
                key={model.id}
                title={model.name}
                subtitle={describe(model) || null}
                selected={model.id === selectedId}
                onPress={() => {
                  onSelect(model.id);
                  onClose();
                }}
                right={
                  model.supportsLongContext ? (
                    <Badge label="1M" tone="info" />
                  ) : model.supportsReasoning ? (
                    <Sparkles size={14} color={colors['muted-foreground']} />
                  ) : undefined
                }
              />
            ))}
          </View>
        ))
      )}
    </Sheet>
  );
}
