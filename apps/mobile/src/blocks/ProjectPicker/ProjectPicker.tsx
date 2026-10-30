// MB-44 ProjectPicker (MNewChatMore): the Where row's page — search, "No project", the projects with their codebase
// count, single choice (MD-49). Opened as a page inside the New chat sheet (MD-62).
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { ProjectSummary } from '@generatorai/client-core';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { SearchInput } from '../../ui/primitives/SearchInput';

export interface ProjectPickerProps {
  projects: readonly ProjectSummary[];
  value: string | null;
  onValueChange: (projectId: string | null) => void;
}

export function codebaseCount(project: Pick<ProjectSummary, 'summary'>): string | null {
  const n = project.summary?.codebases;
  return typeof n === 'number' ? `${n} codebase${n === 1 ? '' : 's'}` : null;
}

export function ProjectPicker({ projects, value, onValueChange }: ProjectPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [projects, query]);
  return (
    <View className="gap-3">
      {projects.length > 8 ? <SearchInput value={query} onChangeText={setQuery} placeholder="Search projects" size="compact" /> : null}
      <ListSection>
        <ListRow kind="radio" title="No project" selected={value === null} onPress={() => onValueChange(null)} testID="project-none" />
        {list.map((p) => (
          <ListRow key={p.id} kind="radio" title={p.name} mono {...(codebaseCount(p) ? { value: codebaseCount(p)! } : {})} selected={value === p.id} onPress={() => onValueChange(p.id)} testID={`project-row-${p.id}`} />
        ))}
      </ListSection>
      {list.length === 0 && query ? <EmptyState compact copyKey="searchResults" /> : null}
    </View>
  );
}
