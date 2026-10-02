// Step detail (MChatStepDetail; `/chats/[id]/steps/[stepId]`, M6-02): one tool call of the chat, found by its call
// id among the persisted and live steps. Detail header (MD-18): breadcrumb Chats › <chat>, title the kind noun,
// "Step n of N" as the subtitle (MDF-50), ⋯ Copy command / Copy output / Share. "Open in terminal" (shell steps)
// asks for the step-up and opens the chat's pane at the Terminal tab (`?dock=terminal`).
import React, { useMemo } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';

import { StepDetailBody, StepDetailToolbar, stepDetailView } from '../../blocks/StepDetail';
import { chatHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { displayChatTitle } from '../../blocks/ChatRow';
import { chatToolCalls } from '../../blocks/TranscriptView';
import { requireStepUp } from '../../services/auth/stepUp';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { useChat, useChatMessages, useLiveChatBlocks } from './queries';

export default function StepDetailScreen(): React.ReactElement {
  const { id, stepId } = useLocalSearchParams<{ id: string; stepId: string }>();
  const chatId = id ?? '';
  const callId = stepId ?? '';
  const onBack = useHeaderBack();
  const chat = useChat(chatId);
  const messages = useChatMessages(chatId, 120);
  const { blocks, live } = useLiveChatBlocks(chat.data?.sessionId ?? chatId);
  const view = useMemo(() => stepDetailView(chatToolCalls(messages.data ?? [], blocks), callId, live), [messages.data, blocks, callId, live]);
  const crumbs = useBreadcrumb(useMemo(() => [{ label: 'Chats', href: '/chats' }, { label: displayChatTitle(chat.data?.name), href: chatHref(chatId) }], [chat.data?.name, chatId]));

  const header = (
    <Header
      role="detail"
      title={view?.noun ?? 'Step'}
      breadcrumb={crumbs}
      onBack={onBack}
      {...(view ? { subtitle: `Step ${view.index + 1} of ${view.total}` } : {})}
      actions={
        view
          ? [
              {
                id: 'step-more',
                icon: 'more',
                label: 'More',
                menu: [
                  { id: 'copy-input', label: view.shell ? 'Copy command' : 'Copy input', icon: 'copy' },
                  { id: 'copy-output', label: 'Copy output', icon: 'copy', disabled: !view.output },
                  { id: 'share', label: 'Share', icon: 'external-link' },
                ],
                onMenuSelect: (item) => {
                  if (item === 'copy-input') void Clipboard.setStringAsync(view.input);
                  else if (item === 'copy-output') void Clipboard.setStringAsync(view.output);
                  else void Share.share({ message: [view.input, view.output].filter(Boolean).join('\n\n') }).catch(() => undefined);
                },
              },
            ]
          : []
      }
    />
  );

  const openInTerminal = async (): Promise<void> => {
    if (!(await requireStepUp('Open the terminal'))) return;
    router.navigate({ pathname: '/chats/[id]', params: { id: chatId, dock: 'terminal' } });
  };

  return (
    <Screen
      header={header}
      state={messages.isLoading ? { kind: 'loading' } : view ? { kind: 'ready' } : { kind: 'empty', empty: <EmptyState icon="tool" title="Step not found" description="This step is no longer in the loaded transcript." action={{ label: 'Back to chat', onPress: onBack }} /> }}
      {...(view ? { bottomAccessory: <StepDetailToolbar view={view} onNavigate={(next) => router.setParams({ stepId: next })} onOpenInTerminal={() => void openInTerminal()} /> } : {})}
      testID="step-detail"
    >
      {view ? <StepDetailBody view={view} /> : null}
    </Screen>
  );
}
