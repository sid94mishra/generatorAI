// ────────────────────────────────────────────────────────────────
// Model picker sheet — the mobile form of the web ModelPicker.
//
// Web puts a vertical provider RAIL beside a 288pt model column and floats a
// details card to one side. A phone has room for exactly one column, so the
// same three regions stack:
//
//   provider rail  →  a horizontal strip of brand marks across the top
//   model list     →  the column, full width
//   details card   →  expands INLINE under the row it belongs to
//
// The rail is kept rather than flattened into section headers because it is
// what makes "this provider is signed out" expressible: a header can only
// describe models that exist, and the whole point is to explain the ones that
// do not.
//
// Rows carry the vendor mark that web omits. Web can afford a bare row
// because the rail is permanently in view beside it; here the rail scrolls,
// so each row has to say for itself who built the model.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Cpu,
  Gauge,
  Globe,
  Lock,
  RefreshCw,
  Search,
} from 'lucide-react-native';
import type { ModelInfo, ProviderStatus } from '@generatorai/client-core';

import { Sheet } from '../ui/Sheet';
import { IconButton } from '../ui/Button';
import { Touchable } from '../ui/Touchable';
import { EmptyState, LoadingState } from '../ui/States';
import { SearchField } from '../ui/Form';
import { MAX_SCALE } from '../ui/accessibility';
import { ProviderBrandIcon, ModelVendorIcon } from '../brand/VendorIcons';
import { fuzzyFilter } from '../../lib/fuzzyMatch';
import { promptLimit, reasoningEfforts } from '../../api/modelCatalogue';
import { useProviders } from '../../api/useModels';
import { useTheme } from '../../theme/ThemeProvider';

/** "264K" / "1M" — the shorthand the web picker uses. */
export function formatTokens(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Web's `categoryLabel` — the only capability wording the two apps share. */
function categoryLabel(category: string): string {
  switch (category) {
    case 'lightweight':
      return 'Fast';
    case 'versatile':
      return 'Balanced';
    case 'powerful':
      return 'Powerful';
    default:
      return category.charAt(0).toUpperCase() + category.slice(1);
  }
}

function longContextLimit(model: ModelInfo): number | null {
  const long = model.longContext?.promptTokenLimit ?? model.contextWindow;
  return typeof long === 'number' && long > 0 ? long : null;
}

/** Claude marks carry their own brand orange; everything else is tinted. */
function isBrandColoured(modelId: string): boolean {
  return /claude|sonnet|opus|haiku/i.test(modelId);
}

export function ModelSheet({
  visible,
  onClose,
  selectedId,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);

  // Owned here rather than drilled through the composer: it is the same
  // cached query either way, and the picker is the only thing that needs the
  // per-provider shape.
  const query$ = useProviders();
  const providers = useMemo(() => query$.data?.providers ?? [], [query$.data]);
  const primary = query$.data?.primary ?? 'copilot';
  const loading = query$.isLoading;
  const refreshing = query$.isFetching;
  const onRefresh = (): void => void query$.refetch();

  // Open on the provider that owns the current model, so the selected row is
  // already on screen rather than one tab away.
  const owningProvider = useMemo(() => {
    for (const p of providers) {
      if ((p.models ?? []).some((m) => m.id === selectedId)) return p.type;
    }
    return primary;
  }, [providers, selectedId, primary]);

  const activeTab = tab ?? owningProvider;
  const active = providers.find((p) => p.type === activeTab) ?? providers[0];

  // Transient state must not survive a dismiss — reopening onto a stale
  // search that hides the selected model reads as data loss.
  useEffect(() => {
    if (visible) return;
    setQuery('');
    setInfoId(null);
  }, [visible]);

  const models = useMemo(() => {
    const source = active?.ready ? (active.models ?? []) : [];
    return fuzzyFilter(source, query, (m) => [m.name, m.id]);
  }, [active, query]);

  const body = ((): React.ReactElement => {
    if (loading && providers.length === 0) {
      return <LoadingState label="Loading live model catalogues…" />;
    }
    if (!active) {
      return (
        <EmptyState
          title="No providers"
          message="No agent provider is configured on this server."
        />
      );
    }
    if (!active.ready) {
      return (
        <EmptyState
          title={`${active.label} is unavailable`}
          message={
            active.error ??
            (active.installed === false
              ? 'Provider SDK is not installed.'
              : 'Sign in to this provider to use its models.')
          }
          icon={<Lock size={22} color={colors['muted-foreground']} />}
        />
      );
    }
    if (models.length === 0) {
      return (
        <EmptyState
          title="No models found"
          message={`Nothing in ${active.label} matches “${query.trim()}”.`}
          icon={<Search size={22} color={colors['muted-foreground']} />}
        />
      );
    }
    return (
      <View className="px-2 pb-6">
        {models.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            provider={active}
            selected={model.id === selectedId}
            expanded={infoId === model.id}
            onToggleInfo={() => setInfoId((prev) => (prev === model.id ? null : model.id))}
            onSelect={() => {
              onSelect(model.id);
              onClose();
            }}
          />
        ))}
      </View>
    );
  })();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Model"
      detents={[0.75, 0.92]}
      action={
        <IconButton
          accessibilityLabel="Refresh model list"
          icon={
            <RefreshCw
              size={18}
              color={refreshing ? colors.primary : colors['muted-foreground']}
            />
          }
          onPress={onRefresh}
          disabled={refreshing}
        />
      }
    >
      {providers.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={{
            gap: 8,
            paddingHorizontal: 16,
            paddingBottom: 10,
            alignItems: 'center',
          }}
        >
          {providers.map((p) => {
            const isActive = p.type === activeTab;
            return (
              <Touchable
                key={p.type}
                accessibilityLabel={
                  p.ready
                    ? `${p.label}, ${p.modelCount} model${p.modelCount === 1 ? '' : 's'}`
                    : `${p.label}, unavailable`
                }
                accessibilityState={{ selected: isActive }}
                haptic="select"
                onPress={() => {
                  setTab(p.type);
                  setInfoId(null);
                }}
                className={`min-h-9 flex-row items-center gap-2 rounded-full border px-3 ${
                  isActive ? 'border-primary bg-accent' : 'border-border bg-raised'
                }`}
              >
                <View style={p.ready ? undefined : { opacity: 0.4 }}>
                  <ProviderBrandIcon
                    provider={p.type}
                    size={16}
                    {...(p.type === 'copilot'
                      ? { color: isActive ? colors.primary : colors['muted-foreground'] }
                      : {})}
                  />
                </View>
                <Text
                  maxFontSizeMultiplier={MAX_SCALE.chrome}
                  className={`text-sm font-medium ${
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {p.label}
                </Text>
                {p.ready ? (
                  <Text
                    maxFontSizeMultiplier={MAX_SCALE.chrome}
                    className="text-xs text-muted-foreground"
                  >
                    {p.modelCount}
                  </Text>
                ) : (
                  <Lock size={11} color={colors['muted-foreground']} />
                )}
              </Touchable>
            );
          })}
        </ScrollView>
      ) : null}

      <View className="px-4 pb-3">
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search models"
        />
      </View>

      {body}
    </Sheet>
  );
}

function ModelRow({
  model,
  provider,
  selected,
  expanded,
  onToggleInfo,
  onSelect,
}: {
  model: ModelInfo;
  provider: ProviderStatus;
  selected: boolean;
  expanded: boolean;
  onToggleInfo: () => void;
  onSelect: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const tokens = formatTokens(promptLimit(model));
  const efforts = reasoningEfforts(model);
  const longCtx = model.supportsLongContext ? formatTokens(longContextLimit(model)) : null;

  return (
    <View className={`rounded-2xl ${selected ? 'bg-accent' : ''}`}>
      <View className="flex-row items-center">
        <Touchable
          accessibilityLabel={model.name}
          accessibilityState={{ selected }}
          haptic="select"
          scale="none"
          onPress={onSelect}
          className="min-h-12 flex-1 flex-row items-center gap-2.5 py-2 pl-2.5"
        >
          <View className="h-5 w-5 items-center justify-center">
            {selected ? <Check size={18} color={colors.primary} /> : null}
          </View>
          <ModelVendorIcon
            modelId={model.id}
            size={16}
            {...(isBrandColoured(model.id) ? {} : { color: colors['muted-foreground'] })}
          />
          <Text
            numberOfLines={1}
            className={`flex-1 text-md font-medium ${selected ? 'text-primary' : 'text-foreground'}`}
          >
            {model.name}
          </Text>
          {tokens ? (
            <View className="rounded-md bg-emphasis px-1.5 py-0.5">
              <Text
                maxFontSizeMultiplier={MAX_SCALE.chrome}
                className="text-xs font-medium text-muted-foreground"
              >
                {tokens}
              </Text>
            </View>
          ) : null}
        </Touchable>
        {/* Web reveals this on hover. A phone has no hover, so it is always
            visible and sized as a real touch target. */}
        <IconButton
          accessibilityLabel={expanded ? `Hide ${model.name} details` : `${model.name} details`}
          selected={expanded}
          icon={
            <ChevronDown
              size={18}
              color={expanded ? colors.primary : colors['muted-foreground']}
              style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
            />
          }
          onPress={onToggleInfo}
        />
      </View>

      {expanded ? (
        <View className="gap-1.5 border-t border-border-muted px-4 py-3">
          {model.description ? (
            <Text className="mb-1 text-sm leading-relaxed text-muted-foreground">
              {model.description}
            </Text>
          ) : null}
          <DetailRow
            icon={
              <ProviderBrandIcon
                provider={provider.type}
                size={12}
                {...(provider.type === 'copilot' ? { color: colors['muted-foreground'] } : {})}
              />
            }
            label="Provider"
            value={provider.label}
          />
          {model.category ? (
            <DetailRow
              icon={<Gauge size={12} color={colors['muted-foreground']} />}
              label="Class"
              value={categoryLabel(model.category)}
            />
          ) : null}
          {tokens ? (
            <DetailRow
              icon={<Cpu size={12} color={colors['muted-foreground']} />}
              label="Context (prompt)"
              value={tokens}
            />
          ) : null}
          {longCtx ? (
            <DetailRow
              icon={<Globe size={12} color={colors['muted-foreground']} />}
              label="Long context"
              value={longCtx}
            />
          ) : null}
          {model.maxOutputTokens ? (
            <DetailRow
              icon={<ArrowUp size={12} color={colors['muted-foreground']} />}
              label="Max output"
              value={formatTokens(model.maxOutputTokens) ?? '—'}
            />
          ) : null}
          {efforts.length > 0 ? (
            <DetailRow
              icon={<Gauge size={12} color={colors['muted-foreground']} />}
              label="Reasoning"
              value={`${efforts.length} level${efforts.length === 1 ? '' : 's'}`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-row items-center gap-1.5">
        {icon}
        <Text className="text-sm text-muted-foreground">{label}</Text>
      </View>
      <Text className="text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}
