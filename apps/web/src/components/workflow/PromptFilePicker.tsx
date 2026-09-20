// ────────────────────────────────────────────────────────────────
// PromptFilePicker — Browse and attach prompt/skill files
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { FileText, Check } from 'lucide-react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useAvailableArtifacts } from '@/hooks/projectQueries.js';
import { cn } from '@/lib/utils.js';
import { Badge, Button } from '@/components/ui/index.js';
import type { PromptDefinition } from '@generatorai/shared';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';

interface PromptFilePickerProps {
  prompts: PromptDefinition[];
  onChange: (prompts: PromptDefinition[]) => void;
}

export function PromptFilePicker({ prompts, onChange }: PromptFilePickerProps) {
  const projectId = useWorkflowBuilderStore((s) => s.projectId);
  const { data: promptArtifacts, isLoading: promptsLoading } = useAvailableArtifacts(projectId ?? undefined, 'prompt');
  const { data: skillArtifacts, isLoading: skillsLoading } = useAvailableArtifacts(projectId ?? undefined, 'skill');

  const isLoading = promptsLoading || skillsLoading;
  const allArtifacts = [...(promptArtifacts ?? []), ...(skillArtifacts ?? [])];

  // Get currently attached file paths from all prompts
  const attachedFiles = new Set(prompts.flatMap((p) => p.attachments ?? []));

  const toggleFile = (filePath: string, artifactName: string) => {
    if (attachedFiles.has(filePath)) {
      // Remove from all prompt attachments
      const updated = prompts.map((p) => ({
        ...p,
        attachments: p.attachments?.filter((a) => a !== filePath),
      }));
      onChange(updated);
    } else {
      // Add to first prompt's attachments (or create a new prompt)
      if (prompts.length === 0) {
        onChange([
          {
            label: artifactName,
            text: '',
            waitForCompletion: true,
            attachments: [filePath],
          },
        ]);
      } else {
        const updated = [...prompts];
        const first = updated[0]!;
        updated[0] = {
          ...first,
          attachments: [...(first.attachments ?? []), filePath],
        };
        onChange(updated);
      }
    }
  };

  const selectAll = () => {
    const allPaths = allArtifacts.map((a) => a.filePath);
    if (prompts.length === 0) {
      onChange([{ label: 'Attached files', text: '', waitForCompletion: true, attachments: allPaths }]);
    } else {
      const updated = [...prompts];
      updated[0] = { ...updated[0]!, attachments: allPaths };
      onChange(updated);
    }
  };

  const deselectAll = () => {
    const updated = prompts.map((p) => ({ ...p, attachments: [] as string[] }));
    onChange(updated);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        Loading available files...
      </div>
    );
  }

  if (allArtifacts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <FileText className="mx-auto h-6 w-6 text-muted-foreground mb-1.5" />
        <p className="text-xs text-muted-foreground">
          No prompt files or skills available.
          {!projectId && ' Link a project to access its artifacts.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Count + Select/Deselect All */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {attachedFiles.size}/{allArtifacts.length} selected
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={selectAll}
            disabled={attachedFiles.size === allArtifacts.length}
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
            disabled={attachedFiles.size === 0}
            variant="ghost"
            size="sm"
            className="h-auto bg-transparent p-0 text-[10px] font-medium text-muted-foreground hover:bg-transparent hover:text-foreground hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Deselect all
          </Button>
        </div>
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {allArtifacts.map((artifact) => {
          const isAttached = attachedFiles.has(artifact.filePath);
          return (
            <label
              key={artifact.id}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-2 text-xs cursor-pointer transition-all',
                isAttached
                  ? 'bg-primary/5 border border-primary/30'
                  : 'border border-transparent hover:bg-subtle',
              )}
            >
              <Checkbox
                checked={isAttached}
                onCheckedChange={() => toggleFile(artifact.filePath, artifact.name)}
                className="h-3.5 w-3.5"
              />
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate">{artifact.name}</div>
                {artifact.description && (
                  <div className="text-[10px] text-muted-foreground truncate">{artifact.description}</div>
                )}
              </div>
              <Badge tone={artifact.source === 'system' ? 'info' : 'success'} size="sm" className="text-[9px]">
                {artifact.source}
              </Badge>
              {isAttached && <Check className="h-3.5 w-3.5 text-primary" />}
            </label>
          );
        })}
      </div>
    </div>
  );
}
