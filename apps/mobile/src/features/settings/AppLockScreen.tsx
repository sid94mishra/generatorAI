// Settings › App lock & privacy (MSetAppLock, MDF-115; `/settings/app-lock`, this device): Unlock — "Require <Face ID
// / Touch ID / fingerprint / face unlock / passcode>" (the OS noun; no biometrics enrolled → the passcode; neither →
// the lock is unavailable) and Lock after leaving. "Asks for <noun>" lists the fixed policy as locked rows, not
// switches (06 §6.4: risky approvals sign every time, admin writes and device changes step up every time, terminal /
// browser / computer use once per 10 minutes) — a phone cannot turn them off. Privacy: "Hide content in app switcher"
// (always with the lock; a choice without it) and "Hide notification previews" (iOS: the notification service
// extension swaps in the lock-screen-safe copy, always with the lock — MD-92; Android: PRIVATE channels, the system's
// lock-screen setting decides). The footer says where the signing key lives.
import React from 'react';

import { useAuth } from '../../services/auth/AuthProvider';
import { useBiometricInfo } from '../../services/auth/biometrics';
import { LOCK_GRACE_OPTIONS, usePreferences, type LockGraceSeconds } from '../../services/prefs/preferences';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { nativePlatform } from '../../ui/platform/geometry';
import { nouns } from '../../ui/platform/nouns';
import { SettingsPage } from './components/SettingsPage';
import { keyProtection } from './model/deviceView';
import { unlockMethod } from './model/appLockModel';

export default function AppLockScreen(): React.ReactElement {
  const { biometricLock, setBiometricLock, lockGraceSeconds, setLockGraceSeconds, hideInSwitcher, setHideInSwitcher, hideNotificationPreviews, setHideNotificationPreviews } = usePreferences();
  const info = useBiometricInfo();
  const { keyBacking } = useAuth();
  const method = unlockMethod(info, nativePlatform);
  const device = nouns().device;
  const key = keyProtection(keyBacking);
  const ios = nativePlatform === 'ios';

  return (
    <SettingsPage title="App lock & privacy" testID="settings-app-lock-screen">
      <ListSection title="Unlock" footer={method.impossible ? method.fallback : undefined}>
        <ListRow kind="toggle" icon="lock" title={method.title} subtitle={method.impossible ? undefined : method.fallback} switchValue={biometricLock && !method.impossible} onValueChange={setBiometricLock} disabled={method.impossible} testID="app-lock-require" />
        <ListRow
          kind="picker"
          title="Lock after leaving"
          picker={{ value: String(lockGraceSeconds), options: LOCK_GRACE_OPTIONS.map((o) => ({ value: String(o.seconds), label: o.label })), onValueChange: (v) => setLockGraceSeconds(Number(v) as LockGraceSeconds), disabled: !biometricLock }}
          testID="app-lock-grace"
        />
      </ListSection>

      <ListSection title={`Asks for ${method.noun}`} footer="Set for every device and not switchable here.">
        <ListRow kind="value" icon="hand" title="Risky approvals" subtitle="Shell, network and push permissions; workflow approvals" value="Every time" />
        <ListRow kind="value" icon="terminal" title="Terminal, browser and computer use" subtitle="Opening the tab or turning it on" value="Every 10 min" />
        <ListRow kind="value" icon="device" title="Pairing, revoking and server settings" subtitle="Each change" value="Every time" />
        <ListRow kind="value" icon="check" title="Ordinary approvals" subtitle="Allow once, answers, plans" value={`Unlocked ${device}`} />
      </ListSection>

      <ListSection title="Privacy" footer={`The signing key lives in ${key.hardware ? `the ${key.detail}` : 'software on this device'} and can't leave this ${device}.`}>
        <ListRow
          kind="toggle"
          icon="hide"
          title={ios ? 'Hide content in app switcher' : 'Hide content in Recents'}
          subtitle={biometricLock ? 'Always on while App lock is on' : ios ? 'Blurs it and shows the app mark' : 'Recents shows a blank card'}
          switchValue={biometricLock || hideInSwitcher}
          onValueChange={setHideInSwitcher}
          disabled={biometricLock}
          testID="app-lock-hide-switcher"
        />
        {ios ? (
          <ListRow
            kind="toggle"
            icon="bell"
            title="Hide notification previews"
            subtitle={biometricLock ? 'Always on while App lock is on' : 'Shows what needs you, never the command or message'}
            switchValue={biometricLock || hideNotificationPreviews}
            onValueChange={setHideNotificationPreviews}
            disabled={biometricLock}
            testID="app-lock-hide-previews"
          />
        ) : (
          <ListRow kind="value" icon="bell" title="Hide notification previews" subtitle="Android hides them on a secure lock screen" value="System setting" testID="app-lock-hide-previews" />
        )}
      </ListSection>
    </SettingsPage>
  );
}
