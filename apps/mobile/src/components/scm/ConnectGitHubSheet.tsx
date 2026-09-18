// ────────────────────────────────────────────────────────────────
// ConnectGitHubSheet — GitHub device-code sign-in from the phone.
//
//   1. POST …/accounts/device/start → { loginId, userCode, verificationUri }
//   2. Show the code (tap to copy) and open github.com/login/device in the
//      in-app browser; the code is copied on the way so it can be pasted.
//   3. Poll GET …/accounts/device/:loginId at GitHub's interval until
//      complete / expired / error. The SERVER exchanges the grant and stores
//      the token — the phone never holds a credential.
//
// A server without an OAuth client id cannot run the flow at all; the sheet
// says so (and why) instead of showing a code that could never work.
// Pure rules: `deviceLogin.ts`.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { CheckCircle2, Copy, ExternalLink, Github, XCircle } from 'lucide-react-native';
import type { DeviceLoginStart } from '@generatorai/shared';

import { ApiError } from '../../api/http';
import { useAuth } from '../../auth/AuthProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/States';
import { Touchable } from '../ui/Touchable';
import { haptics } from '../ui/haptics';
import { useToast } from '../ui/Toast';
import { scmKeys } from './api';
import {
  NOT_CONFIGURED_REASON,
  countdown,
  createDeviceLoginApi,
  expiresAtMs,
  formatUserCode,
  interpretDeviceStatus,
  isNotConfiguredError,
  pollDelayMs,
} from './deviceLogin';

export function ConnectGitHubSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  return (
    <Sheet visible={visible} onClose={onClose} title="Connect GitHub" detents={[0.6, 0.9]} keyboardAware={false}>
      {visible ? <ConnectBody onClose={onClose} /> : null}
    </Sheet>
  );
}

function ConnectBody({ onClose }: { onClose: () => void }): React.ReactElement {
  const { fetch } = useAuth();
  const api = useMemo(() => createDeviceLoginApi(fetch), [fetch]);
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const [grant, setGrant] = useState<(DeviceLoginStart & { startedAt: number }) | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const start = useMutation({
    mutationFn: () => api.start(),
    onSuccess: (data) => setGrant({ ...data, startedAt: Date.now() }),
  });

  // Start as soon as the sheet opens; "Try again" restarts.
  useEffect(() => {
    start.mutate();
  }, []);

  const expiresAt = grant ? expiresAtMs(grant.startedAt, grant.expiresIn) : 0;

  const status = useQuery({
    queryKey: ['source-control', 'device-login', grant?.loginId ?? ''],
    queryFn: () => api.poll(grant!.loginId),
    enabled: grant !== null,
    refetchInterval: (query) =>
      (query.state.data && query.state.data.status !== 'pending') ||
      (query.state.error instanceof ApiError && query.state.error.status === 404) ||
      Date.now() >= expiresAt
        ? false
        : pollDelayMs(grant?.interval),
    retry: 1,
    gcTime: 0,
  });

  // A 404 means the server no longer knows this login (restarted, or it
  // aged out) — the code can never complete, so treat it as expired.
  const forgotten = status.error instanceof ApiError && status.error.status === 404;
  const phase = grant
    ? forgotten
      ? ({ kind: 'expired' } as const)
      : interpretDeviceStatus(status.data, now, expiresAt)
    : null;

  // Countdown tick while waiting.
  useEffect(() => {
    if (phase?.kind !== 'waiting') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase?.kind]);

  useEffect(() => {
    if (phase?.kind !== 'connected') return;
    haptics.commit();
    void queryClient.invalidateQueries({ queryKey: scmKeys.settings() });
    toast({ message: `Connected ${phase.label}.`, variant: 'success' });
    // Only once per connected phase.
  }, [phase?.kind]);

  const copyCode = async (): Promise<void> => {
    if (!grant) return;
    await Clipboard.setStringAsync(grant.userCode);
    haptics.tap();
    toast({ message: 'Code copied.', variant: 'success' });
  };

  const openGitHub = async (): Promise<void> => {
    if (!grant) return;
    await Clipboard.setStringAsync(grant.userCode);
    await WebBrowser.openBrowserAsync(grant.verificationUri).catch(() =>
      toast({ message: `Open ${grant.verificationUri} in a browser.`, variant: 'warning' }),
    );
    // Back from the browser: poll now instead of waiting out the interval.
    void status.refetch();
  };

  const restart = (): void => {
    setGrant(null);
    setNow(Date.now());
    start.mutate();
  };

  if (start.isPending || (!grant && !start.isError)) {
    return (
      <View className="items-center gap-3 px-4 py-10">
        <Spinner size="large" />
        <Text className="text-sm text-muted-foreground">Asking GitHub for a sign-in code…</Text>
      </View>
    );
  }

  if (start.isError) {
    const message = start.error instanceof Error ? start.error.message : '';
    const notConfigured = isNotConfiguredError(message);
    return (
      <Outcome
        icon={<XCircle size={32} color={notConfigured ? colors['muted-foreground'] : colors.danger} />}
        title={notConfigured ? 'Device sign-in is off on this server' : 'Could not start sign-in'}
        message={notConfigured ? NOT_CONFIGURED_REASON : message || 'Check the connection to your computer.'}
        primary={notConfigured ? { label: 'Close', onPress: onClose } : { label: 'Try again', onPress: restart }}
      />
    );
  }

  if (phase?.kind === 'connected') {
    return (
      <Outcome
        icon={<CheckCircle2 size={32} color={colors.success} />}
        title={`Connected as ${phase.label}`}
        message="Pushes and pull requests on GitHub now use this account."
        primary={{ label: 'Done', onPress: onClose }}
      />
    );
  }
  if (phase?.kind === 'expired') {
    return (
      <Outcome
        icon={<XCircle size={32} color={colors['muted-foreground']} />}
        title="The code expired"
        message="Codes last a few minutes. Get a new one and approve it on GitHub."
        primary={{ label: 'Get a new code', onPress: restart }}
      />
    );
  }
  if (phase?.kind === 'failed') {
    return (
      <Outcome
        icon={<XCircle size={32} color={colors.danger} />}
        title="Sign-in did not finish"
        message={phase.message}
        primary={{ label: 'Try again', onPress: restart }}
      />
    );
  }

  return (
    <View className="gap-4 px-4 pb-6 pt-2">
      <Text className="text-md leading-relaxed text-foreground">
        Enter this code on GitHub to connect an account to the machine running GeneratorAI.
      </Text>
      <Touchable
        accessibilityLabel={`Sign-in code ${grant!.userCode.split('').join(' ')}. Double-tap to copy.`}
        haptic="none"
        onPress={() => void copyCode()}
        className="items-center gap-2 rounded-3xl border border-border bg-raised px-4 py-5"
      >
        <Text selectable className="font-mono text-3xl font-bold tracking-widest text-foreground">
          {formatUserCode(grant!.userCode)}
        </Text>
        <View className="flex-row items-center gap-1.5">
          <Copy size={14} color={colors['muted-foreground']} />
          <Text className="text-sm text-muted-foreground">Tap to copy</Text>
        </View>
      </Touchable>
      <Button
        label="Open GitHub"
        full
        size="lg"
        haptic="tap"
        icon={<ExternalLink size={18} color={colors['primary-foreground']} />}
        onPress={() => void openGitHub()}
        accessibilityHint="Copies the code and opens the GitHub device page"
      />
      <View className="flex-row items-center justify-center gap-2" accessibilityLiveRegion="polite">
        <Spinner />
        <Text className="text-sm text-muted-foreground">
          Waiting for approval · expires in {countdown(expiresAt, now)}
        </Text>
      </View>
      <Text className="text-center text-sm text-muted-foreground">{grant!.verificationUri}</Text>
    </View>
  );
}

function Outcome({
  icon,
  title,
  message,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  primary: { label: string; onPress: () => void };
}): React.ReactElement {
  return (
    <View className="gap-3 px-4 pb-6 pt-4">
      <View className="items-center gap-2">
        {icon ?? <Github size={32} />}
        <Text accessibilityRole="header" className="text-center text-lg font-semibold text-foreground">
          {title}
        </Text>
        <Text accessibilityLiveRegion="polite" className="text-center text-sm leading-relaxed text-muted-foreground">
          {message}
        </Text>
      </View>
      <Button label={primary.label} full size="lg" haptic="tap" onPress={primary.onPress} />
    </View>
  );
}
