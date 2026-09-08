// ────────────────────────────────────────────────────────────────
// AgentDetailSheet — read-only view of a reusable agent.
//
// Authoring stays on the desktop (it grants capability); the phone shows
// what the agent is, what it may use, and whether it is enabled. The list
// endpoint does not carry a model, so none is claimed here.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import type { AgentSummary } from '@generatorai/client-core';

import { Sheet, SheetSection } from '../ui/Sheet';
import { Badge } from '../ui/primitives';
import { ListGroup, ListRow } from '../ui/ListRow';

export function AgentDetailSheet({
  agent,
  onClose,
}: {
  agent: AgentSummary | null;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Sheet visible={agent !== null} onClose={onClose} title={agent?.name ?? 'Agent'} detents={[0.6, 0.92]} keyboardAware={false}>
      {agent ? (
        <View className="gap-2 pb-4">
          <View className="flex-row flex-wrap gap-2 px-4 pt-3">
            <Badge label={agent.role === 'orchestrator' ? 'Orchestrator' : 'Agent'} tone={agent.role === 'orchestrator' ? 'primary' : 'neutral'} />
            <Badge label={agent.scope} tone="neutral" />
            <Badge label={agent.enabled ? 'Enabled' : 'Disabled'} tone={agent.enabled ? 'success' : 'neutral'} />
            <Badge label={`v${agent.version}`} tone="neutral" />
          </View>

          {agent.description ? (
            <Text className="px-4 pt-1 text-sm leading-relaxed text-foreground">{agent.description}</Text>
          ) : (
            <Text className="px-4 pt-1 text-sm text-muted-foreground">No description.</Text>
          )}

          <SheetSection title="Identity" />
          <View className="px-4">
            <ListGroup>
              <ListRow title="Reference" subtitle={agent.ref} />
              <ListRow title="Slug" subtitle={agent.slug} />
            </ListGroup>
          </View>

          <SheetSection title={`Skills (${agent.skillIds.length})`} />
          <View className="px-4">
            {agent.skillIds.length === 0 ? (
              <Text className="text-sm text-muted-foreground">Uses no skills.</Text>
            ) : (
              <ListGroup>
                {agent.skillIds.map((id) => (
                  <ListRow key={id} title={id} />
                ))}
              </ListGroup>
            )}
          </View>

          <SheetSection title={`MCP servers (${agent.mcpServerIds.length})`} />
          <View className="px-4">
            {agent.mcpServerIds.length === 0 ? (
              <Text className="text-sm text-muted-foreground">Uses no MCP servers.</Text>
            ) : (
              <ListGroup>
                {agent.mcpServerIds.map((id) => (
                  <ListRow key={id} title={id} />
                ))}
              </ListGroup>
            )}
          </View>

          <Text className="px-4 pt-3 text-xs leading-relaxed text-muted-foreground">
            Agents are edited on the desktop or web app, where the full capability policy is visible.
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}
