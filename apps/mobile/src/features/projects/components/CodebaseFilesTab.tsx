// Codebase › Files (MCodebaseFiles): the checkout's tree, one level loaded per expanded folder (directories first);
// a file opens a preview sheet (copy path, full screen, close) that escalates to the pushed file screen.
import React, { useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import type { FileEntryRecord } from '@generatorai/client-core';

import { FileContentView } from '../../../blocks/FilePreview';
import { codebaseFileHref } from '../../../blocks/shell/hrefs';
import { ListSection } from '../../../ui/layout/ListSection';
import { formatBytes } from '../../../ui/lib/format';
import { useSheet } from '../../../ui/native/Sheet';
import { Button } from '../../../ui/primitives/Button';
import { EmptyState } from '../../../ui/primitives/EmptyState';
import { ErrorState } from '../../../ui/primitives/ErrorState';
import { Icon } from '../../../ui/primitives/Icon';
import { Pressable } from '../../../ui/primitives/Pressable';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { Text } from '../../../ui/primitives/Text';
import { codebaseFileContent } from '../model/projectsModel';
import { useCodebaseFile, useCodebaseFiles } from '../queries';

type Href = Parameters<typeof router.push>[0];
const INDENT = 16;

function sortEntries(entries: readonly FileEntryRecord[]): FileEntryRecord[] {
  return [...entries].sort((a, b) => (a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)));
}

function PreviewBody({ projectId, codebaseId, path }: { projectId: string; codebaseId: string; path: string }): React.ReactElement {
  const file = useCodebaseFile(projectId, codebaseId, path);
  return (
    <View className="h-96">
      <FileContentView path={path} file={{ ...file, data: file.data ? codebaseFileContent(file.data.content) : undefined }} testID="codebase-file-preview" />
    </View>
  );
}

function Level({ projectId, codebaseId, path, depth, expanded, toggle, onFile }: { projectId: string; codebaseId: string; path: string; depth: number; expanded: ReadonlySet<string>; toggle: (p: string) => void; onFile: (e: FileEntryRecord) => void }): React.ReactElement | null {
  const files = useCodebaseFiles(projectId, codebaseId, path);
  if (files.isLoading) return <View className="px-4 py-2"><Skeleton preset="row" /></View>;
  if (files.isError) return <ErrorState title="Couldn't read this folder" error={files.error} onRetry={() => void files.refetch()} />;
  const entries = sortEntries(files.data ?? []);
  if (depth === 0 && entries.length === 0) return <EmptyState icon="files" title="Empty repository" description="There are no files in this checkout yet." />;
  return (
    <>
      {entries.map((entry) => {
        const dir = entry.type === 'directory';
        const open = expanded.has(entry.path);
        return (
          <View key={entry.path}>
            <Pressable
              onPress={() => (dir ? toggle(entry.path) : onFile(entry))}
              accessibilityRole="button"
              accessibilityLabel={`${entry.name}, ${dir ? (open ? 'folder, expanded' : 'folder') : 'file'}`}
              accessibilityState={dir ? { expanded: open } : undefined}
              className="min-h-row flex-row items-center gap-2 pe-4"
              style={{ paddingStart: 16 + depth * INDENT }}
              testID={`codebase-file-${entry.path}`}
            >
              {dir ? <Icon concept={open ? 'chevron-down' : 'chevron-right'} size={14} tone="fg-3" /> : <View className="w-3.5" />}
              <Icon concept={dir ? 'folder-open' : 'file'} size={16} tone="fg-2" />
              <Text role="mono" numberOfLines={1} className="flex-1">
                {entry.name}
              </Text>
              {!dir && entry.size !== undefined ? (
                <Text role="monoSm" tone="fg-3">
                  {formatBytes(entry.size)}
                </Text>
              ) : null}
            </Pressable>
            {dir && open ? <Level projectId={projectId} codebaseId={codebaseId} path={entry.path} depth={depth + 1} expanded={expanded} toggle={toggle} onFile={onFile} /> : null}
          </View>
        );
      })}
    </>
  );
}

export function CodebaseFilesTab({ projectId, codebaseId }: { projectId: string; codebaseId: string }): React.ReactElement {
  const sheet = useSheet();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (p: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const onFile = (entry: FileEntryRecord): void =>
    sheet.present(
      <View className="gap-3 pb-4">
        <View className="flex-row gap-2">
          <Button label="Copy path" icon="copy" size="sm" onPress={() => void Clipboard.setStringAsync(entry.path)} />
          <Button
            label="Full screen"
            icon="maximize"
            size="sm"
            onPress={() => {
              sheet.dismiss();
              router.push(codebaseFileHref(projectId, codebaseId, entry.path) as Href);
            }}
            testID="codebase-file-full"
          />
        </View>
        <PreviewBody projectId={projectId} codebaseId={codebaseId} path={entry.path} />
      </View>,
      { title: entry.name, subtitle: [entry.path.split('/').slice(0, -1).join('/'), entry.size !== undefined ? formatBytes(entry.size) : null].filter(Boolean).join(' · '), detents: ['medium', 'large'] },
    );
  return (
    <ListSection dividers="none">
      <View>
        <Level projectId={projectId} codebaseId={codebaseId} path="" depth={0} expanded={expanded} toggle={toggle} onFile={onFile} />
      </View>
    </ListSection>
  );
}
