// MB-29 ComputerView (MPaneComputer; MD-37): watch computer use and answer for it — never drive it. "Now / Replay":
// Now is the newest captured window (a capture of the target window, never the whole screen; ~every 3 s while the
// tab is on screen) with Pause agent / Resume agent (`computer/control`); Replay is the action log, newest first.
// A consent request ("Allow typing in Queue Inspector?") is a card with the shared answers (allowing asks for the
// step-up; denying never does; an unanswered prompt expires as a denial). Grants are listed with Revoke (confirmed).
// "Take over" and screen video are not offered on phones and tablets (MD-37).
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@generatorai/client-core';

import { computerConsentKey } from '../WorkspacePane/WorkspacePane.queries';
import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';
import { requireStepUp } from '../../services/auth/stepUp';
import { bytesToBase64 } from '../../services/lib/base64';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { formatRelativeShort } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { Spinner } from '../../ui/primitives/Spinner';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { activeConsent, activityRows, consentOptions, secondsLeft, tookScreen, type ComputerGrant, type ConsentDecision, type PendingConsent } from './model/computerModel';

const POLL_MS = 3_000;

export interface ComputerViewProps {
  workspaceId: string;
  active: boolean;
}

function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

export function ComputerView({ workspaceId, active }: ComputerViewProps): React.ReactElement {
  const api = useApi();
  const admin = useAdminApi();
  const client = useQueryClient();
  const id = encodeURIComponent(workspaceId);
  const [mode, setMode] = useState<'now' | 'replay'>('now');
  const interval = active ? POLL_MS : false;

  const consent = useQuery({ queryKey: computerConsentKey(workspaceId), queryFn: () => admin.computer.consent(id), refetchInterval: interval });
  const frames = useQuery({ queryKey: ['workspaces', workspaceId, 'computer', 'frames'], queryFn: () => api.resources.computerFrames(workspaceId), refetchInterval: interval });
  const activity = useQuery({ queryKey: ['workspaces', workspaceId, 'computer', 'activity'], queryFn: () => api.resources.computerActivity(workspaceId), refetchInterval: active ? POLL_MS * 2 : false });
  const grants = useQuery({ queryKey: ['workspaces', workspaceId, 'computer', 'grants'], queryFn: () => admin.computer.grants(id) });
  const control = useQuery({ queryKey: ['workspaces', workspaceId, 'computer', 'control'], queryFn: () => admin.computer.control(id), refetchInterval: interval });
  const latest = frames.data?.frames?.[0] ?? null;
  // An unchanged newest frame is not downloaded again (keyed by its id; Image cannot sign the request).
  const frame = useQuery({
    queryKey: ['workspaces', workspaceId, 'computer', 'frame', latest?.id ?? null],
    enabled: Boolean(latest),
    staleTime: Infinity,
    queryFn: async () => {
      const { data, contentType } = await api.resources.computerFrame(workspaceId, latest!.id);
      return `data:${contentType === 'application/octet-stream' ? 'image/png' : contentType};base64,${bytesToBase64(data)}`;
    },
  });

  const now = useNow(Boolean(consent.data?.pending?.length));
  const prompt = activeConsent(consent.data?.pending, now);
  const answer = useMutation({
    mutationFn: async ({ target, decision }: { target: PendingConsent; decision: ConsentDecision }) => {
      const option = consentOptions(target).find((o) => o.decision === decision);
      if (option?.needsStepUp && !(await requireStepUp(`Confirm allowing ${target.action} in ${target.appLabel}`))) return 'skipped' as const;
      try {
        await admin.computer.setConsent(id, { requestId: target.requestId, appIdentity: target.appIdentity, decision });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) return 'gone' as const;
        throw error;
      }
      return decision;
    },
    onSuccess: (out) => {
      if (out === 'skipped') return;
      if (out === 'gone') toast({ kind: 'background', message: 'That request is no longer waiting for an answer.' });
      else haptic('success');
      void consent.refetch();
      void grants.refetch();
    },
    onError: (err) => {
      haptic('error');
      toast({ kind: 'error', message: err instanceof Error ? err.message : "Couldn't send that answer." });
    },
  });
  const setControl = useMutation({
    mutationFn: (next: 'agent' | 'paused') => admin.computer.setControl(id, next),
    onSuccess: (state) => {
      client.setQueryData(['workspaces', workspaceId, 'computer', 'control'], state);
      haptic('success');
    },
    onError: () => toast({ kind: 'error', message: "Couldn't change who drives the desktop." }),
  });
  const revoke = useMutation({
    mutationFn: (grant: ComputerGrant) => admin.computer.revokeGrant(id, grant.appIdentity),
    onSuccess: () => {
      haptic('success');
      void grants.refetch();
    },
    onError: () => toast({ kind: 'error', message: "Couldn't revoke that permission." }),
  });

  if (frames.isLoading && consent.isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <Spinner label="Loading computer use" />
      </View>
    );
  }
  if (frames.isError && consent.isError) return <ErrorState title="Computer use unavailable" error={frames.error} onRetry={() => void frames.refetch()} />;

  const rows = activityRows(activity.data?.entries);
  const paused = control.data?.mode === 'paused';
  const grantList = grants.data ?? [];

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-3 pb-8 pt-2" testID="computer">
      <View className="flex-row items-center gap-2 px-4">
        <Text role="subhead" weight={600} numberOfLines={1} className="flex-1">
          {rows[0]?.title.split(' · ')[1] ?? 'Computer use'}
        </Text>
        <SegmentedControl<'now' | 'replay'> accessibilityLabel="View" value={mode} onValueChange={setMode} segments={[{ value: 'now', label: 'Now' }, { value: 'replay', label: 'Replay' }]} size="sm" testID="computer-mode" />
      </View>
      {frames.data?.enabled === false ? (
        <View className="px-4">
          <Callout tone="warn" form="banner" title="Computer use is switched off on the server" />
        </View>
      ) : null}
      {prompt ? (
        <View className="mx-4 gap-3 rounded-card-lg border border-line bg-raised p-4" accessibilityRole="alert" testID="computer-consent">
          <View className="flex-row items-start gap-2">
            <Icon concept="hand" size={18} tone="warn" />
            <View className="flex-1 gap-1">
              <Text role="subhead" weight={600}>{`Allow ${prompt.action} in ${prompt.appLabel}?`}</Text>
              {prompt.summary ? (
                <Text role="footnote" tone="fg-2">
                  {prompt.summary}
                </Text>
              ) : null}
              {tookScreen(prompt.path) ? (
                <Text role="footnote" tone="warn">
                  This takes over the keyboard and mouse on your desktop.
                </Text>
              ) : null}
              <Text role="caption" tone="fg-3">{`Expires in ${secondsLeft(prompt, now)} s — no answer is a denial.`}</Text>
            </View>
          </View>
          <View className="gap-2">
            {consentOptions(prompt).map((option) => (
              <Button
                key={option.decision}
                label={option.label}
                fullWidth
                variant={option.tone === 'primary' ? 'primary' : option.tone === 'danger' ? 'destructive' : 'secondary'}
                disabled={answer.isPending}
                loading={answer.isPending && answer.variables?.decision === option.decision}
                onPress={() => answer.mutate({ target: prompt, decision: option.decision })}
              />
            ))}
          </View>
        </View>
      ) : null}
      {mode === 'now' ? (
        latest ? (
          <View className="gap-2 px-4">
            <View className="overflow-hidden rounded-card border border-line bg-sunken">
              <View className="flex-row items-center gap-2 px-3 py-2">
                <Badge label={paused ? 'Paused' : 'Live'} size="sm" />
                <View className="flex-1" />
                <Text role="monoSm" tone="fg-3">
                  {formatRelativeShort(latest.createdAt)}
                </Text>
              </View>
              {frame.data ? (
                <Image source={{ uri: frame.data }} resizeMode="contain" accessibilityLabel="The window the agent last captured" className="w-full" style={{ aspectRatio: latest.width && latest.height ? latest.width / latest.height : 1.6 }} />
              ) : (
                <View className="items-center justify-center p-8">
                  <Spinner label="Loading the frame" />
                </View>
              )}
            </View>
            <View className="flex-row gap-2">
              <Button label={paused ? 'Resume agent' : 'Pause agent'} icon={paused ? 'play' : 'pause'} loading={setControl.isPending} disabled={!control.data || control.data.mode === 'user'} onPress={() => setControl.mutate(paused ? 'agent' : 'paused')} testID="computer-pause" />
            </View>
            <Text role="caption" tone="fg-3">
              View only — a capture of the target window, never the whole screen.
            </Text>
          </View>
        ) : (
          <EmptyState icon="computer" title="Nothing captured yet" description="When the agent reads or operates a window on your desktop, it shows up here." />
        )
      ) : rows.length > 0 ? (
        <ListSection title="Replay" count={rows.length}>
          {rows.map((row) => (
            <View accessibilityRole="text" key={row.key} className="min-h-row flex-row items-center gap-3 px-4 py-2" accessible accessibilityLabel={`${row.title}${row.subtitle ? `, ${row.subtitle}` : ''}`}>
              <Text role="monoSm" tone="fg-3" className="w-10">
                {formatRelativeShort(row.createdAt)}
              </Text>
              <View className="flex-1 gap-0.5">
                <Text role="body" tone={row.tone === 'danger' ? 'err' : row.tone === 'warning' ? 'warn' : 'fg'} numberOfLines={1}>
                  {row.title}
                </Text>
                {row.subtitle ? (
                  <Text role="monoSm" tone="fg-3" numberOfLines={1}>
                    {row.subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </ListSection>
      ) : (
        <EmptyState icon="history" title="No actions yet" description="Every action the agent takes on the desktop is logged here." />
      )}
      {grantList.length > 0 ? (
        <ListSection title="Grants" count={grantList.length}>
          {grantList.map((grant) => (
            <ListRow
              key={grant.appIdentity}
              kind="info"
              icon={grant.scope === 'read' ? 'view' : 'pointer'}
              title={grant.scope === 'read' ? 'Screen' : 'Keyboard & mouse'}
              subtitle={`${grant.appIdentity === '*' ? 'Any app' : grant.appLabel || grant.appIdentity} · ${grant.decision === 'deny' ? 'always denied' : 'always allowed'}`}
              badge={
                <Button
                  label="Revoke"
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={`Revoke ${grant.appLabel || grant.appIdentity}`}
                  disabled={revoke.isPending}
                  onPress={() =>
                    void confirm({ title: `Revoke ${grant.appLabel || grant.appIdentity}?`, message: 'It asks again the next time the agent needs it.', confirmLabel: 'Revoke' }).then((yes) => {
                      if (yes) revoke.mutate(grant);
                    })
                  }
                />
              }
            />
          ))}
        </ListSection>
      ) : null}
    </ScrollView>
  );
}
