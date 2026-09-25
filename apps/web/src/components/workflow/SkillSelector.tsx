// ────────────────────────────────────────────────────────────────
// SkillSelector — Enable/disable skills per stage
// Explicit stage additions (`session.agentOverrides.addSkillIds`), resolved
// and staged through AgentResolver.
// Includes Select All / Deselect All controls
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Wand2 } from 'lucide-react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useAvailableArtifacts } from '@/hooks/projectQueries.js';
import { cn } from '@/lib/utils.js';
import { Badge, Button } from '@/components/ui/index.js';
import type { AgentStage, SessionSpec } from '@generatorai/workflow-spec';
import { patchSession } from './sessionPatch.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';

interface SkillSelectorProps {
  stage: AgentStage;
  onUpdate: (updates: Partial<AgentStage>) => void;
}

export function SkillSelector({ stage, onUpdate }: SkillSelectorProps) {
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? null);
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

  const session = stage.session;

  // Stage additions are explicit. Merely listing a catalog entry must not
  // claim that its files have been staged into the provider's workspace.
  const selectedIds = useMemo(
    () => new Set(session?.agentOverrides?.addSkillIds ?? []),
    [session],
  );

  const updateSelected = (next: Set<string>) => {
    const selectedNames = new Set(allSkills.filter((skill) => next.has(skill.id)).map((skill) => skill.name));
    const overrides: NonNullable<SessionSpec['agentOverrides']> = { ...session?.agentOverrides };
    if (next.size > 0) overrides.addSkillIds = [...next];
    else delete overrides.addSkillIds;
    const removed = session?.agentOverrides?.removeSkillIds?.filter((id) => !next.has(id));
    if (removed?.length) overrides.removeSkillIds = removed;
    else delete overrides.removeSkillIds;
    const disabled = session?.skills?.disabled?.filter((name) => !selectedNames.has(name));
    const skills = session?.skills ? { ...session.skills, disabled: disabled?.length ? disabled : undefined } : undefined;
    if (skills && skills.disabled === undefined) delete skills.disabled;
    onUpdate(
      patchSession(stage, {
        agentOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        skills: skills && Object.keys(skills).length > 0 ? skills : undefined,
      }),
    );
  };

  const toggleSkill = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateSelected(next);
  };
  const selectAll = () => updateSelected(new Set(allSkills.map((skill) => skill.id)));
  const deselectAll = () => updateSelected(new Set());

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

  const enabledCount = allSkills.filter((skill) => selectedIds.has(skill.id)).length;
  const allEnabled = enabledCount === allSkills.length;
  const noneEnabled = enabledCount === 0;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Add skills to this stage. Skills selected by a bound agent are inherited separately.</p>
      {/* Count + Select/Deselect All */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {enabledCount}/{allSkills.length} added
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={selectAll}
            disabled={allEnabled}
            variant="ghost"
            size="sm"
            className="h-auto bg-transparent p-0 text-[10px] font-medium text-primary hover:bg-transparent hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Select all
          </Button>
          <span className="text-[10px] text-muted-foreground">·</span>
          <Button
            type="button"
            onClick={deselectAll}
            disabled={noneEnabled}
            variant="ghost"
            size="sm"
            className="h-auto bg-transparent p-0 text-[10px] font-medium text-muted-foreground hover:bg-transparent hover:text-foreground hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Deselect all
          </Button>
        </div>
      </div>

      {/* Skill list */}
      <div className={cn('space-y-1', allSkills.length > 8 && 'max-h-80 overflow-y-auto')}>
        {allSkills.map((skill) => {
          const isEnabled = selectedIds.has(skill.id);
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
              <Checkbox
                checked={isEnabled}
                onCheckedChange={() => toggleSkill(skill.id)}
                className="h-3.5 w-3.5"
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
