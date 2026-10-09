// MB-38 ScopeRequestCard (MScopeRequest, MD-30, MD-50, MDF-124): the in-page permission card — `rounded-card-lg`,
// `bg-raised`, 1px `border-line`, a neutral `bg-selected` header with the lock and "This device can't <verb>", the
// body, the scopes it lacks (label, mono id, a neutral "Sensitive" badge with the warning glyph), the inline stepper
// "1 Request › 2 Admin approves › 3 <Verb>", and "Check again" + "Request access" (→ the scope request sheet with
// these scopes). States: not requested, pending ("Waiting for an admin · requested 3m ago"), denied ("Request
// denied" + "Request again"), granted (the card disappears). A scope this device may not ask for (admin:* on a
// non-admin device) says an admin grants it from a trusted device instead.
import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useMyScopeRequests } from '../../services/api/scopeRequests';
import { useAuth } from '../../services/auth/AuthProvider';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { Stepper } from '../../ui/layout/Stepper';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Icon } from '../../ui/primitives/Icon';
import { Text } from '../../ui/primitives/Text';
import { scopeRequestHref } from '../shell/hrefs';
import { agoLabel, scopeRequestState, scopeRows } from './scopeRequestModel';

type Href = Parameters<typeof router.push>[0];

export interface ScopeRequestCardProps {
  /** "edit workflows" — completes "This device can't …" and the third step. */
  verb: string;
  scopes: ReadonlyArray<string>;
  body?: string;
  testID?: string;
}

export function ScopeRequestCard({ verb, scopes, body, testID = 'scope-request-card' }: ScopeRequestCardProps): React.ReactElement | null {
  const granted = useGrantedScopes();
  const { refreshPermissions } = useAuth();
  const mine = useMyScopeRequests();
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const state = scopeRequestState(scopes, granted, mine.data);
  if (state.kind === 'granted') return null;
  const rows = scopeRows(scopes, granted);
  const askable = rows.filter((r) => r.requestable).map((r) => r.scope);
  const Verb = verb.charAt(0).toUpperCase() + verb.slice(1);
  const check = (): void => {
    setChecking(true);
    setNow(Date.now());
    void Promise.all([refreshPermissions().catch(() => undefined), mine.refetch()]).finally(() => setChecking(false));
  };
  const request = (): void => router.push(scopeRequestHref(askable) as Href);

  return (
    <View className="overflow-hidden rounded-card-lg border border-line bg-raised" testID={testID}>
      <View className="min-h-row flex-row items-center gap-2 bg-selected px-4">
        <Icon concept="lock" size={18} tone="fg-2" />
        <Text role="headline" weight={600} className="flex-1">
          This device can't {verb}
        </Text>
      </View>
      <View className="gap-3 p-4">
        {body ? (
          <Text role="subhead" tone="fg-2">
            {body}
          </Text>
        ) : null}
        <View className="gap-1">
          {rows.map((r) => (
            <View accessibilityRole="text" key={r.scope} className="min-h-item flex-row items-center gap-2" accessible accessibilityLabel={`${r.label}, ${r.scope}${r.sensitive ? ', sensitive' : ''}`}>
              <Text role="body">{r.label}</Text>
              {r.sensitive ? <Badge label="Sensitive" icon="warning" tone="outline" size="sm" /> : null}
              <View className="flex-1" />
              <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
                {r.scope}
              </Text>
            </View>
          ))}
        </View>
        {state.kind === 'pending' ? (
          <View className="flex-row items-center gap-1.5" testID={`${testID}-pending`}>
            <Icon concept="hourglass" size={14} tone="warn" />
            <Text role="footnote" tone="fg-2" className="flex-1">
              Waiting for an admin · requested {agoLabel(state.request.createdAt, now)} ago
            </Text>
          </View>
        ) : state.kind === 'denied' ? (
          <View className="flex-row items-center gap-1.5" testID={`${testID}-denied`}>
            <Icon concept="x" size={14} tone="err" />
            <Text role="footnote" tone="fg-2" className="flex-1">
              Request denied{state.request.resolutionNote ? `: ${state.request.resolutionNote}` : ''}
            </Text>
          </View>
        ) : (
          <Stepper variant="inline" steps={[{ id: 'request', label: 'Request' }, { id: 'approve', label: 'Admin approves' }, { id: 'use', label: Verb }]} current={0} done={[]} />
        )}
        {askable.length === 0 ? (
          <Text role="footnote" tone="fg-3">
            An admin grants this from a trusted device in Settings › Security.
          </Text>
        ) : null}
        <View className="flex-row items-center justify-between gap-3">
          <Button label="Check again" variant="ghost" size="sm" loading={checking} onPress={check} testID={`${testID}-check`} />
          {askable.length && state.kind !== 'pending' ? <Button label={state.kind === 'denied' ? 'Request again' : 'Request access'} icon="upload" variant="secondary" size="sm" onPress={request} testID={`${testID}-request`} /> : null}
        </View>
      </View>
    </View>
  );
}
