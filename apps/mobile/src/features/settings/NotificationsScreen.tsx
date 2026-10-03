// Settings › Notifications (MSetNotifications, MDF-114; `/settings/notifications`, this device): the OS permission
// first — not asked → "Turn on notifications"; denied → "Open Settings"; provisional (iOS quiet delivery) → "Allow
// prominent notifications"; on → a neutral status card (with the push registration's own problem when there is one).
// "Pause" holds run outcomes and chat replies for 1 h / 8 h / until 8:00 tomorrow (the server's `mutedUntil`;
// approvals still come). "Wake me for": the three per-device switches the app already applies (shown in the
// foreground, and the server mute when both outcome kinds are off) with each category's interruption level.
// "System notification settings" opens the OS page. Not rendered: per-category server opt-in, digest, quiet hours,
// per-project levels (MG-15 / MD-06).
import React, { useState } from 'react';
import { View } from 'react-native';

import { useAuth } from '../../services/auth/AuthProvider';
import { NOTIFY_PREF_KEYS, pauseKey, pauseUntil, readNotifyPrefs, type NotifyPrefs } from '../../services/notifications/notificationFilter';
import { useNotificationPermission } from '../../services/notifications/permission';
import { describePushStatus, usePushStatusStore } from '../../services/notifications/pushStatus';
import { prefs } from '../../services/storage/prefs';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { nativePlatform } from '../../ui/platform/geometry';
import { nouns } from '../../ui/platform/nouns';
import { Callout } from '../../ui/primitives/Callout';
import { PermissionState } from '../../ui/primitives/PermissionState';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { SettingsPage } from './components/SettingsPage';

const clock = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export default function NotificationsScreen(): React.ReactElement {
  const { serverId } = useAuth();
  const permission = useNotificationPermission();
  const pushStatus = usePushStatusStore((s) => s.status);
  const bump = usePushStatusStore((s) => s.bumpPreferences);
  const [values, setValues] = useState<NotifyPrefs>(() => readNotifyPrefs((k) => prefs.getString(k)));
  const [paused, setPaused] = useState<number>(() => (serverId ? prefs.getNumber(pauseKey(serverId), 0) : 0));
  const [now, setNow] = useState(() => Date.now());
  const ios = nativePlatform === 'ios';
  const device = nouns().device;
  const on = permission.status === 'granted' || permission.status === 'provisional';
  const pausedNow = paused > now;
  const problem = describePushStatus(pushStatus);

  const setSwitch = (key: keyof NotifyPrefs, next: boolean): void => {
    prefs.setString(NOTIFY_PREF_KEYS[key], next ? '1' : '0');
    setValues((v) => ({ ...v, [key]: next }));
    bump();
  };
  const setPause = (choice: string): void => {
    if (!serverId) return;
    const until = choice === 'off' ? 0 : pauseUntil(choice as '1h' | '8h' | 'tomorrow', new Date());
    if (until) prefs.setNumber(pauseKey(serverId), until);
    else prefs.delete(pauseKey(serverId));
    setPaused(until);
    setNow(Date.now());
    bump();
  };

  const categories: Array<{ key: keyof NotifyPrefs; icon: 'hand' | 'workflows' | 'chats'; title: string; subtitle: string }> = [
    { key: 'gates', icon: 'hand', title: 'Approvals and questions', subtitle: ios ? 'Time Sensitive · breaks through Focus' : 'High priority · pops on screen' },
    { key: 'runs', icon: 'workflows', title: 'Run outcomes', subtitle: 'A workflow run finishes or fails' },
    { key: 'chats', icon: 'chats', title: 'Chat replies', subtitle: 'A turn completes in a chat you started' },
  ];

  return (
    <SettingsPage title="Notifications" testID="settings-notifications-screen">
      <View className="px-4">
        {permission.status === null ? (
          <Skeleton preset="card" />
        ) : permission.status === 'undetermined' ? (
          <PermissionState kind="notifications" status="undetermined" onRequest={() => void permission.request()} testID="notifications-permission" />
        ) : permission.status === 'denied' ? (
          <PermissionState kind="notifications" status="denied" onOpenSettings={permission.openSettings} testID="notifications-permission" />
        ) : permission.status === 'unavailable' ? (
          <Callout tone="info" title="Notifications aren't available here" body="Install the app on a phone or tablet to get them." />
        ) : permission.status === 'provisional' ? (
          <Callout tone="info" title="Delivered quietly" body="Notifications go to the Notification Center without sound or a banner." action={{ label: 'Allow prominent notifications', onPress: () => void permission.request() }} testID="notifications-provisional" />
        ) : (
          <Callout tone="info" title="Notifications are on" body={`This ${device} is woken for the categories below.`} testID="notifications-on" />
        )}
        {on && problem && problem.tone !== 'success' ? (
          <View className="pt-3">
            <Callout tone={problem.tone === 'danger' ? 'err' : problem.tone === 'warning' ? 'warn' : 'info'} title={problem.title} body={problem.detail} />
          </View>
        ) : null}
      </View>

      <ListSection title="Pause" footer={pausedNow ? `Run outcomes and chat replies are held until ${clock.format(new Date(paused))}. Approvals still come through.` : 'Holds run outcomes and chat replies. Approvals still come through.'}>
        <ListRow
          kind="picker"
          title="Pause notifications"
          picker={{
            value: pausedNow ? 'paused' : 'off',
            options: [
              { value: 'off', label: 'Off' },
              ...(pausedNow ? [{ value: 'paused', label: `Until ${clock.format(new Date(paused))}` }] : []),
              { value: '1h', label: 'For 1 hour' },
              { value: '8h', label: 'For 8 hours' },
              { value: 'tomorrow', label: 'Until tomorrow' },
            ],
            onValueChange: (v) => v !== 'paused' && setPause(v),
            disabled: !on,
          }}
          testID="notifications-pause"
        />
      </ListSection>

      <ListSection title="Wake me for" footer={`Saved on this ${device} only. Approvals always reach a locked ${device}; switching them off only hides them while the app is open.`}>
        {categories.map((c) => (
          <ListRow key={c.key} kind="toggle" icon={c.icon} title={c.title} subtitle={c.subtitle} switchValue={values[c.key]} onValueChange={(v) => setSwitch(c.key, v)} disabled={!on} testID={`notifications-${c.key}`} />
        ))}
      </ListSection>

      <ListSection footer={ios ? 'Sounds, banners and the Lock Screen are set in iOS Settings.' : 'Each kind has its own channel: sound, pop-up and Lock Screen are set per channel in Android settings.'}>
        <ListRow kind="link" icon="settings" title="System notification settings" onPress={permission.openSettings} testID="notifications-system" />
      </ListSection>
    </SettingsPage>
  );
}
