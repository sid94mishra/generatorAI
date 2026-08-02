// ────────────────────────────────────────────────────────────────
// CodebasePicker — Select codebases from a project
// Built on the canonical SearchableSelect primitive.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { GitBranch } from 'lucide-react';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import { SearchableSelect } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';

interface CodebasePickerProps {
  projectId: string;
  value: string[];
  onChange: (codebaseIds: string[]) => void;
  multiple?: boolean;
  className?: string;
}

export function CodebasePicker({
  projectId,
  value,
  onChange,
  multiple = true,
  className = '',
}: CodebasePickerProps) {
  const { data: codebases, isLoading } = useProjectCodebases(projectId);

  if (!isLoading && (!codebases || codebases.length === 0)) {
    return (
      <p className="text-xs text-muted-foreground">
        No codebases linked to this project.
      </p>
    );
  }

  const toggleCodebase = (id: string) => {
    if (multiple) {
      if (value.includes(id)) {
        onChange(value.filter((v) => v !== id));
      } else {
        onChange([...value, id]);
      }
    } else {
      onChange(value.includes(id) ? [] : [id]);
    }
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <GitBranch className="h-3 w-3" />
        Codebases
      </label>
      <SearchableSelect
        items={codebases ?? []}
        value={value}
        onSelect={toggleCodebase}
        getKey={(cb) => cb.id}
        getLabel={(cb) => cb.alias}
        getSearchText={(cb) => cb.type}
        multiple={multiple}
        loading={isLoading}
        placeholder={multiple ? 'Select codebases…' : 'Select a codebase…'}
        searchPlaceholder="Search codebases…"
        emptyText="No codebases linked to this project."
        renderItem={(cb) => (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-medium text-foreground">{cb.alias}</span>
            <span className="text-muted-foreground">({cb.type})</span>
            {cb.status !== 'ready' && (
              <span className="rounded-full bg-warning-muted px-1.5 py-0.5 text-[9px] text-warning">
                {cb.status}
              </span>
            )}
          </span>
        )}
      />
    </div>
  );
}
