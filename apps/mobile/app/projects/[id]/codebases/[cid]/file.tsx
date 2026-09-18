// ────────────────────────────────────────────────────────────────
// Codebase › File — read-only contents of one file.
//
// `GET /projects/:id/codebases/:cid/files/content?path=` answers
// `{ content }` as UTF-8 text. Binary files and very large ones are handled
// by `filePreview` rather than laid out as megabytes of `Text`. Long lines
// scroll horizontally instead of wrapping, so code keeps its shape.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Copy, FileWarning } from 'lucide-react-native';

import { projectKeys } from '../../../../../src/components/projects/api';
import { useProjectsApi } from '../../../../../src/components/projects/useProjectsApi';
import { filePreview, normalizeRelPath } from '../../../../../src/components/projects/projectEditModel';
import { usePullRefresh } from '../../../../../src/components/runs/usePullRefresh';
import { IconButton } from '../../../../../src/components/ui/Button';
import { SkeletonList } from '../../../../../src/components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../../../../src/components/ui/States';
import { useToast } from '../../../../../src/components/ui/Toast';
import { useTheme } from '../../../../../src/theme/ThemeProvider';

export default function CodebaseFileScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id: string; cid: string; path?: string }>();
  const projectId = String(params.id);
  const codebaseId = String(params.cid);
  const path = normalizeRelPath(typeof params.path === 'string' ? params.path : '');
  const api = useProjectsApi();
  const navigation = useNavigation();
  const toast = useToast();
  const { colors } = useTheme();

  const file = useQuery({
    queryKey: projectKeys.fileContent(projectId, codebaseId, path),
    queryFn: () => api.fileContent(projectId, codebaseId, path),
    enabled: path.length > 0,
  });
  const { refreshing, onRefresh } = usePullRefresh(() => file.refetch());
  const preview = useMemo(() => filePreview(file.data?.content), [file.data?.content]);
  const name = path.split('/').pop() || 'File';

  const canCopy = preview.kind === 'text';
  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: name,
      headerRight: () =>
        canCopy ? (
          <IconButton
            accessibilityLabel="Copy file contents"
            icon={<Copy size={18} color={colors.foreground} />}
            onPress={() =>
              void Clipboard.setStringAsync(file.data?.content ?? '').then(() =>
                toast({ message: 'Copied.', variant: 'success' }),
              )
            }
          />
        ) : null,
    });
  }, [navigation, name, canCopy, colors.foreground, file.data?.content, toast]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors['muted-foreground']} />
      }
    >
      <Text selectable numberOfLines={2} className="font-mono text-sm text-muted-foreground">
        {path}
      </Text>
      {!path ? (
        <ErrorState title="No file selected" />
      ) : file.isLoading ? (
        <SkeletonList rows={8} />
      ) : file.isError ? (
        <ErrorState
          message={file.error instanceof Error ? file.error.message : 'Could not read this file.'}
          onRetry={() => void file.refetch()}
        />
      ) : preview.kind === 'empty' ? (
        <EmptyState title="Empty file" />
      ) : preview.kind === 'binary' ? (
        <EmptyState
          title="Binary file"
          message="This file is not text, so it cannot be shown here."
          icon={<FileWarning size={22} color={colors['muted-foreground']} />}
        />
      ) : (
        <>
          <View className="overflow-hidden rounded-2xl border border-border-muted bg-subtle">
            <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
              <Text selectable className="font-mono text-sm leading-relaxed text-foreground">
                {preview.text}
              </Text>
            </ScrollView>
          </View>
          <Text className="text-sm text-muted-foreground">
            {preview.truncated
              ? `Showing the first ${preview.lines.toLocaleString()} lines. Open the file on your computer for the rest.`
              : `${preview.lines.toLocaleString()} line${preview.lines === 1 ? '' : 's'}`}
          </Text>
        </>
      )}
    </ScrollView>
  );
}
