// ────────────────────────────────────────────────────────────────
// SkillSelector — Enable/disable skills per stage
// All skills enabled by default; uses disabledSkills in harnessConfigOverrides
// Includes Select All / Deselect All controls
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Wand2 } from 'lucide-react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useAvailableArtifacts } from '@/hooks/projectQueries.js';
import { cn } from '@/lib/utils.js';
import { Badge } from '@/components/ui/index.js';
import type { StageDefinition, HarnessConfig } from '@generatorai/shared';

interface SkillSelectorProps {
  stage: StageDefinition;
  onUpdate: (updates: Partial<StageDefinition>) => void;
}

export function SkillSelector({ stage, onUpdate }: SkillSelectorProps) {
  const projectId = useWorkflowBuilderStore((s) => s.projectId);
  const { data: systemSkills, isLoading: systemLoading } = useAvailableArtifacts(undefined, 'skill');
  const { data: projectSkills, isLoading: projectLoading } = useAvailableArtifacts(
    projectId ?? undefined,
    'skill',
  );

  const isLoading = systemLoading || projectLoading;

  // Merge system and project skills, de-duplicating by NAME.
  //
  // `disabledSkills` is a list of skill NAMES on the wire (that is what the
  // Copilot SDK's `disabledSkills` field takes), so de-duplicating by `id`
  // left two rows sharing one name: toggling either appeared to toggle both,
  // and "deselect all" produced duplicate entries. A project skill shadows the
  // system skill of the same name, matching server-side precedence.
  const allSkills = useMemo(() => {
    const byName = new Map<string, { id: string; name: string; description?: string; source: string }>();
    for (const s of [...(systemSkills ?? []), ...(projectSkills ?? [])]) {
      byName.set(s.name, s);
    }
    return [...byName.values()];
  }, [systemSkills, projectSkills]);

  const currentOverrides = stage.harnessConfigOverrides as Partial<HarnessConfig> | undefined;

  // Disabled set — by default empty (all skills on)
  const disabledSkills = useMemo(
    () => new Set(currentOverrides?.disabledSkills ?? []),
    [currentOverrides],
  );

  const updateDisabled = (newSet: Set<string>) => {
    const arr = [...newSet];
    onUpdate({
      harnessConfigOverrides: {
        ...currentOverrides,
        disabledSkills: arr.length > 0 ? arr : undefined,
      } as Partial<HarnessConfig>,
    });
  };

  const toggleSkill = (name: string) => {
    const next = new Set(disabledSkills);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    updateDisabled(next);
  };

  const selectAll = () => updateDisabled(new Set());
  const deselectAll = () => updateDisabled(new Set(allSkills.map((s) => s.name)));

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        Loading skills...
      </div>
    );
  }

  if (allSkills.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <Wand2 className="mx-auto h-6 w-6 text-muted-foreground mb-1.5" />
        <p className="text-xs text-muted-foreground">
          No skills available.
          {!projectId && ' Link a project to access its skills.'}
        </p>
      </div>
    );
  }

  const enabledCount = allSkills.length - disabledSkills.size;
  const allEnabled = disabledSkills.size === 0;
  const noneEnabled = disabledSkills.size === allSkills.length;

  return (
    <div className="space-y-2">
      {/* Count + Select/Deselect All */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {enabledCount}/{allSkills.length} enabled
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

      {/* Skill list */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {allSkills.map((skill) => {
          const isEnabled = !disabledSkills.has(skill.name);
          return (
            <label
              key={skill.name}
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
                onChange={() => toggleSkill(skill.name)}
                className="h-3.5 w-3.5 rounded"
              />
              <Wand2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate">{skill.name}</div>
                {skill.description && (
                  <div className="text-[10px] text-muted-foreground truncate">
                    {skill.description}
                  </div>
                )}
              </div>
              <Badge tone={skill.source === 'system' ? 'info' : 'success'} size="sm" className="text-[9px]">
                {skill.source}
              </Badge>
            </label>
          );
        })}
      </div>
    </div>
  );
}
