// ────────────────────────────────────────────────────────────────
// EffectiveCapabilitiesPanel — what the harness will ACTUALLY receive.
//
// The union algebra (agent ∪ binding-site additions, minus removals) is not
// obvious from either input alone, so every binding surface shows the
// resolved projection rather than making the user simulate the fold.
// The payload is redacted server-side: MCP `env`/`headers` never reach here.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { AlertTriangle, FileText, Server, Shield, Cpu, Users } from 'lucide-react';
import type { ResolvedAgentProjection, AgentToolPolicy } from '@generatorai/shared';
import { AGENT_TOOL_GROUPS } from '@generatorai/shared';
import { Badge, Spinner } from '@/components/ui/index.js';
import { TOOL_GROUP_LABELS, warningText, isBlockingWarning } from '@/lib/agentCopy.js';
import { cn } from '@/lib/utils.js';

export interface EffectiveCapabilitiesPanelProps {
  projection: ResolvedAgentProjection | undefined;
  isLoading?: boolean;
  error?: Error | null;
  /** Counts contributed by the agent alone, to render "5 from agent + 2 added". */
  baseCounts?: { skills: number; mcpServers: number };
  className?: string;
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ElementType;
  title: string;
  count?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {title}
        {count !== undefined && <span className="font-normal normal-case">· {count}</span>}
      </div>
      {children}
    </div>
  );
}

export function EffectiveCapabilitiesPanel({
  projection,
  isLoading = false,
  error = null,
  baseCounts,
  className,
}: EffectiveCapabilitiesPanelProps) {
  if (isLoading) {
    return (
      <div
        className={cn('flex items-center gap-2 p-4 text-xs text-muted-foreground', className)}
        data-testid="effective-capabilities-loading"
      >
        <Spinner size="sm" />
        Resolving effective capabilities…
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('p-4 text-xs text-danger', className)}>
        Could not resolve capabilities: {error.message}
      </div>
    );
  }

  if (!projection) {
    return (
      <div className={cn('p-4 text-xs text-muted-foreground', className)}>
        Effective capabilities appear here once an agent or capability is selected.
      </div>
    );
  }

  const skillNames = projection.skills.names;
  const mcpNames = Object.keys(projection.mcpServers ?? {});
  const groups = projection.toolPolicy.groups as AgentToolPolicy;

  const skillCount =
    baseCounts && skillNames.length >= baseCounts.skills
      ? `${skillNames.length} (${baseCounts.skills} from agent + ${skillNames.length - baseCounts.skills} added)`
      : skillNames.length;
  const mcpCount =
    baseCounts && mcpNames.length >= baseCounts.mcpServers
      ? `${mcpNames.length} (${baseCounts.mcpServers} from agent + ${mcpNames.length - baseCounts.mcpServers} added)`
      : mcpNames.length;

  return (
    <div className={cn('space-y-4', className)} data-testid="effective-capabilities">
      {projection.driving && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
          <div className="text-xs font-semibold text-foreground">{projection.driving.name}</div>
          <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
            {projection.driving.description}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge tone="primary" size="sm">
              {projection.driving.role === 'orchestrator' ? 'Orchestrator' : 'Agent'}
            </Badge>
            <Badge tone="neutral" size="sm">
              instructions {projection.driving.projection}
            </Badge>
            {/* A previewed DRAFT resolves as version 0; showing "v0" reads as a
                real revision and confuses "unsaved" with "brand new". */}
            {projection.agentVersion !== undefined && projection.agentVersion > 0 && (
              <Badge tone="neutral" size="sm">
                v{projection.agentVersion}
              </Badge>
            )}
          </div>
        </div>
      )}

      <Section icon={FileText} title="Skills" count={skillCount}>
        {skillNames.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">None</p>
        ) : (
          <div className="flex flex-wrap gap-1" data-testid="effective-skills">
            {skillNames.map((name) => (
              <Badge key={name} tone="neutral" size="sm">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Server} title="MCP servers" count={mcpCount}>
        {mcpNames.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">None</p>
        ) : (
          <div className="flex flex-wrap gap-1" data-testid="effective-mcp">
            {mcpNames.map((name) => (
              <Badge key={name} tone="neutral" size="sm">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Shield} title="Capabilities">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {AGENT_TOOL_GROUPS.map((g) => (
            <div key={g} className="flex items-center gap-1.5 text-[11px]">
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  groups[g] ? 'bg-success' : 'bg-muted-foreground/40',
                )}
              />
              <span className={groups[g] ? 'text-foreground' : 'text-muted-foreground line-through'}>
                {TOOL_GROUP_LABELS[g]}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {(projection.runtime.model ||
        projection.runtime.reasoningEffort ||
        projection.runtime.permissionMode) && (
        <Section icon={Cpu} title="Runtime">
          <div className="flex flex-wrap gap-1">
            {projection.runtime.model && (
              <Badge tone="neutral" size="sm">
                {projection.runtime.model}
              </Badge>
            )}
            {projection.runtime.reasoningEffort && (
              <Badge tone="neutral" size="sm">
                effort: {projection.runtime.reasoningEffort}
              </Badge>
            )}
            {projection.runtime.permissionMode && (
              <Badge tone="neutral" size="sm">
                {projection.runtime.permissionMode}
              </Badge>
            )}
            {projection.runtime.maxTurns !== undefined && (
              <Badge tone="neutral" size="sm">
                max {projection.runtime.maxTurns} turns
              </Badge>
            )}
          </div>
        </Section>
      )}

      {projection.team.length > 0 && (
        <Section icon={Users} title="Team" count={projection.team.length}>
          <div className="space-y-1">
            {projection.team.map((t) => (
              <div key={t.ref} className="rounded-md bg-subtle px-2 py-1.5">
                <div className="text-[11px] font-medium text-foreground">{t.name}</div>
                <div className="line-clamp-1 text-[10px] text-muted-foreground">{t.description}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {projection.warnings.length > 0 && (
        <div className="space-y-1" data-testid="effective-warnings">
          {projection.warnings.map((w, i) => (
            <div
              key={`${w.code}-${i}`}
              className={cn(
                'flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px]',
                isBlockingWarning(w)
                  ? 'bg-danger-muted text-danger'
                  : 'bg-warning-muted text-warning',
              )}
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{warningText(w)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
