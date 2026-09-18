// ────────────────────────────────────────────────────────────────
// Settings › Notifications.
//
// The value of this app on a phone is being told when something needs you.
// That only works if the OS permission is granted, so this screen makes the
// permission state legible and offers the one action that can fix it.
//
// The per-category switches are stored locally rather than server-side: they
// describe what THIS device wants to be woken for, and a second phone should
// be able to want something different.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import { BellOff, BellRing, CircleHelp, MessageSquare, Workflow } from 'lucide-react-native';

import { prefs } from '../../src/storage/prefs';
import { describePushStatus, usePushStatusStore } from '../../src/notifications/pushStatus';
import { Card, SectionHeader } from '../../src/components/ui/primitives';
import { Button } from '../../src/components/ui/Button';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { Screen } from '../../src/components/ui/Screen';
import { useTheme } from '../../src/theme/ThemeProvider';

const CATEGORIES = [
  {
    key: 'notify.gates',
    title: 'Approvals and questions',
    help: 'When an agent is blocked waiting on your decision.',
    Icon: CircleHelp,
    defaultOn: true,
  },
  {
    key: 'notify.runs',
    title: 'Run outcomes',
    help: 'When a workflow run finishes or fails.',
    Icon: Workflow,
    defaultOn: true,
  },
  {
    key: 'notify.chats',
    title: 'Chat replies',
    help: 'When a turn completes in a chat you started.',
    Icon: MessageSquare,
    defaultOn: false,
  },
] as const;

function read(key: string, fallback: boolean): boolean {
  const stored = prefs.getString(key);
  return stored === null || stored === undefined ? fallback : stored === '1';
}

export default function NotificationsScreen(): React.ReactElement {
  const { colors } = useTheme();
  const [permission, setPermission] = useState<Notifications.PermissionStatus | null>(null);
  const [values, setValues] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CATEGORIES.map((c) => [c.key, read(c.key, c.defaultOn)])),
  );
  // Why push is or is not working — the hook used to bail silently, so a
  // build without an EAS project id was indistinguishable from a quiet one.
  const pushStatus = usePushStatusStore((s) => s.status);
  const bumpPreferences = usePushStatusStore((s) => s.bumpPreferences);
  const pushExplanation = describePushStatus(pushStatus);

  const refresh = useCallback(async () => {
    try {
      const result = await Notifications.getPermissionsAsync();
      setPermission(result.status);
    } catch {
      // Web and some dev builds have no notification module at all.
      setPermission(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const granted = permission === 'granted';

  const request = useCallback(async () => {
    try {
      const result = await Notifications.requestPermissionsAsync();
      setPermission(result.status);
      // Once denied, the OS will not ask again — the only route left is the
      // system settings app, so send them there rather than a dead button.
      if (result.status === 'denied') void Linking.openSettings();
    } catch {
      void Linking.openSettings();
    }
  }, []);

  return (
    <Screen title="Notifications" back>
      <Card className="gap-3 p-4">
        <ListRow
          title={granted ? 'Notifications are on' : 'Notifications are off'}
          subtitle={
            granted
              ? 'This device will be woken for the categories below.'
              : 'Without this, you will only see blocked work when you open the app.'
          }
          icon={
            granted ? (
              <BellRing size={18} color={colors.success} />
            ) : (
              <BellOff size={18} color={colors['muted-foreground']} />
            )
          }
          chevron={false}
        />
        {!granted ? (
          <Button
            label={permission === 'denied' ? 'Open system settings' : 'Allow notifications'}
            variant="secondary"
            size="sm"
            onPress={() => void request()}
          />
        ) : null}
      </Card>

      {pushExplanation && pushExplanation.tone !== 'success' ? (
        <Card
          className={`gap-1 p-4 ${
            pushExplanation.tone === 'danger'
              ? 'border-danger bg-danger-muted'
              : pushExplanation.tone === 'warning'
                ? 'border-warning bg-warning-muted'
                : ''
          }`}
        >
          <Text className="text-sm font-medium text-foreground">{pushExplanation.title}</Text>
          <Text className="text-xs leading-relaxed text-muted-foreground">
            {pushExplanation.detail}
          </Text>
        </Card>
      ) : null}

      <SectionHeader title="Wake me for" />
      <ListGroup>
        {CATEGORIES.map(({ key, title, help, Icon }) => (
          <ListRow
            key={key}
            title={title}
            subtitle={help}
            icon={<Icon size={18} color={colors['muted-foreground']} />}
            chevron={false}
            disabled={!granted}
            // `toggle`, not a <Switch> in `trailing`: the row then IS the
            // switch — one accessibility element that announces its label,
            // its help text and its on/off state. As a trailing sibling the
            // row announced as a button and the state was not exposed at all.
            toggle={{
              value: values[key] ?? false,
              onValueChange: (next) => {
                prefs.setString(key, next ? '1' : '0');
                setValues((prev) => ({ ...prev, [key]: next }));
                // Re-syncs the server-side mute (see notificationFilter.ts);
                // the foreground filter reads prefs directly on each push.
                bumpPreferences();
              },
            }}
          />
        ))}
      </ListGroup>

      <Text className="pt-2 text-xs leading-relaxed text-muted-foreground">
        These preferences apply to this device only. While the app is open, a switched-off
        category is not shown. In the background, run outcomes and chat replies are muted on the
        server only when both are off; approvals are always delivered.
        {Platform.OS === 'web'
          ? ' Web previews do not receive push notifications; install the app to test them.'
          : ''}
      </Text>
    </Screen>
  );
}
