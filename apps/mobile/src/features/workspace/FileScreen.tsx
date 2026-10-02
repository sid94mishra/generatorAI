// File preview (MPaneFilePreview; `/workspaces/[workspaceId]/file?path=&alias=&chat=`): pushed over the chat from the
// Files tab. Detail header — breadcrumb "Files › <mount> › <dir>", the file name, Copy path and ⋯ Share — over
// MB-26 FilePreview, and the bottom toolbar: "View diff" when the file changed, "Mention in chat" (the screen's
// primary) when a chat owns the workspace.
import React, { useMemo } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';

import { changeRows, splitPath } from '../../blocks/ChangesPanel';
import { requestMention } from '../../blocks/Composer/model/mentionBus';
import { FilePreview } from '../../blocks/FilePreview';
import { useWorkspaceFile } from '../../blocks/FileTree';
import { workspaceDiffHref } from '../../blocks/shell/hrefs';
import { useChangesSummary } from '../../blocks/WorkspacePane';
import { BottomToolbar } from '../../ui/layout/BottomToolbar';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { haptic } from '../../ui/platform/haptics';
import { overflowIcon } from '../../ui/platform/overflow';
import { toast } from '../../ui/primitives/Toast';

export default function FileScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ workspaceId: string; path: string; alias?: string; chat?: string }>();
  const workspaceId = params.workspaceId ?? '';
  const path = params.path ?? '';
  const alias = params.alias ?? '.';
  const chatId = params.chat ?? null;
  const summary = useChangesSummary(workspaceId);
  const read = useWorkspaceFile(workspaceId);
  const change = useMemo(() => changeRows(summary.data).find((r) => r.alias === alias && r.path === path) ?? null, [summary.data, alias, path]);
  const { dir, name } = splitPath(path);

  const back = (): void => {
    if (router.canGoBack()) router.back();
    else if (chatId) router.replace({ pathname: '/chats/[id]', params: { id: chatId, dock: 'files' } });
    else router.replace('/' as never);
  };
  const crumbs = [{ label: 'Files', onPress: back }, ...(alias !== '.' ? [{ label: alias }] : []), ...dir.split('/').filter(Boolean).map((label) => ({ label }))];
  const copyPath = (): void => {
    void Clipboard.setStringAsync(path);
    haptic('success');
  };
  const share = async (): Promise<void> => {
    try {
      const file = await read(alias, path);
      if (file.contents === null) {
        toast({ kind: 'error', message: 'This file is binary or too large to share from here.' });
        return;
      }
      await Share.share({ message: file.contents, title: name });
    } catch {
      toast({ kind: 'error', message: "Couldn't share that file." });
    }
  };

  const header = (
    <Header
      role="detail"
      title={name || path}
      breadcrumb={crumbs}
      onBack={back}
      actions={[
        { id: 'file-copy', icon: 'copy', label: 'Copy path', onPress: copyPath },
        { id: 'file-more', icon: overflowIcon, label: 'More', menu: [{ id: 'share', label: 'Share', icon: 'upload' }], onMenuSelect: () => void share() },
      ]}
    />
  );
  const toolbar =
    change || chatId ? (
      <BottomToolbar
        {...(change ? { actions: [{ label: 'View diff', icon: 'diff' as const, onPress: () => router.push(workspaceDiffHref(workspaceId, { path, alias, chat: chatId }) as never) }] } : {})}
        {...(chatId
          ? {
              primary: {
                label: 'Mention in chat',
                icon: 'mention' as const,
                onPress: () => {
                  requestMention(chatId, alias !== '.' ? `${alias}/${path}` : path);
                  back();
                },
                testID: 'file-mention',
              },
            }
          : {})}
      />
    ) : undefined;

  return (
    <Screen header={header} scroll="none" {...(toolbar ? { bottomAccessory: toolbar } : {})} testID="file-screen">
      <FilePreview workspaceId={workspaceId} path={path} alias={alias} change={change ? { status: change.status, ...(change.oldBlob ? { oldBlob: change.oldBlob } : {}), ...(change.newBlob ? { newBlob: change.newBlob } : {}) } : null} />
    </Screen>
  );
}
