// ────────────────────────────────────────────────────────────────
// ComputerPane — watch computer use, answer for it. Never drive it.
//
// Web's ComputerPanel (apps/web/src/components/chat/ComputerPanel.tsx) is a
// live preview, replay player, runtime and recording controls. A phone gets
// the parts that are about DECIDING, not operating:
//
//   consent card   the agent is waiting on "may I click in <app>?" — the one
//                  thing here that blocks a run. Allowing is behind the
//                  biometric step-up; denying never is.
//   latest frame   the newest window capture (never the whole screen),
//                  read-only, refreshed while the pane is on screen
//   activity       the audit trail, newest first
//   grants         standing "always allow" answers, each revocable
//
// All reads and writes are `exec:computer` (routePolicy); without it the
// session renders `LockedPane` instead of this.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Hand, Keyboard, Monitor, ShieldQuestion } from 'lucide-react-native';
import { ApiError } from '@generatorai/client-core';

import { Button } from '../../ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../ui/States';
import { Badge, SectionHeader } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { haptics } from '../../ui/haptics';
import { useApi } from '../../../services/api/useApi';
import { useAdminApi } from '../../../services/api/useAdminApi';
import { StepUpGate } from '../../../services/auth/StepUpGate';
import { requireStepUp } from '../../../services/auth/stepUp';
import { bytesToBase64 } from '../../../services/lib/base64';
import { useTheme } from '../../../theme/ThemeProvider';
import { relativeTime } from '../../runs/formatTime';
import {
  activeConsent,
  activityRows,
  consentOptions,
  secondsLeft,
  tookScreen,
  type ComputerGrant,
  type ConsentDecision,
  type PendingConsent,
} from './computerModel';

/** Shared with `useWorkbench`, which polls it for the Computer tool's live dot. */
export function computerConsentKey(workspaceId: string | null): readonly unknown[] {
  return ['workspaces', workspaceId, 'computer', 'consent'] as const;
}

const POLL_MS = 3_000;

export function ComputerPane({
  workspaceId,
  active = true,
}: {
  workspaceId: string;
  active?: boolean;
}): React.ReactElement {
  return (
    <StepUpGate reason="Confirm viewing computer use" active={active}>
      <ComputerPanel workspaceId={workspaceId} active={active} />
    </StepUpGate>
  );
}

function ComputerPanel({ workspaceId, active }: { workspaceId: string; active: boolean }): React.ReactElement {
  const api = useApi();
  const admin = useAdminApi();
  const { legacyColors: colors } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const interval = active ? POLL_MS : false;

  const consent = useQuery({
    queryKey: computerConsentKey(workspaceId),
    queryFn: () => admin.computer.consent(encodeURIComponent(workspaceId)),
    refetchInterval: interval,
  });
  const frames = useQuery({
    queryKey: ['workspaces', workspaceId, 'computer', 'frames'],
    queryFn: () => api.resources.computerFrames(workspaceId),
    refetchInterval: interval,
  });
  const activity = useQuery({
    queryKey: ['workspaces', workspaceId, 'computer', 'activity'],
    queryFn: () => api.resources.computerActivity(workspaceId),
    refetchInterval: active ? POLL_MS * 2 : false,
  });
  const grants = useQuery({
    queryKey: ['workspaces', workspaceId, 'computer', 'grants'],
    queryFn: async () => ({ grants: await admin.computer.grants(encodeURIComponent(workspaceId)) }),
  });

  const latest = frames.data?.frames?.[0] ?? null;
  // `Image` cannot sign a DPoP request, so the bytes come through the
  // authenticated fetch and are inlined. Keyed by id: an unchanged newest
  // frame is not downloaded again on every poll.
  const frame = useQuery({
    queryKey: ['workspaces', workspaceId, 'computer', 'frame', latest?.id ?? null],
    enabled: Boolean(latest),
    staleTime: Infinity,
    queryFn: async () => {
      const { data, contentType } = await api.resources.computerFrame(workspaceId, latest!.id);
      const mime = contentType === 'application/octet-stream' ? 'image/png' : contentType;
      return `data:${mime};base64,${bytesToBase64(data)}`;
    },
  });

  // The card disappears on its own when the prompt expires (an unanswered
  // prompt IS a denial server-side), not when the next poll notices.
  const [now, setNow] = useState(Date.now());
  const prompt = activeConsent(consent.data?.pending, now);
  useEffect(() => {
    if (!prompt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [prompt]);

  const answer = useMutation({
    mutationFn: async ({ target, decision }: { target: PendingConsent; decision: ConsentDecision }) => {
      const option = consentOptions(target).find((o) => o.decision === decision);
      if (option?.needsStepUp) {
        const ok = await requireStepUp(`Confirm allowing ${target.action} in ${target.appLabel}`);
        if (!ok) return { skipped: true as const };
      }
      try {
        await admin.computer.setConsent(encodeURIComponent(workspaceId), { requestId: target.requestId, appIdentity: target.appIdentity, decision });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) return { gone: true as const };
        throw error;
      }
      return { ok: true as const, decision };
    },
    onSuccess: (out) => {
      if ('skipped' in out) return;
      if ('gone' in out) toast({ message: 'That request is no longer waiting for an answer.', variant: 'info' });
      else {
        haptics.commit();
        if (out.decision === 'always_allow') void grants.refetch();
      }
      void consent.refetch();
    },
    onError: (err) => toast({ message: err instanceof Error ? err.message : 'Could not answer', variant: 'danger' }),
  });

  const revoke = useMutation({
    mutationFn: async (grant: ComputerGrant) => {
      await admin.computer.revokeGrant(encodeURIComponent(workspaceId), grant.appIdentity);
      return grant;
    },
    onSuccess: (grant) => {
      haptics.commit();
      toast({ message: `${grant.appLabel || grant.appIdentity} will ask again.`, variant: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'computer', 'grants'] });
    },
    onError: (err) => toast({ message: err instanceof Error ? err.message : 'Could not revoke', variant: 'danger' }),
  });

  const rows = useMemo(() => activityRows(activity.data?.entries), [activity.data?.entries]);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([consent.refetch(), frames.refetch(), activity.refetch(), grants.refetch()]);
    setRefreshing(false);
  }, [consent, frames, activity, grants]);

  if (frames.isLoading && consent.isLoading) return <LoadingState label="Loading computer use…" />;
  if (frames.isError && consent.isError) {
    return (
      <ErrorState
        title="Computer use unavailable"
        message={frames.error instanceof Error ? frames.error.message : 'The server did not answer.'}
        onRetry={() => void onRefresh()}
      />
    );
  }

  const nothingYet = !prompt && !latest && rows.length === 0;

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      {prompt ? (
        <View
          accessibilityRole="alert"
          className="mt-3 gap-2 rounded-3xl border border-warning bg-warning-muted p-4"
        >
          <View className="flex-row items-start gap-2">
            <ShieldQuestion size={18} color={colors.warning} />
            <View className="flex-1 gap-1">
              <Text className="text-md font-semibold text-foreground">
                Allow {prompt.action} in {prompt.appLabel}?
              </Text>
              {prompt.summary ? <Text className="text-sm text-muted-foreground">{prompt.summary}</Text> : null}
              {tookScreen(prompt.path) ? (
                <View className="flex-row items-center gap-1">
                  <AlertTriangle size={13} color={colors.warning} />
                  <Text className="text-sm text-warning">This takes over the keyboard and mouse on your desktop.</Text>
                </View>
              ) : null}
              <Text className="text-sm text-muted-foreground">Expires in {secondsLeft(prompt, now)}s — no answer is a denial.</Text>
            </View>
          </View>
          <View className="gap-2">
            {consentOptions(prompt).map((option) => (
              <Button
                key={option.decision}
                label={option.label}
                size="md"
                full
                variant={option.tone === 'primary' ? 'primary' : option.tone === 'danger' ? 'danger' : 'secondary'}
                disabled={answer.isPending}
                loading={answer.isPending && answer.variables?.decision === option.decision}
                onPress={() => answer.mutate({ target: prompt, decision: option.decision })}
              />
            ))}
          </View>
        </View>
      ) : null}

      {frames.data?.enabled === false ? (
        <View className="mt-3">
          <Badge label="Computer use is switched off on the server" tone="warning" />
        </View>
      ) : null}

      {nothingYet ? (
        <EmptyState
          icon={<Monitor size={22} color={colors['muted-foreground']} />}
          title="Nothing captured yet"
          message="When the agent reads or operates a window on your desktop, it shows up here."
        />
      ) : null}

      {latest ? (
        <>
          <SectionHeader title={`Latest window · ${relativeTime(latest.createdAt)}`} />
          <View className="overflow-hidden rounded-2xl border border-border bg-canvas-bg">
            {frame.data ? (
              <Image
                accessibilityLabel="The window the agent last captured"
                source={{ uri: frame.data }}
                resizeMode="contain"
                style={{
                  width: '100%',
                  aspectRatio: latest.width && latest.height ? latest.width / latest.height : 16 / 10,
                }}
              />
            ) : (
              <View style={{ aspectRatio: 16 / 10 }} className="items-center justify-center">
                <Text className="text-sm text-muted-foreground">{frame.isError ? 'Frame unavailable' : 'Loading frame…'}</Text>
              </View>
            )}
          </View>
          <Text className="pt-1 text-sm text-muted-foreground">View only — a capture of the target window, never the whole screen.</Text>
        </>
      ) : null}

      {rows.length > 0 ? (
        <>
          <SectionHeader title="Activity" />
          {rows.map((row, i) => (
            <View key={row.key}>
              {i > 0 ? <View className="ml-9 h-px bg-border-muted" /> : null}
              <View className="min-h-12 flex-row items-center gap-3 py-2">
                <View className="w-6 items-center">
                  {row.tone === 'danger' ? (
                    <Ban size={16} color={colors.danger} />
                  ) : row.tone === 'warning' ? (
                    <Keyboard size={16} color={colors.warning} />
                  ) : (
                    <Hand size={16} color={colors['muted-foreground']} />
                  )}
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text numberOfLines={1} className="flex-1 text-md text-foreground">
                      {row.title}
                    </Text>
                    <Text className="text-sm text-muted-foreground">{relativeTime(row.createdAt)}</Text>
                  </View>
                  {row.subtitle ? (
                    <Text numberOfLines={1} className="text-sm text-muted-foreground">
                      {row.subtitle}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          ))}
        </>
      ) : null}

      {(grants.data?.grants?.length ?? 0) > 0 ? (
        <>
          <SectionHeader title="Always allowed in this workspace" />
          {grants.data!.grants!.map((grant, i) => (
            <View key={grant.appIdentity}>
              {i > 0 ? <View className="h-px bg-border-muted" /> : null}
              <View className="min-h-14 flex-row items-center gap-3 py-2">
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-md text-foreground">
                    {grant.appLabel || grant.appIdentity}
                  </Text>
                  <Text numberOfLines={1} className="text-sm text-muted-foreground">
                    {grant.decision === 'deny' ? 'Always denied' : 'Always allowed'} · {grant.scope}
                  </Text>
                </View>
                <Button
                  label="Revoke"
                  size="sm"
                  variant="secondary"
                  accessibilityLabel={`Revoke ${grant.appLabel || grant.appIdentity}`}
                  disabled={revoke.isPending}
                  loading={revoke.isPending && revoke.variables?.appIdentity === grant.appIdentity}
                  onPress={() => revoke.mutate(grant)}
                />
              </View>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
