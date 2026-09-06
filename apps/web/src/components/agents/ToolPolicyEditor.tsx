// ────────────────────────────────────────────────────────────────
// ToolPolicyEditor — tri-state capability groups.
//
// Every group is `true` (force on) / `false` (force off) / `undefined`
// (inherit). This distinction is load-bearing: the resolver folds levels
// L0→L4 and a `false` at ANY level beats a `true` at a lower one, so an
// editor that collapsed the tri-state into a plain boolean would make
// "inherit" unrepresentable and silently pin every group at its current value.
//
// The switch therefore shows the RESOLVED value — so a row never contradicts
// the effective-capabilities summary — and the "inherited" pill carries the
// third state, instead of a segmented control that looked nothing like the
// skill and MCP rows above it.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { RotateCcw } from 'lucide-react';
import { AGENT_TOOL_GROUPS, DEFAULT_AGENT_TOOL_POLICY } from '@generatorai/shared';
import type { AgentToolPolicy } from '@generatorai/shared';
import { Badge, Button } from '@/components/ui/index.js';
import { Switch } from '@/components/ui/primitives/switch.js';
import { TOOL_GROUP_LABELS, TOOL_GROUP_HINTS } from '@/lib/agentCopy.js';
import { cn } from '@/lib/utils.js';

export interface ToolPolicyEditorProps {
  value: Partial<AgentToolPolicy>;
  onChange: (next: Partial<AgentToolPolicy>) => void;
  /** Effective value after resolution, used to explain what "inherit" means here. */
  effective?: AgentToolPolicy;
  /** Groups the caller pins regardless of input (orchestration for orchestrators). */
  lockedGroups?: Partial<Record<keyof AgentToolPolicy, { value: boolean; reason: string }>>;
  disabled?: boolean;
}

export function ToolPolicyEditor({
  value,
  onChange,
  effective,
  lockedGroups,
  disabled = false,
}: ToolPolicyEditorProps) {
  const setGroup = (group: keyof AgentToolPolicy, next: boolean | undefined) => {
    const draft: Partial<AgentToolPolicy> = { ...value };
    if (next === undefined) delete draft[group];
    else draft[group] = next;
    onChange(draft);
  };

  return (
    <div className="space-y-1" data-testid="tool-policy-editor">
      {AGENT_TOOL_GROUPS.map((group) => {
        const locked = lockedGroups?.[group];
        const explicit = locked ? locked.value : value[group];
        const isInherited = explicit === undefined;
        // Falling back to the platform default keeps the switch truthful before
        // the first preview resolves, instead of flashing every group to off.
        const resolved = explicit ?? effective?.[group] ?? DEFAULT_AGENT_TOOL_POLICY[group];

        return (
          <div
            key={group}
            data-testid={`tool-policy-${group}`}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs transition-all',
              resolved
                ? 'border border-primary/20 bg-primary/5'
                : 'border border-transparent opacity-70 hover:bg-subtle',
              (disabled || locked) && 'opacity-50',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">
                {TOOL_GROUP_LABELS[group]}
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                {locked ? locked.reason : TOOL_GROUP_HINTS[group]}
              </div>
            </div>

            {isInherited && (
              <Badge
                tone="neutral"
                size="sm"
                className="shrink-0 text-[9px]"
                title={`Not set on this agent — currently ${resolved ? 'on' : 'off'} from the platform default or the binding site.`}
              >
                inherited
              </Badge>
            )}
            {!isInherited && !locked && !disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setGroup(group, undefined)}
                title="Reset to inherited"
                aria-label={`Reset ${TOOL_GROUP_LABELS[group]} to inherited`}
                data-testid={`tool-policy-${group}-reset`}
                className="shrink-0"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            )}

            <Switch
              checked={resolved}
              disabled={disabled || !!locked}
              onCheckedChange={(next) => setGroup(group, next)}
              aria-label={TOOL_GROUP_LABELS[group]}
              data-testid={`tool-policy-${group}-switch`}
            />
          </div>
        );
      })}
    </div>
  );
}
