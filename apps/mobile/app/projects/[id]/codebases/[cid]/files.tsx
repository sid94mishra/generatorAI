// ────────────────────────────────────────────────────────────────
// Codebase › Files — a read-only directory listing.
//
// `GET /projects/:id/codebases/:cid/files?path=` returns ONE level
// (.gitignore-filtered; a remote codebase is read from its bare clone via
// `git ls-tree`). Each directory is its own pushed screen, so the stack's
// back gesture walks up the tree and a deep link to `?path=src/app` works.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { File, Folder } from 'lucide-react-native';

import { projectKeys } from '../../../../../src/components/projects/api';
import { useProjectsApi } from '../../../../../src/components/projects/useProjectsApi';
import {
  breadcrumbs,
  formatBytes,
  normalizeRelPath,
  sortEntries,
} from '../../../../../src/components/projects/projectEditModel';
import { usePullRefresh } from '../../../../../src/components/runs/usePullRefresh';
import { ListGroup, ListRow } from '../../../../../src/components/ui/ListRow';
import { PlainScroll } from '../../../../../src/components/ui/Screen';
import { SkeletonList } from '../../../../../src/components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../../../../src/components/ui/States';
import { Touchable } from '../../../../../src/components/ui/Touchable';
import { useTheme } from '../../../../../src/theme/ThemeProvider';

export default function CodebaseFilesScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id: string; cid: string; path?: string }>();
  const projectId = String(params.id);
  const codebaseId = String(params.cid);
  const path = normalizeRelPath(typeof params.path === 'string' ? params.path : '');
  const api = useProjectsApi();
  const navigation = useNavigation();
  const { colors } = useTheme();

  const files = useQuery({
    queryKey: projectKeys.files(projectId, codebaseId, path),
    queryFn: () => api.files(projectId, codebaseId, path),
  });
  const { refreshing, onRefresh } = usePullRefresh(() => files.refetch());

  const crumbs = useMemo(() => breadcrumbs(path), [path]);
  const title = crumbs[crumbs.length - 1]!.label === 'Root' ? 'Files' : crumbs[crumbs.length - 1]!.label;
  React.useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const entries = useMemo(() => sortEntries(files.data ?? []), [files.data]);

  const openDir = (dir: string): void =>
    router.push({
      pathname: '/projects/[id]/codebases/[cid]/files',
      params: { id: projectId, cid: codebaseId, path: dir },
    } as never);

  return (
    <PlainScroll onRefresh={onRefresh} refreshing={refreshing}>
      {crumbs.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <View key={crumb.path} className="flex-row items-center">
                {i > 0 ? <Text className="px-1 text-sm text-muted-foreground">/</Text> : null}
                <Touchable
                  accessibilityLabel={last ? `${crumb.label}, current folder` : `Go to ${crumb.label}`}
                  disabled={last}
                  haptic="tap"
                  scale="none"
                  onPress={() =>
                    // Pops back to that level when it is on the stack, pushes otherwise.
                    router.dismissTo({
                      pathname: '/projects/[id]/codebases/[cid]/files',
                      params: { id: projectId, cid: codebaseId, path: crumb.path },
                    } as never)
                  }
                  className="min-h-11 justify-center px-1"
                >
                  <Text className={`text-sm ${last ? 'font-semibold text-foreground' : 'text-primary'}`}>{crumb.label}</Text>
                </Touchable>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {files.isLoading ? (
        <SkeletonList rows={6} />
      ) : files.isError ? (
        <ErrorState
          message={files.error instanceof Error ? files.error.message : 'Could not list this folder.'}
          onRetry={() => void files.refetch()}
        />
      ) : entries.length === 0 ? (
        <EmptyState title="Empty folder" icon={<Folder size={22} color={colors['muted-foreground']} />} />
      ) : (
        <ListGroup>
          {entries.map((entry) =>
            entry.type === 'directory' ? (
              <ListRow
                key={entry.path}
                title={entry.name}
                icon={<Folder size={18} color={colors['muted-foreground']} />}
                onPress={() => openDir(entry.path)}
              />
            ) : (
              <ListRow
                key={entry.path}
                title={entry.name}
                subtitle={formatBytes(entry.size)}
                icon={<File size={18} color={colors['muted-foreground']} />}
                onPress={() =>
                  router.push({
                    pathname: '/projects/[id]/codebases/[cid]/file',
                    params: { id: projectId, cid: codebaseId, path: entry.path },
                  } as never)
                }
              />
            ),
          )}
        </ListGroup>
      )}
    </PlainScroll>
  );
}
