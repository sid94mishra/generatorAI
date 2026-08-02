// ────────────────────────────────────────────────────────────────
// McpServerSelector — Toggle MCP servers per stage
// By default all system MCP servers are enabled
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Server } from 'lucide-react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useSystemMcpServers, useProjectMcpServers } from '@/hooks/projectQueries.js';
import { useCatalogPrefsStore } from '@/stores/catalogPrefsStore.js';
import { cn } from '@/lib/utils.js';
import { Badge } from '@/components/ui/index.js';
import type { StageDefinition, HarnessConfig } from '@generatorai/shared';

interface McpServerSelectorProps {
  stage: StageDefinition;
  onUpdate: (updates: Partial<StageDefinition>) => void;
}

export function McpServerSelector({ stage, onUpdate }: McpServerSelectorProps) {
  const projectId = useWorkflowBuilderStore((s) => s.projectId);
  const { data: systemServers, isLoading: systemLoading } = useSystemMcpServers();
  const { data: projectServers, isLoading: projectLoading } = useProjectMcpServers(projectId ?? undefined);

  // Servers disabled in Settings → MCP Servers are hidden from this selector.
  const disabledMcp = useCatalogPrefsStore((s) => s.disabledMcp);

  const isLoading = systemLoading || projectLoading;
  const allServers = useMemo(() => [
    ...(systemServers ?? []).filter((s) => !disabledMcp.includes(s.id)),
    ...(projectServers ?? []),
  ], [systemServers, projectServers, disabledMcp]);

  // Get currently excluded MCP servers from harnessConfigOverrides
  // TODO: HarnessConfig lacks an `excludedMcpServers` field.
  // Using `excludedTools` as temporary storage; the runtime needs
  // a dedicated field or the `mcpServers` record for proper exclusion.
  const currentOverrides = stage.harnessConfigOverrides as Partial<HarnessConfig> | undefined;
  const excludedServers = useMemo(() => {
    const excluded = currentOverrides?.excludedTools ?? [];
    return new Set(excluded);
  }, [currentOverrides]);

  const toggleServer = (serverName: string) => {
    const newExcluded = new Set(excludedServers);
    if (newExcluded.has(serverName)) {
      newExcluded.delete(serverName);
    } else {
      newExcluded.add(serverName);
    }

    const excludedArray = [...newExcluded];
    onUpdate({
      harnessConfigOverrides: {
        ...currentOverrides,
        excludedTools: excludedArray.length > 0 ? excludedArray : undefined,
      } as Partial<HarnessConfig>,
    });
  };

  const selectAll = () => {
    onUpdate({
      harnessConfigOverrides: {
        ...currentOverrides,
        excludedTools: undefined,
      } as Partial<HarnessConfig>,
    });
  };

  const deselectAll = () => {
    onUpdate({
      harnessConfigOverrides: {
        ...currentOverrides,
        excludedTools: allServers.map((s) => s.name),
      } as Partial<HarnessConfig>,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        Loading MCP servers...
      </div>
    );
  }

  if (allServers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <Server className="mx-auto h-6 w-6 text-muted-foreground mb-1.5" />
        <p className="text-xs text-muted-foreground">
          No MCP servers configured.
        </p>
      </div>
    );
  }

  const enabledCount = allServers.length - excludedServers.size;
  const allEnabled = excludedServers.size === 0;
  const noneEnabled = excludedServers.size === allServers.length;

  return (
    <div className="space-y-2">
      {/* Count + Select/Deselect All */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {enabledCount}/{allServers.length} enabled
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            disabled={allEnabled}
            className="text-[10px] font-medium text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Select all
          </button>
          <span className="text-[10px] text-muted-foreground">·</span>
          <button
            type="button"
            onClick={deselectAll}
            disabled={noneEnabled}
            className="text-[10px] font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Deselect all
          </button>
        </div>
      </div>

      <div className="space-y-1 max-h-48 overflow-y-auto">
        {allServers.map((server) => {
          const isEnabled = !excludedServers.has(server.name);
          return (
            <label
              key={server.id}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs cursor-pointer transition-all',
                isEnabled
                  ? 'bg-primary/5 border border-primary/20'
                  : 'border border-transparent hover:bg-subtle opacity-60',
              )}
            >
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={() => toggleServer(server.name)}
                className="h-3.5 w-3.5 rounded"
              />
              <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate">{server.name}</div>
                {server.description && (
                  <div className="text-[10px] text-muted-foreground truncate">{server.description}</div>
                )}
              </div>
              <Badge tone={server.source === 'system' ? 'info' : 'success'} size="sm" className="text-[9px]">
                {server.source}
              </Badge>
            </label>
          );
        })}
      </div>
    </div>
  );
}
