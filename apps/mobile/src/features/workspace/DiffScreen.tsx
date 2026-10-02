// File diff (MPaneDiff; `/workspaces/[workspaceId]/diff?path=&alias=&base=&chat=`; 04 §2.3): pushed over the chat
// from the Changes tab (the pane stays docked beside it at ≥ 840). Detail header — breadcrumb "Changes › src › cart",
// the file name, ⋯ Copy path | Keep / Unkeep | Discard changes… — over MB-24 DiffView, and the footer
// "‹ Prev · File 1 of 2 · <next file> ›" through the same changed-file list the Changes tab shows.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';

import { changeRows, splitPath, useChangeActions } from '../../blocks/ChangesPanel';
import { DiffView, fileNeighbours, useReviewThreads } from '../../blocks/DiffView';
import { useChangesSummary } from '../../blocks/WorkspacePane';
import { Header } from '../../ui/native/router/Header';
import { confirm } from '../../ui/native/AlertDialog';
import { haptic } from '../../ui/platform/haptics';
import { useInsets } from '../../ui/platform/insets';
import { overflowIcon } from '../../ui/platform/overflow';
import { Button } from '../../ui/primitives/Button';
import { Text } from '../../ui/primitives/Text';

export default function DiffScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ workspaceId: string; path: string; alias?: string; base?: string; chat?: string }>();
  const workspaceId = params.workspaceId ?? '';
  const path = params.path ?? '';
  const alias = params.alias ?? '.';
  const base = params.base ?? 'baseline';
  const chatId = params.chat ?? null;
  const insets = useInsets();
  const summary = useChangesSummary(workspaceId, { base });
  const actions = useChangeActions(workspaceId);
  const review = useReviewThreads(workspaceId, chatId ? { scope: 'chat', scopeId: chatId } : null, { target: chatId ? { kind: 'chat', chatId } : null });
  const files = useMemo(() => changeRows(summary.data), [summary.data]);
  const id = `${alias}:${path}`;
  const entry = files.find((f) => f.id === id);
  const near = fileNeighbours(files, id);
  const repo = summary.data?.repos.find((r) => r.alias === alias);
  const revisions = { base: repo?.base?.id ?? summary.data?.base?.id ?? '', head: repo?.head?.id ?? summary.data?.head?.id ?? '' };
  const { dir, name } = splitPath(path);

  const back = (): void => {
    if (router.canGoBack()) router.back();
    else if (chatId) router.replace({ pathname: '/chats/[id]', params: { id: chatId, dock: 'changes' } });
    else router.replace('/' as never);
  };
  const crumbs = [
    { label: 'Changes', onPress: back },
    ...dir
      .split('/')
      .filter(Boolean)
      .map((segment) => ({ label: segment })),
  ];
  const go = (next: { path: string; alias: string } | null): void => {
    if (!next) return;
    haptic('selection');
    router.setParams({ path: next.path, alias: next.alias });
  };

  const menu = [
    { id: 'copy', label: 'Copy path', icon: 'copy' as const },
    ...(actions.canReview && entry ? [{ type: 'separator' as const }, entry.kept ? { id: 'unkeep', label: 'Unkeep', icon: 'undo' as const, testID: 'unkeep-file' } : { id: 'keep', label: 'Keep', icon: 'check' as const, testID: 'keep-file' }] : []),
    ...(actions.canRestore && entry ? [{ type: 'separator' as const }, { id: 'discard', label: 'Discard changes…', icon: 'undo' as const, destructive: true }] : []),
  ];
  const onMenu = (item: string): void => {
    if (item === 'copy') {
      void Clipboard.setStringAsync(path);
      haptic('success');
    } else if (item === 'keep' && entry) actions.keep(entry);
    else if (item === 'unkeep' && entry) actions.unkeep(entry);
    else if (item === 'discard' && entry) {
      void confirm({ title: `Discard changes to ${name}?`, message: 'The file goes back to where this comparison started. A snapshot is saved first.', confirmLabel: 'Discard', icon: 'undo' }).then((yes) => {
        if (!yes) return;
        actions.discard(entry);
        back();
      });
    }
  };

  return (
    <View className="flex-1 bg-surface" testID="diff-screen">
      <Header role="detail" title={name || path} breadcrumb={crumbs} onBack={back} actions={[{ id: 'diff-more', icon: overflowIcon, label: 'More', menu, onMenuSelect: onMenu }]} />
      <DiffView
        workspaceId={workspaceId}
        file={entry ?? { path, alias }}
        base={base}
        review={review}
        revisions={revisions}
      />
      {near.total > 1 ? (
        <View className="flex-row items-center gap-2 border-t border-line-soft px-4 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
          <Button label="Prev" icon="chevron-left" disabled={!near.prev} onPress={() => go(near.prev)} accessibilityLabel={near.prev ? `Previous file, ${near.prev.path}` : 'Previous file'} testID="diff-prev" />
          <Text role="footnote" tone="fg-3" align="center" className="flex-1">
            {`File ${near.index + 1} of ${near.total}`}
          </Text>
          <Button label={near.next ? splitPath(near.next.path).name : 'Next'} trailingIcon="chevron-right" disabled={!near.next} onPress={() => go(near.next)} accessibilityLabel={near.next ? `Next file, ${near.next.path}` : 'Next file'} testID="diff-next" />
        </View>
      ) : null}
    </View>
  );
}

