// MB-46 CapabilitySummary (MAgentDetail, MAgentEdit3): "Effective capabilities" — the provider · model and the
// effort / context / turns line, the tool grid (on: ✓ fg; off: × fg-3), skills and MCP chips, and the warnings or "No
// warnings". The compact form is one navigation row ("5 tools · 2 skills · 1 MCP · no warnings").
import React from 'react';
import { View } from 'react-native';
import type { ResolvedAgentProjection } from '@generatorai/shared';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Badge } from '../../ui/primitives/Badge';
import { Card } from '../../ui/primitives/Card';
import { Chip } from '../../ui/primitives/Chip';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { Separator } from '../../ui/primitives/Separator';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { capabilityCounts, mcpNames, runtimeLines, toolRows, warningText } from './capabilitySummaryModel';

export interface CapabilitySummaryProps {
  projection: ResolvedAgentProjection | undefined;
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** The editor's draft differs from the saved agent. */
  unsaved?: boolean;
  testID?: string;
}

export function CapabilitySummaryHeader({ projection, unsaved }: Pick<CapabilitySummaryProps, 'projection' | 'unsaved'>): React.ReactElement {
  const warnings = projection?.warnings ?? [];
  return (
    <View className="flex-row items-center gap-2 px-4">
      <Text role="subhead" weight={600}>
        Effective capabilities
      </Text>
      {projection ? (
        <Text role="footnote" tone="fg-3">
          {`${projection.skills.names.length} skills · ${mcpNames(projection).length} MCP`}
        </Text>
      ) : null}
      {unsaved ? <Badge label="unsaved" size="sm" /> : null}
      <View className="flex-1" />
      {projection ? (
        warnings.length ? (
          <Text role="footnote" tone="warn">{`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}</Text>
        ) : (
          <View className="flex-row items-center gap-1">
            <Icon concept="status-succeeded" size={14} tone="ok" />
            <Text role="footnote" tone="ok">
              No warnings
            </Text>
          </View>
        )
      ) : null}
    </View>
  );
}

export function CapabilitySummary({ projection, loading, error, onRetry, unsaved, testID = 'capability-summary' }: CapabilitySummaryProps): React.ReactElement {
  if (loading && !projection) return <Skeleton preset="card" />;
  if (error && !projection) return <ErrorState title="Couldn't resolve the capabilities" error={error} {...(onRetry ? { onRetry } : {})} />;
  if (!projection) return <></>;
  const runtime = runtimeLines(projection.runtime);
  const tools = toolRows(projection.toolPolicy.groups);
  const mcp = mcpNames(projection);
  return (
    <View className="gap-2" testID={testID}>
      <CapabilitySummaryHeader projection={projection} unsaved={unsaved} />
      <View className="px-4">
        <Card radius="group" padding="none">
          {runtime.title || runtime.detail ? (
            <View className="flex-row items-center gap-3 p-4">
              <Icon concept="model" size={20} tone="fg-2" />
              <View className="flex-1 gap-0.5">
                <Text role="subhead" weight={600}>
                  {runtime.title ?? 'Server default model'}
                </Text>
                {runtime.detail ? (
                  <Text role="monoSm" tone="fg-3">
                    {runtime.detail}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
          <Separator />
          <View className="flex-row flex-wrap px-4 py-3">
            {tools.map((t) => (
              <View accessibilityRole="text" key={t.key} className="w-1/2 flex-row items-center gap-2 py-1" accessible accessibilityLabel={`${t.label}, ${t.on ? 'on' : 'off'}`}>
                <Icon concept={t.on ? 'check' : 'x'} size={14} tone={t.on ? 'ok' : 'fg-3'} />
                <Text role="subhead" tone={t.on ? 'fg' : 'fg-3'}>
                  {t.label}
                </Text>
              </View>
            ))}
          </View>
          {projection.skills.names.length || mcp.length ? (
            <>
              <Separator />
              <View className="flex-row flex-wrap gap-2 px-4 py-3">
                {projection.skills.names.map((s) => (
                  <Chip key={`s:${s}`} label={s} icon="skills" />
                ))}
                {mcp.map((m) => (
                  <Chip key={`m:${m}`} label={m} icon="mcp" />
                ))}
              </View>
            </>
          ) : null}
        </Card>
      </View>
      {projection.warnings.length ? (
        <ListSection title="Warnings">
          {projection.warnings.map((w, i) => (
            <ListRow key={i} kind="info" icon="warning" title={warningText(w)} />
          ))}
        </ListSection>
      ) : null}
    </View>
  );
}

/** The compact navigation row (MAgentEdit3 "Effective capabilities ›"). */
export function CapabilitySummaryRow({ projection, onPress }: { projection: ResolvedAgentProjection | undefined; onPress: () => void }): React.ReactElement {
  const warnings = projection?.warnings.length ?? 0;
  return (
    <ListSection>
      <ListRow
        kind="navigation"
        icon="view"
        title="Effective capabilities"
        subtitle={projection ? `${capabilityCounts(projection)} · ${warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : 'no warnings'}` : 'Resolving…'}
        onPress={onPress}
        testID="capability-summary-row"
      />
    </ListSection>
  );
}
