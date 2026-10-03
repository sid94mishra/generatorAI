// `generatorai:///notify?case=<case>&chat=…&interaction=…&workflow=…&run=…&stage=…` (dev builds only; 08 §6
// notification smoke, M9-02): schedules the fixture of a notification category as a local notification on the active
// server, two seconds out, with its category and channel — so the actions (Allow once, Reply, Review…) can be
// pressed against a real sandbox gate. `case=setup` only prepares channels, categories and the permission.
import React, { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { NOTIFICATION_CATEGORIES } from '@generatorai/shared/ui-contract';

import { useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { useAuth } from '../../services/auth/AuthProvider';
import { ensureAndroidChannels, ensureNotificationCategories } from '../../services/notifications/push';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { isPushCase, PUSH_CASES, pushFixture } from './pushFixtures';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export default function NotifyScreen(): React.ReactElement {
  return __DEV__ ? <NotificationCheck /> : <Redirect href="/" />;
}

function NotificationCheck(): React.ReactElement {
  const params = useLocalSearchParams<{ case?: string; chat?: string; interaction?: string; workflow?: string; run?: string; stage?: string }>();
  const { serverId } = useAuth();
  const onBack = useHeaderBack();
  const [status, setStatus] = useState('Preparing notification');

  useEffect(() => {
    let cancelled = false;
    const schedule = async (): Promise<void> => {
      const kind = params.case;
      if (kind !== 'setup' && !isPushCase(kind)) throw new Error(`Unknown case. Use setup or ${PUSH_CASES.join(', ')}`);
      await ensureAndroidChannels();
      await ensureNotificationCategories();
      let permission = await Notifications.getPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) throw new Error('Notification permission is not granted');
      if (cancelled) return;
      if (kind === 'setup') {
        setStatus('Notifications ready');
        return;
      }
      const ids = {
        server: serverId ?? '',
        chat: params.chat ?? 'fixture-chat',
        interaction: params.interaction ?? 'fixture-gate',
        workflow: params.workflow ?? 'fixture-workflow',
        run: params.run ?? 'fixture-run',
        stage: params.stage ?? 'fixture-stage',
      };
      if (!Object.values(ids).every((id) => SAFE_ID.test(id))) throw new Error('Ids must be sandbox ids and a server must be active');
      const fixture = pushFixture(kind, ids);
      const def = NOTIFICATION_CATEGORIES[fixture.categoryId];
      await Notifications.scheduleNotificationAsync({
        content: {
          title: fixture.title,
          body: fixture.body,
          data: fixture.data,
          categoryIdentifier: fixture.categoryId,
          interruptionLevel: def.interruption,
          ...(def.interruption === 'passive' ? {} : { sound: 'default' }),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2, channelId: def.channel },
      });
      if (!cancelled) setStatus('Notification scheduled');
    };
    void schedule().catch((error: unknown) => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : 'Notification failed');
    });
    return () => {
      cancelled = true;
    };
  }, [params.case, params.chat, params.interaction, params.workflow, params.run, params.stage, serverId]);

  return (
    <Screen header={<Header role="detail" title="Notification check" onBack={onBack} />} background="grouped" testID="dev-notify-screen">
      <ListSection title={params.case ?? 'No case'} footer={`Cases: setup, ${PUSH_CASES.join(', ')}`}>
        <ListRow kind="info" title={status} testID="dev-notify-status" />
      </ListSection>
    </Screen>
  );
}
