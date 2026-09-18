// ────────────────────────────────────────────────────────────────
// TemplatePickerSheet — start a new workflow from a built-in template.
//
// `GET /templates` lists them; tapping one instantiates it with
// `POST /workflow-definitions/import { templateId }` and opens the new
// workflow, where it can be run straight away. Authoring beyond that stays
// on the desktop.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { useAdminApi } from '../../api/useAdminApi';
import { SearchField } from '../ui/Form';
import { Sheet, SheetRow } from '../ui/Sheet';
import { SkeletonList } from '../ui/Skeleton';
import { EmptyState, ErrorState, Spinner } from '../ui/States';
import { haptics } from '../ui/haptics';
import { useTheme } from '../../theme/ThemeProvider';
import { filterTemplates, parseTemplates, templateSubtitle } from './templateModel';

export const TEMPLATES_QUERY_KEY = ['templates'] as const;

export function TemplatePickerSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.ReactElement {
  const admin = useAdminApi();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setError(null);
    }
  }, [visible]);

  const templates = useQuery({
    queryKey: TEMPLATES_QUERY_KEY,
    queryFn: async () => parseTemplates(await admin.templates.list()),
    enabled: visible,
    staleTime: 5 * 60_000,
  });

  const shown = useMemo(() => filterTemplates(templates.data ?? [], query), [templates.data, query]);

  const create = useMutation({
    mutationFn: (templateId: string) => admin.definitions.importTemplate(templateId),
    onSuccess: (definition) => {
      haptics.success();
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflows() });
      onClose();
      // Let the sheet's modal dismiss before the stack pushes (iOS drops a
      // push while a modal is still presented).
      setTimeout(() => router.push(`/workflows/${definition.id}`), 250);
    },
    onError: (err) => {
      haptics.error();
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  return (
    <Sheet visible={visible} onClose={onClose} title="New from template" detents={[0.7, 0.95]}>
      <View className="pb-6">
        {(templates.data?.length ?? 0) > 6 ? (
          <View className="px-4 pb-2">
            <SearchField value={query} onChangeText={setQuery} placeholder="Search templates" />
          </View>
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="assertive" className="px-4 pb-2 text-sm text-danger">
            {error}
          </Text>
        ) : null}
        {templates.isLoading ? (
          <SkeletonList rows={4} variant="flat" />
        ) : templates.isError ? (
          <ErrorState message="Could not load templates." onRetry={() => void templates.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState
            compact
            icon={<LayoutTemplate size={22} color={colors['muted-foreground']} />}
            title={query ? 'No matches' : 'No templates available'}
          />
        ) : (
          shown.map((t) => (
            <SheetRow
              key={t.id}
              title={t.name}
              subtitle={templateSubtitle(t)}
              disabled={create.isPending}
              right={create.isPending && create.variables === t.id ? <Spinner label="Creating" /> : null}
              onPress={() => {
                setError(null);
                create.mutate(t.id);
              }}
            />
          ))
        )}
      </View>
    </Sheet>
  );
}
