// ────────────────────────────────────────────────────────────────
// B-27 EffectiveCapabilities (03-domain §2 B-27) — the resolved result of an
// agent (or a draft) plus its overrides: what the harness will ACTUALLY
// receive. The union algebra (agent ∪ binding-site additions, minus
// removals, tri-state tool folding) is not legible from the raw inputs
// alone, so every binding surface renders the resolved projection instead
// of making the reader simulate the fold. The payload is redacted
// server-side — MCP `env`/`headers` never reach here.
//
// 320px aside card: title "Effective capabilities" + an "Unsaved" tag while
// the draft differs from what was last resolved; Tools 2-column grid (on =
// fg, off = fg-3); Skills / MCP chip lists; a mono Runtime summary line;
// "No resolution warnings" or the warning list.
// ────────────────────────────────────────────────────────────────

import { AGENT_TOOL_GROUPS, type ResolvedAgentProjection } from '@generatorai/shared';
import { isBlockingWarning, TOOL_GROUP_LABELS, warningText } from '@/lib/agentCopy.js';
import { cn } from '@/ui/lib/cn.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { ChipList, Chip } from '@/ui/primitives/Chip/Chip.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

export interface EffectiveCapabilitiesProps {
  projection: ResolvedAgentProjection | undefined;
  isLoading?: boolean;
  error?: Error | null;
  /** The draft differs from the last resolved preview — shows the "Unsaved" tag. */
  dirty?: boolean;
  /** Counts contributed by the agent alone, to render "5 (3 from agent + 2 added)". */
  baseCounts?: { skills: number; mcpServers: number };
  className?: string;
  'data-testid'?: string;
}

function countLabel(total: number, base?: number): string {
  if (base === undefined || total < base) return String(total);
  const added = total - base;
  return added > 0 ? `${total} (${base} from agent + ${added} added)` : String(total);
}

/** The 320px aside card showing what the harness actually receives for this agent or draft. */
export function EffectiveCapabilities({
  projection,
  isLoading = false,
  error = null,
  dirty = false,
  baseCounts,
  className,
  'data-testid': testId,
}: EffectiveCapabilitiesProps) {
  return (
    <Card className={cn('w-aside shrink-0', className)} data-testid={testId}>
      <Card.Header
        title="Effective capabilities"
        meta={dirty ? <Badge tone="warn">Unsaved</Badge> : undefined}
      />
      {isLoading && !projection ? (
        <Card.Body className="flex-row items-center gap-2 text-small text-fg-3">
          <Spinner size={14} />
          Resolving…
        </Card.Body>
      ) : error ? (
        <Card.Body>
          <p className="font-mono text-small text-err">Could not resolve capabilities: {error.message}</p>
        </Card.Body>
      ) : !projection ? (
        <Card.Body>
          <p className="text-small text-fg-3">Capabilities appear here once the agent has a name.</p>
        </Card.Body>
      ) : (
        <EffectiveCapabilitiesBody projection={projection} baseCounts={baseCounts} />
      )}
    </Card>
  );
}

function EffectiveCapabilitiesBody({
  projection,
  baseCounts,
}: {
  projection: ResolvedAgentProjection;
  baseCounts?: { skills: number; mcpServers: number };
}) {
  const skillNames = projection.skills.names;
  const mcpNames = Object.keys(projection.mcpServers ?? {});
  const groups = projection.toolPolicy.groups;
  const runtimeParts = [
    projection.runtime.model,
    projection.runtime.reasoningEffort ? `effort ${projection.runtime.reasoningEffort}` : undefined,
    projection.runtime.permissionMode,
    projection.runtime.maxTurns !== undefined ? `max ${projection.runtime.maxTurns} turns` : undefined,
  ].filter((part): part is string => Boolean(part));

  return (
    <>
      <Card.Section padding="sm" className="border-t-0">
        <div className="text-small text-fg-3">Skills · {countLabel(skillNames.length, baseCounts?.skills)}</div>
        {skillNames.length === 0 ? (
          <p className="text-small text-fg-3">None</p>
        ) : (
          <ChipList data-testid="effective-skills">
            {skillNames.map((name) => (
              <Chip key={name} size="sm">
                {name}
              </Chip>
            ))}
          </ChipList>
        )}
      </Card.Section>

      <Card.Section padding="sm">
        <div className="text-small text-fg-3">MCP servers · {countLabel(mcpNames.length, baseCounts?.mcpServers)}</div>
        {mcpNames.length === 0 ? (
          <p className="text-small text-fg-3">None</p>
        ) : (
          <ChipList data-testid="effective-mcp">
            {mcpNames.map((name) => (
              <Chip key={name} size="sm">
                {name}
              </Chip>
            ))}
          </ChipList>
        )}
      </Card.Section>

      <Card.Section padding="sm">
        <div className="text-small text-fg-3">Capabilities</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {AGENT_TOOL_GROUPS.map((group) => (
            <div key={group} className={cn('flex items-center gap-1.5 truncate text-small', groups[group] ? 'text-fg' : 'text-fg-3')}>
              <Icon concept={groups[group] ? 'check' : 'x'} size={12} className="shrink-0" />
              {TOOL_GROUP_LABELS[group]}
            </div>
          ))}
        </div>
      </Card.Section>

      {runtimeParts.length > 0 ? (
        <Card.Section padding="sm">
          <div className="text-small text-fg-3">Runtime</div>
          <p className="truncate font-mono text-micro text-fg-2">{runtimeParts.join(' · ')}</p>
        </Card.Section>
      ) : null}

      {projection.team.length > 0 ? (
        <Card.Section padding="sm">
          <div className="text-small text-fg-3">Team · {projection.team.length}</div>
          <div className="flex flex-col gap-1">
            {projection.team.map((member) => (
              <div key={member.ref} className="truncate text-small text-fg">
                {member.name}
              </div>
            ))}
          </div>
        </Card.Section>
      ) : null}

      <Card.Section padding="sm" data-testid="effective-warnings">
        {projection.warnings.length === 0 ? (
          <p className="text-small text-fg-3">No resolution warnings.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {projection.warnings.map((w, i) => (
              <div
                key={`${w.code}-${i}`}
                className={cn('flex items-start gap-1.5 text-small', isBlockingWarning(w) ? 'text-err' : 'text-warn')}
              >
                <Icon concept="warning" size={12} className="mt-0.5 shrink-0" />
                {warningText(w)}
              </div>
            ))}
          </div>
        )}
      </Card.Section>
    </>
  );
}
