// ────────────────────────────────────────────────────────────────
// ArtifactPicker — Select skills/prompts/agents with source badges
// Built on the canonical SearchableSelect primitive.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { useAvailableArtifacts, useSystemArtifacts } from '@/hooks/projectQueries.js';
import { useCatalogPrefsStore } from '@/stores/catalogPrefsStore.js';
import { SourceBadge } from '@/components/common/SourceBadge.js';
import { SearchableSelect } from '@/components/ui/index.js';
import type { ArtifactType } from '@generatorai/shared';

interface ArtifactPickerProps {
  projectId?: string;
  type: ArtifactType;
  selected: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  className?: string;
}

export function ArtifactPicker({
  projectId,
  type,
  selected,
  onChange,
  multiple = true,
  className = '',
}: ArtifactPickerProps) {
  // Both hooks run every render — calling them conditionally changes React's
  // hook order the moment `projectId` appears or disappears, which corrupts
  // hook state. `useAvailableArtifacts` is already internally gated on
  // `projectId`, so the idle one simply never fetches.
  const merged = useAvailableArtifacts(projectId, type);
  const systemOnly = useSystemArtifacts(type);
  const { data: availableArtifacts, isLoading } = projectId ? merged : systemOnly;

  // Skills the user disabled in Settings → Skills are hidden here so they
  // can't be attached to a chat/stage/workflow (kept if already selected so
  // an existing config isn't silently mutated).
  const disabledSkills = useCatalogPrefsStore((s) => s.disabledSkills);

  // System artifacts first, then project artifacts — preserves the
  // ordering of the previous sectioned layout.
  const artifacts = availableArtifacts ?? [];
  const visible = type === 'skill'
    ? artifacts.filter((a) => !disabledSkills.includes(a.id) || selected.includes(a.id))
    : artifacts;
  const orderedArtifacts = [
    ...visible.filter((a) => a.source === 'system'),
    ...visible.filter((a) => a.source === 'project'),
  ];

  const toggleArtifact = (id: string) => {
    if (multiple) {
      if (selected.includes(id)) {
        onChange(selected.filter((s) => s !== id));
      } else {
        onChange([...selected, id]);
      }
    } else {
      onChange(selected.includes(id) ? [] : [id]);
    }
  };

  return (
    <SearchableSelect
      items={orderedArtifacts}
      value={selected}
      onSelect={toggleArtifact}
      getKey={(a) => a.id}
      getLabel={(a) => a.name}
      multiple={multiple}
      loading={isLoading}
      placeholder={multiple ? `Select ${type}s…` : `Select a ${type}…`}
      searchPlaceholder={`Search ${type}s...`}
      emptyText={`No ${type}s available`}
      className={className}
      renderItem={(artifact) => (
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium text-foreground">{artifact.name}</span>
            <SourceBadge source={artifact.source} />
          </span>
          {artifact.description && (
            <span className="mt-0.5 block truncate text-muted-foreground">
              {artifact.description}
            </span>
          )}
        </span>
      )}
    />
  );
}
