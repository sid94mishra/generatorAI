import React, { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { ensureAndroidChannels, ensureNotificationCategories } from '../notifications/push';
import { APPROVAL_CATEGORY_ID, APPROVAL_CHANNEL_ID } from '../notifications/notificationCategories';
import { Screen } from '../components/ui/Screen';
import { ListRow } from '../components/ui/ListRow';

export default function NotifyRoute(): React.ReactElement {
  return __DEV__ ? <ApprovalNotification /> : <Redirect href="/" />;
}

function ApprovalNotification(): React.ReactElement {
  const params = useLocalSearchParams<{ case?: string; chat?: string; interaction?: string }>();
  const [status, setStatus] = useState('Preparing notification');
  useEffect(() => {
    let cancelled = false;
    const schedule = async () => {
      const { chat, interaction } = params;
      const safeId = /^[A-Za-z0-9._~-]{1,128}$/;
      if (params.case !== 'setup' && (params.case !== 'approval' || !chat || !interaction || !safeId.test(chat) || !safeId.test(interaction))) {
        throw new Error('Approval requires a real chat and interaction from the sandbox');
      }
      await ensureAndroidChannels();
      await ensureNotificationCategories();
      let permission = await Notifications.getPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) throw new Error('Notification permission is not granted');
      if (cancelled) return;
      if (params.case === 'setup') {
        setStatus('Notifications ready');
        return;
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Mobile approval check', body: 'Run pnpm test', sound: 'default',
          categoryIdentifier: APPROVAL_CATEGORY_ID,
          data: {
            route: `/chats/${chat}/gate/${interaction}`, category: 'approval', threadId: `chat:${chat}`,
            chatId: chat, interactionId: interaction, kind: 'permission', actions: ['approve', 'deny'],
          },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2, channelId: APPROVAL_CHANNEL_ID },
      });
      if (!cancelled) setStatus('Notification scheduled');
    };
    void schedule().catch((error: unknown) => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : 'Notification failed');
    });
    return () => { cancelled = true; };
  }, [params.case, params.chat, params.interaction]);
  return <Screen title="Notification check" back><ListRow title={status} /></Screen>;
}
