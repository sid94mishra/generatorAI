// Settings › Browser & terminal (MSetBrowserTerminal, MDF-109; `/settings/browser-terminal`, "This device"): the
// terminal this device opens — the shell (options follow the server's OS from `system/info`; PowerShell only on a
// Windows server; stored per server), the font size and the key row — and "What this <device> can do": Terminal,
// Browser control and Computer use as Granted / Not granted with one "Request …" row for what is missing (or the own
// pending request). Not rendered: "Full browser interaction" (the phone's browser is view-only, MD-37) and the
// PowerShell-profile / SSH-token switches (the terminal route takes no such option; MD-27).
import React, { useState } from 'react';
import { router } from 'expo-router';

import { useSystemInfo } from '../../blocks/StatsCards';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, TERMINAL_PREF_KEYS, getTerminalFont, setTerminalFont, type KeyBarMode } from '../../blocks/TerminalView';
import { pendingRequestOf, useMyScopeRequests } from '../../services/api/scopeRequests';
import { useAuth } from '../../services/auth/AuthProvider';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { shellOptions, useTerminalShell, writeTerminalShell } from '../../services/prefs/terminalPrefs';
import { prefs } from '../../services/storage/prefs';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { nouns } from '../../ui/platform/nouns';
import { Badge } from '../../ui/primitives/Badge';
import { SettingsPage } from './components/SettingsPage';
import { scopeRequestHref } from '../../blocks/shell/hrefs';

type Href = Parameters<typeof router.push>[0];

const CAPABILITIES = [
  { scope: 'exec:terminal', title: 'Terminal', subtitle: 'Run shell commands', icon: 'terminal' },
  { scope: 'exec:browser', title: 'Browser control', subtitle: "Drive the agent's browser", icon: 'browser' },
  { scope: 'exec:computer', title: 'Computer use', subtitle: 'Watch and approve desktop actions', icon: 'computer' },
] as const;

const KEY_ROW = [
  { value: 'auto', label: 'Automatic' },
  { value: 'shown', label: 'Always' },
  { value: 'hidden', label: 'Never' },
];

function readKeyBar(): KeyBarMode {
  const v = prefs.getString(TERMINAL_PREF_KEYS.keyBar);
  return v === 'shown' || v === 'hidden' ? v : 'auto';
}

export default function BrowserTerminalScreen(): React.ReactElement {
  const { serverId } = useAuth();
  const scopes = useGrantedScopes();
  const info = useSystemInfo();
  const shell = useTerminalShell(serverId);
  const [font, setFont] = useState(getTerminalFont);
  const [keyBar, setKeyBar] = useState<KeyBarMode>(readKeyBar);
  const mine = useMyScopeRequests();
  const pending = pendingRequestOf(mine.data);
  const missing = CAPABILITIES.filter((c) => !scopes.includes(c.scope));
  const device = nouns().device;
  const options = shellOptions(info.data?.platform);
  const shellValue = options.some((o) => o.value === shell) ? shell : '';

  return (
    <SettingsPage title="Browser & terminal" intro={`How terminals open on this ${device}. The browser here is view only: you watch the agent and pick elements with Inspect.`} testID="settings-browser-terminal-screen">
      <ListSection title="Integrated terminal" footer="Changes apply the next time a terminal tab opens.">
        <ListRow
          kind="picker"
          title="Default shell"
          picker={{ value: shellValue, options, onValueChange: (v) => serverId && writeTerminalShell(serverId, v) }}
          provenance={<Badge label="This device" size="sm" />}
          testID="terminal-shell"
        />
        <ListRow
          kind="stepper"
          icon="zoom-in"
          title="Font size"
          stepper={{
            value: font,
            min: FONT_SIZE_MIN,
            max: FONT_SIZE_MAX,
            onValueChange: (v) => {
              setTerminalFont(v);
              setFont(getTerminalFont());
            },
            testID: 'terminal-font',
          }}
        />
        <ListRow
          kind="picker"
          title="Key row"
          picker={{
            value: keyBar,
            options: KEY_ROW,
            onValueChange: (v) => {
              prefs.setString(TERMINAL_PREF_KEYS.keyBar, v);
              setKeyBar(v as KeyBarMode);
            },
          }}
          testID="terminal-key-row"
        />
      </ListSection>

      <ListSection title={`What this ${device} can do`} footer="Granted per device in Security & devices.">
        {CAPABILITIES.map((c) => (
          <ListRow key={c.scope} kind="info" icon={c.icon} title={c.title} subtitle={c.subtitle} badge={scopes.includes(c.scope) ? <Badge label="Granted" icon="check" size="sm" /> : <Badge label="Not granted" icon="lock" tone="outline" size="sm" />} testID={`capability-${c.scope}`} />
        ))}
        {missing.length && pending ? (
          <ListRow kind="info" icon="hourglass" title="Request pending" subtitle="Waiting for an admin to approve" testID="capability-pending" />
        ) : missing.length ? (
          <ListRow
            kind="navigation"
            icon="shield"
            title={missing.length === 1 ? `Request ${missing[0]!.title.toLowerCase()}` : 'Request access'}
            onPress={() => router.push(scopeRequestHref(missing.map((m) => m.scope)) as Href)}
            testID="capability-request"
          />
        ) : null}
      </ListSection>
    </SettingsPage>
  );
}
