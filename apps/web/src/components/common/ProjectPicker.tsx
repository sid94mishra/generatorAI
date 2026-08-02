// ────────────────────────────────────────────────────────────────
// ProjectPicker — Reusable project selector dropdown
// Built on the canonical SearchableSelect primitive.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { FolderKanban } from 'lucide-react';
import { useProjects } from '@/hooks/projectQueries.js';
import { SearchableSelect } from '@/components/ui/index.js';

interface ProjectPickerProps {
  value?: string;
  onChange: (projectId?: string) => void;
  required?: boolean;
  label?: string;
  className?: string;
}

export function ProjectPicker({
  value,
  onChange,
  required = false,
  label = 'Project',
  className = '',
}: ProjectPickerProps) {
  const { data: projects, isLoading } = useProjects();
  // Only active projects can be targeted for new chats / workflows / automations.
  const activeProjects = (projects ?? []).filter((p) => p.status === 'active');

  return (
    <div className={className}>
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FolderKanban className="h-3 w-3" />
        {label}
      </label>
      <SearchableSelect
        items={activeProjects}
        value={value ?? null}
        onSelect={(projectId) => onChange(projectId)}
        getKey={(p) => p.id}
        getLabel={(p) => p.name}
        placeholder={required ? 'Select a project…' : 'All Projects (Global)'}
        searchPlaceholder="Search projects…"
        emptyText="No projects found."
        loading={isLoading}
        clearable={!required}
        onClear={() => onChange(undefined)}
        className="mt-1"
      />
    </div>
  );
}
