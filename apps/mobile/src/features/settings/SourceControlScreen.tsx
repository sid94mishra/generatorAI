// Settings › Source control (MSetSourceControl, MDF-111; `/settings/source-control`): connected accounts (login, host
// · method, "Default"; menu Set as default / Disconnect…), "Sign in with GitHub" first — the device-code flow in the
// sheet (the code with Copy, Open github.com, a countdown, polled until the server stores the token: no credential
// ever reaches the phone) — and "Use a token instead" (personal access token + Enterprise host, saved with the header
// Save; the token is write-only). Defaults are read-only here: the commit / PR text model, the base branch, and
// auto-commit / auto-PR set per workflow. Writes need `write:projects` (else the request row) and a step-up.
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import type { DeviceLoginStart, SourceControlAccount } from '@generatorai/shared';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { errorText } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { Menu } from '../../ui/native/Menu';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Collapsible } from '../../ui/primitives/Collapsible';
import { IconButton } from '../../ui/primitives/IconButton';
import { Input } from '../../ui/primitives/Input';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Spinner } from '../../ui/primitives/Spinner';
import { Text } from '../../ui/primitives/Text';
import { overflowIcon } from '../../ui/platform/overflow';
import { SettingsPage } from './components/SettingsPage';
import { NOT_CONFIGURED_REASON, countdown, expiresAtMs, formatUserCode, interpretDeviceStatus, isNotConfiguredError, pollDelayMs, type DevicePhase } from './model/deviceLogin';
import { useDefaultScmAccount, useDisconnectScmAccount, useScmWrites, useSourceControlSettings } from './queries';
import { adminWrite, useScopeAccess } from './useSettingsAccess';

const METHOD: Record<SourceControlAccount['authMethod'], string> = { token: 'token', device: 'device sign-in', 'gh-cli': 'gh CLI' };

/** One sign-in attempt; "Try again" / "Get a new code" remount it with a new key. */
function DeviceLoginBody({ onDone }: { onDone: () => void }): React.ReactElement {
  const [attempt, setAttempt] = useState(0);
  return <DeviceLoginAttempt key={attempt} onDone={onDone} onRetry={() => setAttempt((a) => a + 1)} />;
}

function DeviceLoginAttempt({ onDone, onRetry }: { onDone: () => void; onRetry: () => void }): React.ReactElement {
  const writes = useScmWrites();
  const [grant, setGrant] = useState<(DeviceLoginStart & { startedAt: number }) | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [phase, setPhase] = useState<DevicePhase>({ kind: 'waiting' });
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    writes
      .startDeviceLogin()
      .then((g) => alive.current && setGrant({ ...g, startedAt: Date.now() }))
      .catch((e: unknown) => alive.current && setStartError(isNotConfiguredError(errorText(e)) ? NOT_CONFIGURED_REASON : errorText(e)));
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one start per attempt (the parent remounts it)
  }, []);

  useEffect(() => {
    if (!grant || phase.kind !== 'waiting') return undefined;
    const expiresAt = expiresAtMs(grant.startedAt, grant.expiresIn);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = (): void => {
      writes
        .pollDeviceLogin(grant.loginId)
        .then((status) => {
          if (!alive.current) return;
          const next = interpretDeviceStatus(status, Date.now(), expiresAt);
          setPhase(next);
          if (next.kind === 'waiting') timer = setTimeout(poll, pollDelayMs(grant.interval));
          else if (next.kind === 'connected') {
            haptic('success');
            void writes.settle();
          }
        })
        .catch(() => {
          if (alive.current) timer = setTimeout(poll, pollDelayMs(grant.interval));
        });
    };
    timer = setTimeout(poll, pollDelayMs(grant.interval));
    return () => {
      clearInterval(tick);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restarts per grant
  }, [grant, phase.kind]);

  if (startError) {
    return (
      <View className="gap-4 pb-4">
        <Callout tone="err" title="Couldn't start sign-in" body={startError} />
        <Button label="Try again" size="lg" fullWidth onPress={() => onRetry()} />
      </View>
    );
  }
  if (!grant) {
    return (
      <View className="items-center gap-2 py-8">
        <Spinner label="Asking GitHub for a code" />
      </View>
    );
  }
  if (phase.kind === 'connected') {
    return (
      <View className="gap-4 pb-4">
        <Callout tone="ok" title={`Connected as ${phase.label}`} body="The token is stored on the server, never on this device." />
        <Button label="Done" size="lg" fullWidth onPress={onDone} testID="scm-device-done" />
      </View>
    );
  }
  const expiresAt = expiresAtMs(grant.startedAt, grant.expiresIn);
  return (
    <View className="gap-4 pb-4">
      <Text role="body" tone="fg-2">
        Open github.com/login/device and enter this code. This screen updates once you approve it.
      </Text>
      <View className="flex-row items-center justify-center gap-3 rounded-card bg-sunken py-4">
        <Text role="monoLg" weight={600} selectable accessibilityLabel={`Code ${grant.userCode.split('').join(' ')}`} testID="scm-device-code">
          {formatUserCode(grant.userCode)}
        </Text>
        <IconButton
          icon={copied ? 'check' : 'copy'}
          label={copied ? 'Copied' : 'Copy code'}
          onPress={() => {
            void Clipboard.setStringAsync(grant.userCode).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        />
      </View>
      {phase.kind === 'expired' ? (
        <Callout tone="warn" title="The code expired" action={{ label: 'Get a new code', onPress: () => onRetry() }} />
      ) : phase.kind === 'failed' ? (
        <Callout tone="err" title="Sign-in failed" body={phase.message} action={{ label: 'Try again', onPress: () => onRetry() }} />
      ) : (
        <Text role="footnote" tone="fg-3" align="center">
          Waiting for approval · expires in {countdown(expiresAt, now)}
        </Text>
      )}
      <Button label="Open github.com" icon="external-link" size="lg" fullWidth onPress={() => void WebBrowser.openBrowserAsync(grant.verificationUri)} testID="scm-device-open" />
    </View>
  );
}

function AccountRow({ account, isDefault, canWrite }: { account: SourceControlAccount; isDefault: boolean; canWrite: boolean }): React.ReactElement {
  const setDefault = useDefaultScmAccount({});
  const disconnect = useDisconnectScmAccount({});
  const onMenu = (id: string): void => {
    if (id === 'default') void adminWrite('Make this the default account', () => setDefault.mutateAsync(account.id));
    if (id === 'disconnect')
      void confirm({
        title: `Disconnect ${account.login ?? account.label}?`,
        message: 'Its token is deleted from the server. Repositories on that host stop pushing and opening pull requests until an account is connected again.',
        confirmLabel: 'Disconnect',
        destructive: true,
      }).then((ok) => {
        if (ok) void adminWrite(`Disconnect ${account.login ?? account.label}`, () => disconnect.mutateAsync(account.id));
      });
  };
  return (
    <View className="flex-row items-center pr-2">
      <View className="flex-1">
        <ListRow kind="info" icon="branch" title={account.login ?? account.label} subtitle={`${account.host ?? 'github.com'} · ${METHOD[account.authMethod]}`} {...(isDefault ? { badge: <Badge label="Default" size="sm" /> } : {})} testID={`scm-account-${account.id}`} />
      </View>
      {canWrite ? (
        <Menu
          items={[
            { id: 'default', label: 'Set as default', icon: 'pin', disabled: isDefault },
            { id: 'disconnect', label: 'Disconnect…', icon: 'trash', destructive: true },
          ]}
          onSelect={onMenu}
          accessibilityLabel={`Actions for ${account.login ?? account.label}`}
          trigger={<IconButton icon={overflowIcon} label={`Actions for ${account.login ?? account.label}`} size="sm" onPress={() => undefined} />}
        />
      ) : null}
    </View>
  );
}

export default function SourceControlScreen(): React.ReactElement {
  const settings = useSourceControlSettings();
  const writes = useScmWrites();
  const access = useScopeAccess('write:projects', 'Connect source-control accounts from this device');
  const sheet = useSheet();
  const [token, setToken] = useState('');
  const [host, setHost] = useState('');
  const [saving, setSaving] = useState(false);
  const data = settings.data?.settings;
  const accounts = data?.accounts ?? [];
  const github = settings.data?.providers.find((p) => p.id === 'github');
  const deviceFlow = github?.loginMethods.includes('device') ?? false;
  const dirty = token.trim().length > 0;

  const save = (): void => {
    if (!dirty) return;
    setSaving(true);
    void adminWrite('Connect GitHub with a token', async () => {
      await writes.connectToken(token.trim(), host.trim() || null);
      return true;
    })
      .then((ok) => {
        if (!ok) return;
        haptic('success');
        setToken('');
        setHost('');
      })
      .finally(() => setSaving(false));
  };
  const signIn = (): void =>
    sheet.present(<DeviceLoginBody onDone={() => sheet.dismiss()} />, { title: 'Sign in with GitHub', detents: ['large'], testID: 'scm-device-sheet' });

  const state = settings.isLoading
    ? { kind: 'loading' as const, skeleton: <Skeleton preset="list" count={3} /> }
    : settings.isError && !settings.data
      ? { kind: 'error' as const, error: settings.error, onRetry: () => void settings.refetch(), title: "Couldn't load source control" }
      : { kind: 'ready' as const };

  return (
    <SettingsPage
      title="Source control"
      intro="Connect an account for pull requests and pushes. Tokens are stored on the server and never sent back to this device."
      actions={access.granted && dirty ? [{ id: 'save', icon: 'check', label: 'Save', onPress: save, testID: 'scm-save' }] : []}
      state={state}
      onRefresh={async () => void (await settings.refetch())}
      keyboard="form"
      testID="settings-source-control-screen"
    >
      <ListSection title="Accounts" footer="The account for a repository is picked by its remote host, falling back to the default.">
        {accounts.length === 0 ? <ListRow kind="info" icon="branch" title="No account connected" subtitle="Pull requests and pushes need a GitHub account" testID="scm-no-accounts" /> : null}
        {accounts.map((a) => (
          <AccountRow key={a.id} account={a} isDefault={a.id === data?.defaultAccountId} canWrite={access.granted} />
        ))}
      </ListSection>

      {access.granted ? (
        <View className="gap-3 px-4">
          {deviceFlow ? (
            <Button label="Sign in with GitHub" icon="branch" size="lg" fullWidth onPress={signIn} testID="scm-sign-in" />
          ) : (
            <Callout tone="info" title="Device sign-in is off on this server" body={NOT_CONFIGURED_REASON} />
          )}
          <Collapsible header={<Text role="body" weight={500}>Use a token instead</Text>} accessibilityLabel="Use a token instead" testID="scm-token-toggle">
            <View className="gap-3 pt-3">
              <Input label="GitHub token" kind="secret" value={token} onChangeText={setToken} placeholder="ghp_…" presentation="standalone" testID="scm-token" />
              <Input label="Enterprise host (optional)" kind="url" value={host} onChangeText={setHost} placeholder="https://ghe.example.com" presentation="standalone" testID="scm-host" />
              <Text role="footnote" tone="fg-3">
                The token needs the repo and pull_request scopes. Save it with the check in the header; it is validated against GitHub and never shown again.
              </Text>
              {saving ? <Spinner label="Saving" /> : null}
            </View>
          </Collapsible>
        </View>
      ) : (
        <ListSection>
          <ListRow kind="requires-admin" icon="branch" title="Connect accounts" onPress={access.request} testID="scm-requires-scope" />
        </ListSection>
      )}

      <ListSection title="Commits and pull requests" footer="Set on the desktop or web app.">
        <ListRow kind="info" icon="wand" title="Commit and PR text" value={data?.generation.model ?? 'From the change set'} />
        <ListRow kind="info" icon="branch" title="Default base branch" value={data?.defaultBase ?? "Repository's own"} />
        <ListRow kind="info" icon="workflows" title="Auto-commit & auto-PR" subtitle="Set per workflow in Workflow settings" />
      </ListSection>
    </SettingsPage>
  );
}

