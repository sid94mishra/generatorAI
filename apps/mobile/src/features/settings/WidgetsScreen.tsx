// Settings › Widgets & Live Activities (iOS) / Live Updates (Android) (MSetWidgets, MDF-116; `/settings/widgets`, this
// device): which runs and chats get a live surface (MD-90, MD-182), the iOS widgets, the New chat control (iOS:
// added from Control Center's edit mode — apps cannot add it) or Quick Settings tile (Android 13+: "Add tile"), and
// how approvals behave from the Lock Screen (MD-31). Not rendered (MD-27): the preview (sample data), the iOS
// authorization state and the widget placement counts / refresh row (no API in expo-widgets 57), Android widgets
// (MD-188).
import React, { useState } from 'react';

import { readLiveSurfacePrefs, setLiveSurfacePref } from '../../services/live/liveStore';
import { canRequestAddTile, requestAddTile, type AddTileResult } from '../../services/native/quickSettingsTile';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { nativePlatform } from '../../ui/platform/geometry';
import { nouns } from '../../ui/platform/nouns';
import { toast } from '../../ui/primitives/Toast';
import { SettingsPage } from './components/SettingsPage';

export default function WidgetsScreen(): React.ReactElement {
  const n = nouns();
  const ios = nativePlatform === 'ios';
  const [runs, setRuns] = useState(() => readLiveSurfacePrefs().runs);
  const [chats, setChats] = useState(() => readLiveSurfacePrefs().chats);
  const set = (key: 'runs' | 'chats', apply: (v: boolean) => void) => (v: boolean): void => {
    setLiveSurfacePref(key, v);
    apply(v);
  };

  const canAddTile = !ios && canRequestAddTile();
  const tileFooter = canAddTile ? 'Opens a new chat from Quick Settings.' : 'Add it from Quick Settings: open the panel, tap Edit and drag the tile in.';
  const addTile = (): void => {
    void requestAddTile().then((result: AddTileResult) => {
      if (result === 'added') toast({ kind: 'background', message: 'Tile added to Quick Settings' });
      else if (result === 'already') toast({ kind: 'background', message: 'The tile is already in Quick Settings' });
      else if (result === 'failed' || result === 'unsupported') toast({ kind: 'error', message: "Couldn't add the tile" });
    });
  };

  return (
    <SettingsPage title={`Widgets & ${n.liveActivities}`} testID="settings-widgets-screen">
      <ListSection title={n.liveActivities} footer={ios ? 'Shown on the Lock Screen and in the Dynamic Island while the work is live.' : 'Shown as a status bar chip and a live notification while the work is live.'}>
        <ListRow kind="toggle" icon="workflows" title="Runs I start" subtitle="Stages as progress, gates as milestones" switchValue={runs} onValueChange={set('runs', setRuns)} testID="widgets-live-runs" />
        <ListRow kind="toggle" icon="chats" title="Chats waiting on me" subtitle="Only while a permission is pending" switchValue={chats} onValueChange={set('chats', setChats)} testID="widgets-live-chats" />
      </ListSection>
      {ios ? (
        <ListSection title="Widgets" footer={`Add or remove widgets from the Home Screen. They show this ${n.device}'s last sync with the active server.`}>
          <ListRow kind="info" icon="widgets" title="Needs you" subtitle="Medium" testID="widgets-needs-you" />
          <ListRow kind="info" icon="widgets" title="Running" subtitle="Medium · Large" testID="widgets-running" />
          <ListRow kind="info" icon="widgets" title="Summary" subtitle="Small" testID="widgets-summary" />
        </ListSection>
      ) : null}
      <ListSection title="Controls" footer={ios ? 'Add it in Control Center: touch and hold an empty area, then Add a Control.' : tileFooter}>
        {ios ? (
          <ListRow kind="info" icon="edit" title="Control Center: New chat" testID="widgets-control" />
        ) : canAddTile ? (
          <ListRow kind="navigation" icon="edit" title="Quick Settings tile: New chat" value="Add tile" onPress={addTile} testID="widgets-add-tile" />
        ) : (
          <ListRow kind="info" icon="edit" title="Quick Settings tile: New chat" testID="widgets-tile" />
        )}
      </ListSection>
      <ListSection title="Approving from the Lock Screen" footer={`Lock Screen surfaces show titles and statuses only, never code or message text.`}>
        <ListRow kind="value" icon="hand" title="Ordinary approvals" value="Needs unlock" />
        <ListRow kind="value" icon="shield" title="Risky approvals" value="Open the app" />
      </ListSection>
    </SettingsPage>
  );
}
