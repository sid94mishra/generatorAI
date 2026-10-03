// Request access (MScopeRequest, MDF-124, MD-30; `/scope-request?scopes=<ids>&reason=`, a route sheet): the scopes
// the opening screen needs, ticked, then the others this device could ask for; each with its label, mono id and a
// neutral "Sensitive" badge; admin:* on a non-admin device is shown but not requestable ("an admin grants it from a
// trusted device"). An optional reason (pre-filled from the screen that sent you), the three steps, and one footer
// primary "Request access" (MD-85). States: sending, pending (requested … ago + Check again / Cancel request),
// granted (Done), denied (the note + ask again), a server without the route (404), already pending (409), refused.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { ApiError } from '@generatorai/client-core';
import { isSensitiveScope, scopeLabel } from '@generatorai/shared/ui-contract';

import { agoLabel, requestable, scopeRequestState } from '../../blocks/ScopeRequestCard';
import { useCancelScopeRequest, useCreateScopeRequest, useMyScopeRequests } from '../../services/api/scopeRequests';
import { useAuth } from '../../services/auth/AuthProvider';
import { UNSUPPORTED_MESSAGE, missingGrantableScopes, scopeRequestBody, scopeRequestOutcome } from '../../services/auth/scopeRequests';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Stepper } from '../../ui/layout/Stepper';
import { RouteSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { nouns } from '../../ui/platform/nouns';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';

type Href = Parameters<typeof router.replace>[0];

function parseScopes(raw: string | string[] | undefined): string[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return [...new Set(list.flatMap((s) => s.split(',')).map((s) => decodeURIComponent(s).trim()).filter(Boolean))];
}

export default function ScopeRequestScreen(): React.ReactElement {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ scopes?: string | string[]; reason?: string }>();
  const { refreshPermissions } = useAuth();
  const granted = useGrantedScopes();
  const mine = useMyScopeRequests();
  const create = useCreateScopeRequest();
  const cancel = useCancelScopeRequest();
  const asked = useMemo(() => parseScopes(params.scopes), [params.scopes]);
  const others = useMemo(() => missingGrantableScopes(granted).map((m) => m.scope).filter((s) => !asked.includes(s)), [granted, asked]);
  const candidates = useMemo(() => [...asked.filter((s) => !granted.includes(s)), ...others], [asked, others, granted]);
  const [picked, setPicked] = useState<string[]>(() => asked.filter((s) => !granted.includes(s) && requestable(s, granted)));
  const [reason, setReason] = useState(() => (typeof params.reason === 'string' ? params.reason : ''));
  const [error, setError] = useState<{ title: string; body?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const device = nouns().device;
  const state = scopeRequestState(asked.length ? asked : candidates, granted, mine.data);

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings/security' as Href);
  };
  const check = (): void => {
    setChecking(true);
    setNow(Date.now());
    void Promise.all([refreshPermissions().catch(() => undefined), mine.refetch()]).finally(() => setChecking(false));
  };
  const send = (): void => {
    const body = scopeRequestBody(picked, reason);
    if (!body) return;
    setError(null);
    create.mutate(body, {
      onSuccess: () => {
        haptic('success');
        void mine.refetch();
      },
      onError: (e) => {
        haptic('error');
        const outcome = e instanceof ApiError ? scopeRequestOutcome(e.status) : { kind: 'failed' as const, status: 0 };
        if (outcome.kind === 'unsupported') setError({ title: 'Your server needs an update', body: UNSUPPORTED_MESSAGE });
        else if (outcome.kind === 'pending') {
          setError({ title: 'A request from this device is already waiting' });
          void mine.refetch();
        } else if (outcome.kind === 'forbidden') setError({ title: "This device can't ask for that", body: e instanceof Error ? e.message : undefined });
        else setError({ title: "Couldn't send the request", body: e instanceof Error ? e.message : undefined });
      },
    });
  };

  if (asked.length && state.kind === 'granted') {
    return (
      <RouteSheet title="Request access" onDismiss={close} navigation={navigation as never} footer={<Button label="Done" size="lg" fullWidth onPress={close} />} testID="scope-request">
        <EmptyState icon="check" title="Granted" description={`This ${device} can now ${asked.map(scopeLabel).join(', ').toLowerCase()}.`} />
      </RouteSheet>
    );
  }

  if (state.kind === 'pending') {
    const r = state.request;
    return (
      <RouteSheet title="Request access" onDismiss={close} navigation={navigation as never} footer={<Button label="Check again" size="lg" fullWidth loading={checking} onPress={check} testID="scope-request-check" />} testID="scope-request">
        <View className="gap-4">
          <Callout tone="info" title="Waiting for an admin" body={`Requested ${agoLabel(r.createdAt, now)} ago. An admin approves it on a trusted device; nothing changes until then.`} testID="scope-request-pending" />
          <ListSection title="Asked for">
            {r.scopes.map((s) => (
              <ListRow key={s} kind="info" title={scopeLabel(s)} value={s} mono />
            ))}
          </ListSection>
          <Stepper variant="inline" steps={[{ id: 'request', label: 'Request' }, { id: 'approve', label: 'Admin approves' }, { id: 'use', label: 'Use it' }]} current={1} done={[0]} />
          <Button label="Cancel request" variant="ghost" loading={cancel.isPending} onPress={() => cancel.mutate(r.requestId)} testID="scope-request-cancel" />
        </View>
      </RouteSheet>
    );
  }

  return (
    <RouteSheet
      title="Request access"
      onDismiss={close}
      scrollable
      navigation={navigation as never}
      footer={candidates.length ? <Button label={picked.length > 1 ? `Request ${picked.length} permissions` : 'Request access'} icon="upload" size="lg" fullWidth loading={create.isPending} disabled={picked.length === 0} {...(picked.length === 0 ? { disabledReason: 'Pick at least one permission.' } : {})} onPress={send} testID="scope-request-send" /> : undefined}
      testID="scope-request"
    >
      {candidates.length === 0 ? (
        <EmptyState icon="check" title="Nothing to request" description={`This ${device} already holds every permission a ${device} can ask for.`} />
      ) : (
        <View className="gap-4">
          {state.kind === 'denied' ? <Callout tone="warn" title="Your last request was denied" {...(state.request.resolutionNote ? { body: state.request.resolutionNote } : {})} testID="scope-request-denied" /> : null}
          <Text role="subhead" tone="fg-2">
            Pick what this {device} needs. An admin approves it on a trusted device.
          </Text>
          <ListSection>
            {candidates.map((s) => {
              const ok = requestable(s, granted);
              return (
                <ListRow
                  key={s}
                  kind="check"
                  title={scopeLabel(s)}
                  subtitle={ok ? s : `${s} · an admin grants it from a trusted device`}
                  selected={picked.includes(s)}
                  disabled={!ok}
                  {...(isSensitiveScope(s) ? { badge: <Badge label="Sensitive" icon="warning" tone="outline" size="sm" /> } : {})}
                  onPress={() => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))}
                  testID={`scope-request-${s}`}
                />
              );
            })}
          </ListSection>
          <Textarea label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="What you need it for" minRows={2} testID="scope-request-reason" />
          <Stepper variant="inline" steps={[{ id: 'request', label: 'Request' }, { id: 'approve', label: 'Admin approves' }, { id: 'use', label: 'Use it' }]} current={0} done={[]} />
          {error ? <Callout tone="err" title={error.title} {...(error.body ? { body: error.body } : {})} testID="scope-request-error" /> : null}
        </View>
      )}
    </RouteSheet>
  );
}
