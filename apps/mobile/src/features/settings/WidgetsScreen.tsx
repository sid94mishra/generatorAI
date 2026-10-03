// Settings › Widgets & Live Activities (iOS) / Live Updates (Android) (MSetWidgets, MDF-116; `/settings/widgets`, this
// device). The surfaces themselves land with M9 (Live Activity / Live Update, widgets, the New chat control / tile);
// this page already holds the per-device choices they will read — which runs and chats get a live surface — and says
// how approvals behave from the Lock Screen (MD-31). Not rendered until those surfaces exist (MD-27): the preview
// (sample data), the iOS authorization state, widget placement counts, the refresh row, "Add tile".
import React, { useState } from 'react';
import { View } from 'react-native';

import { PREF_KEYS, prefs } from '../../services/storage/prefs';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { nativePlatform } from '../../ui/platform/geometry';
import { nouns } from '../../ui/platform/nouns';
import { Callout } from '../../ui/primitives/Callout';
import { SettingsPage } from './components/SettingsPage';

export default function WidgetsScreen(): React.ReactElement {
  const n = nouns();
  const ios = nativePlatform === 'ios';
  const [runs, setRuns] = useState(() => prefs.getBoolean(PREF_KEYS.liveRuns, true));
  const [chats, setChats] = useState(() => prefs.getBoolean(PREF_KEYS.liveChats, true));
  const set = (key: string, apply: (v: boolean) => void) => (v: boolean): void => {
    prefs.setBoolean(key, v);
    apply(v);
  };

  return (
    <SettingsPage title={`Widgets & ${n.liveActivities}`} testID="settings-widgets-screen">
      <View className="px-4">
        <Callout tone="info" title={`${n.liveActivities}, widgets and the New chat ${ios ? 'control' : 'tile'} come with a later update`} body={`Choose now what they show on this ${n.device}.`} testID="widgets-coming" />
      </View>
      <ListSection title={n.liveActivities} footer={ios ? 'Shown on the Lock Screen and in the Dynamic Island while the work is live.' : 'Shown as a status bar chip and a live notification while the work is live.'}>
        <ListRow kind="toggle" icon="workflows" title="Runs I start" subtitle="Stages as progress, gates as milestones" switchValue={runs} onValueChange={set(PREF_KEYS.liveRuns, setRuns)} testID="widgets-live-runs" />
        <ListRow kind="toggle" icon="chats" title="Chats waiting on me" subtitle="Only while a permission is pending" switchValue={chats} onValueChange={set(PREF_KEYS.liveChats, setChats)} testID="widgets-live-chats" />
      </ListSection>
      <ListSection title="Approving from the Lock Screen" footer={`Lock Screen surfaces show titles and statuses only, never code or message text.`}>
        <ListRow kind="value" icon="hand" title="Ordinary approvals" value="Needs unlock" />
        <ListRow kind="value" icon="shield" title="Risky approvals" value="Open the app" />
      </ListSection>
    </SettingsPage>
  );
}
