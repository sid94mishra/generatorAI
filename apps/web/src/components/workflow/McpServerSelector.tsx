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

  // Exclusions live on `excludedMcpServerIds`.
  //
  // They used to be written into `excludedTools`, which is a list of TOOL
  // names the harness must not expose — putting server names there excluded
  // nothing (no tool is called `github`) while silently corrupting the tool
  // deny-list. Keyed by ID, not name, because two registries can each define
  // a server called "github".
  const currentOverrides = stage.harnessConfigOverrides as Partial<HarnessConfig> | undefined;
  const excludedServers = useMemo(
    () => new Set(currentOverrides?.excludedMcpServerIds ?? []),
    [currentOverrides],
  );

  const writeExcluded = (ids: string[]) => {
    onUpdate({
      harnessConfigOverrides: {
        ...currentOverrides,
        excludedMcpServerIds: ids.length > 0 ? ids : undefined,
      } as Partial<HarnessConfig>,
    });
  };

  const toggleServer = (serverId: string) => {
    const next = new Set(excludedServers);
    if (next.has(serverId)) next.delete(serverId);
    else next.add(serverId);
    writeExcluded([...next]);
  };

  const selectAll = () => writeExcluded([]);

  const deselectAll = () => writeExcluded(allServers.map((s) => s.id));

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
          const isEnabled = !excludedServers.has(server.id);
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
                onChange={() => toggleServer(server.id)}
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
