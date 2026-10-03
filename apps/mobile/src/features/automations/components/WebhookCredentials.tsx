// Webhook credentials (MAutomationWebhook; NG-02): the URL with the token part hidden (copy), the token
// (X-Webhook-Token) and the signing secret (HMAC-SHA256) masked behind a lock glyph — the server never returns them
// again; "Rotate token & secret" (confirmed, then the one-time reveal in a sheet, never a route, so the secret never
// enters a URL); a sample request; the dataset schema payloads must match. Delivery statistics: no API (MD-27).
import React from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { DataFieldDef } from '@generatorai/shared';

import { useAuth } from '../../../services/auth/AuthProvider';
import { useSecretReveal } from '../../../services/native/privacy';
import { errorText } from '../../../ui/lib/format';
import { confirm } from '../../../ui/native/AlertDialog';
import { useSheet } from '../../../ui/native/Sheet';
import { haptic } from '../../../ui/platform/haptics';
import { Button } from '../../../ui/primitives/Button';
import { Callout } from '../../../ui/primitives/Callout';
import { Card } from '../../../ui/primitives/Card';
import { Icon } from '../../../ui/primitives/Icon';
import { IconButton } from '../../../ui/primitives/IconButton';
import { Separator } from '../../../ui/primitives/Separator';
import { Text } from '../../../ui/primitives/Text';
import { toast } from '../../../ui/primitives/Toast';
import { curlSample, webhookUrl } from '../model/automationsModel';
import { useAutomationWrites } from '../queries';

/** The one-time reveal: token and secret with copy; gone once the sheet closes. No screenshots, no auto-lock (M9-09). */
export function RevealCredentials({ token, secret, onDone }: { token: string; secret?: string | undefined; onDone: () => void }): React.ReactElement {
  useSecretReveal(true);
  const copy = (value: string): void => {
    void Clipboard.setStringAsync(value).then(() => haptic('success'));
  };
  return (
    <View className="gap-3 pb-4">
      <Callout tone="warn" title="Shown once. Copy them now: closing this sheet hides them for good; rotate to get a new pair." />
      {[
        { label: 'Token · X-Webhook-Token', value: token },
        ...(secret ? [{ label: 'Signing secret · HMAC-SHA256', value: secret }] : []),
      ].map((row) => (
        <View key={row.label} className="gap-1">
          <Text role="caption" tone="fg-3">
            {row.label}
          </Text>
          <View className="flex-row items-center gap-2 rounded-card bg-sunken p-3">
            <Text role="monoSm" selectable className="flex-1">
              {row.value}
            </Text>
            <IconButton icon="copy" size="sm" label={`Copy ${row.label}`} onPress={() => copy(row.value)} />
          </View>
        </View>
      ))}
      <Button label="Done" variant="primary" size="lg" fullWidth onPress={onDone} testID="webhook-reveal-done" />
    </View>
  );
}

export function WebhookCredentials({ automationId, fields, canEdit }: { automationId: string; fields: readonly DataFieldDef[]; canEdit: boolean }): React.ReactElement {
  const { endpoint } = useAuth();
  const writes = useAutomationWrites();
  const sheet = useSheet();
  const url = webhookUrl(endpoint);
  const sample = curlSample(fields);
  const rotate = (): void =>
    void confirm({ title: 'Rotate token & secret?', message: 'The current token and secret stop working at once; every sender needs the new pair.', confirmLabel: 'Rotate', destructive: true, requireStepUp: true }).then((ok) => {
      if (!ok) return;
      writes
        .rotate(automationId)
        .then((r) => sheet.present(<RevealCredentials token={r.token} secret={r.signingSecret} onDone={() => sheet.dismiss()} />, { title: 'New webhook credentials', detents: ['large'] }))
        .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
    });
  const masked = (label: string): React.ReactElement => (
    <View className="flex-row items-center gap-2 px-4 py-3" accessible accessibilityLabel={`${label}, hidden`}>
      <View className="flex-1 gap-0.5">
        <Text role="caption" tone="fg-3">
          {label}
        </Text>
        <Text role="monoSm" tone="fg-3">
          ••••••••••••••••
        </Text>
      </View>
      <Icon concept="lock" size={16} tone="fg-3" />
    </View>
  );
  return (
    <View className="gap-2" testID="webhook-credentials">
      <View className="flex-row items-center justify-between px-4">
        <Text role="subhead" weight={600}>
          Webhook credentials
        </Text>
        {canEdit ? <Button label="Rotate token & secret" icon="refresh" size="sm" variant="ghost" onPress={rotate} testID="webhook-rotate" /> : null}
      </View>
      <View className="px-4">
        <Card radius="group" padding="none">
          <View className="p-3">
            <Callout tone="warn" title="Shown once at creation. Rotate to get a new pair; the old one stops working." />
          </View>
          <View className="flex-row items-center gap-2 px-4 py-3">
            <View className="flex-1 gap-0.5">
              <Text role="caption" tone="fg-3">
                Webhook URL · token part hidden
              </Text>
              <Text role="monoSm" numberOfLines={1} ellipsizeMode="middle">
                {url}
              </Text>
            </View>
            <IconButton icon="copy" size="sm" label="Copy URL (no token)" onPress={() => void Clipboard.setStringAsync(url).then(() => haptic('success'))} />
          </View>
          <Separator />
          {masked('Token · X-Webhook-Token')}
          <Separator />
          {masked('Signing secret · HMAC-SHA256')}
          <View className="m-3 gap-2 rounded-card bg-sunken p-3">
            <View className="flex-row items-center justify-between">
              <Text role="caption" tone="fg-3">
                Sample request · unsigned requests are rejected
              </Text>
              <Button label="Copy" icon="copy" size="sm" variant="ghost" onPress={() => void Clipboard.setStringAsync(sample).then(() => haptic('success'))} />
            </View>
            <Text role="monoSm" tone="fg-2" selectable>
              {sample}
            </Text>
          </View>
          {fields.length ? (
            <View className="flex-row gap-2 px-4 pb-3">
              <Icon concept="database" size={14} tone="fg-3" />
              <Text role="footnote" tone="fg-3" className="flex-1">
                {`Payloads must match the dataset schema (${fields.map((f) => `${f.name}: ${f.type}`).join(', ')}); unknown fields are rejected.`}
              </Text>
            </View>
          ) : null}
        </Card>
      </View>
    </View>
  );
}
