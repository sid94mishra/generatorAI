// ────────────────────────────────────────────────────────────────
// PairDeviceSheet — invite another device from the phone (admin:devices).
//
// Two steps in one sheet:
//   1. Name, kind and access preset → POST /api/auth/pair.
//   2. The invite: a QR of `pairingUrl` (what the phone scanner and desktop
//      "scan" flows read), the short code + join address to type instead,
//      a Share action, and a ticking expiry. At zero the invite is dropped
//      from the screen — a code that no longer works must not stay visible.
//
// Minting an invite hands out authority, so it takes a biometric step-up.
// Presets beyond this phone's own scopes are disabled (the server refuses
// them). Mirrors the desktop flow in apps/web …/settings/sections/Security.tsx.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import { Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, Share2 } from 'lucide-react-native';

import { useAuth } from '../../auth/AuthProvider';
import { SCOPE_PRESETS, type ScopePresetId } from '../../auth/scopePresets';
import { requireStepUp } from '../../auth/stepUp';
import { Button, IconButton } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Form';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { useTheme } from '../../theme/ThemeProvider';
import { QrCode } from './QrCode';
import {
  createPairingRequest,
  formatCountdown,
  parsePairingInvite,
  presetWithinAuthority,
  secondsRemaining,
  type PairingInvite,
  type PairingPlatform,
} from './deviceAdmin';

const PLATFORMS: Array<{ value: PairingPlatform; label: string }> = [
  { value: 'mobile', label: 'Phone' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'web', label: 'Browser' },
  { value: 'cli', label: 'CLI' },
];

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    if (typeof body.error === 'string') return body.error;
    if (body.error?.message) return body.error.message;
  } catch {
    // fall through
  }
  return `Request failed (${res.status})`;
}

export function PairDeviceSheet({
  visible,
  callerScopes,
  onClose,
  onChanged,
}: {
  visible: boolean;
  callerScopes: readonly string[];
  onClose: () => void;
  /** An invite was created or cancelled — refresh the device list. */
  onChanged: () => void;
}): React.ReactElement | null {
  const { fetch: authFetch } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<PairingPlatform>('mobile');
  const [presetId, setPresetId] = useState<ScopePresetId>('companion');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<PairingInvite | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!invite) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [invite]);

  const remaining = invite ? secondsRemaining(invite.expiresAt, now) : 0;
  useEffect(() => {
    if (invite && remaining === 0) {
      setInvite(null);
      toast({ message: 'The pairing code expired.', variant: 'warning' });
      onChanged();
    }
  }, [invite, remaining, toast, onChanged]);

  const close = useCallback(() => {
    setInvite(null);
    onClose();
  }, [onClose]);

  const create = useCallback(async () => {
    const preset = SCOPE_PRESETS.find((p) => p.id === presetId);
    if (!(await requireStepUp('Confirm creating a pairing code'))) return;
    setBusy(true);
    try {
      const { path, init } = createPairingRequest({
        deviceName: name,
        platform,
        ...(preset ? { scopes: preset.scopes } : {}),
      });
      const res = await authFetch(path, init);
      if (!res.ok) throw new Error(await errorMessage(res));
      const parsed = parsePairingInvite(await res.json());
      if (!parsed) throw new Error('The server returned an unreadable pairing code.');
      setNow(Date.now());
      setInvite(parsed);
      onChanged();
    } catch (err) {
      toast({
        message: `Could not create a pairing code: ${err instanceof Error ? err.message : String(err)}`,
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }, [authFetch, name, platform, presetId, toast, onChanged]);

  const cancelInvite = useCallback(async () => {
    if (!invite) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/auth/pair/${encodeURIComponent(invite.grantId)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res));
      setInvite(null);
      onChanged();
      toast({ message: 'Pairing code cancelled.', variant: 'success' });
    } catch (err) {
      toast({ message: `Could not cancel: ${err instanceof Error ? err.message : String(err)}`, variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [authFetch, invite, onChanged, toast]);

  const copy = useCallback(
    async (text: string, what: string) => {
      await Clipboard.setStringAsync(text);
      toast({ message: `${what} copied.`, variant: 'success' });
    },
    [toast],
  );

  const share = useCallback(async () => {
    if (!invite) return;
    try {
      await Share.share({
        message: `Pair with GeneratorAI: open ${invite.joinUrl} and enter ${invite.shortCode} (expires in ${formatCountdown(remaining)}).\n\n${invite.pairingUrl}`,
      });
    } catch {
      // No share target (web preview without navigator.share): copy instead.
      await copy(invite.pairingUrl, 'Pairing link');
    }
  }, [invite, remaining, copy]);

  if (!visible) return null;

  return (
    <Sheet visible onClose={close} title={invite ? 'Pairing code' : 'Pair a device'} persistent={busy}>
      {invite ? (
        <View className="items-center gap-4 px-4 pb-6">
          <QrCode value={invite.pairingUrl} accessibilityLabel="Pairing QR code — scan it on the new device" />
          <Text
            accessibilityLiveRegion={remaining <= 10 ? 'polite' : 'none'}
            className={`text-sm ${remaining <= 30 ? 'text-warning' : 'text-muted-foreground'}`}
          >
            Expires in {formatCountdown(remaining)}
          </Text>

          <View className="w-full gap-2">
            <Text className="text-sm text-muted-foreground">Or, on the new device, open</Text>
            <View className="flex-row items-center gap-2">
              <Text selectable numberOfLines={1} className="flex-1 rounded-2xl bg-raised px-3 py-2.5 font-mono text-sm text-foreground">
                {invite.joinUrl}
              </Text>
              <IconButton
                accessibilityLabel="Copy address"
                icon={<Copy size={18} color={colors.foreground} />}
                onPress={() => void copy(invite.joinUrl, 'Address')}
              />
            </View>
            <Text className="text-sm text-muted-foreground">and enter</Text>
            <View className="flex-row items-center gap-2">
              <Text
                selectable
                accessibilityLabel={`Pairing code ${invite.shortCode.split('').join(' ')}`}
                className="flex-1 rounded-2xl bg-raised px-3 py-3 text-center font-mono text-2xl font-semibold tracking-widest text-foreground"
              >
                {invite.shortCode}
              </Text>
              <IconButton
                accessibilityLabel="Copy pairing code"
                icon={<Copy size={18} color={colors.foreground} />}
                onPress={() => void copy(invite.shortCode, 'Code')}
              />
            </View>
            <Text className="text-sm text-muted-foreground">
              {invite.requestedScopes.length} permission{invite.requestedScopes.length === 1 ? '' : 's'} · works once
            </Text>
          </View>

          <View className="w-full gap-2">
            <Button
              label="Share link"
              variant="secondary"
              full
              icon={<Share2 size={16} color={colors.foreground} />}
              onPress={() => void share()}
            />
            <Button label="Cancel code" variant="ghost" full loading={busy} onPress={() => void cancelInvite()} />
          </View>
        </View>
      ) : (
        <View className="gap-4 px-4 pb-6">
          <Field
            label="Device name"
            placeholder="e.g. Work laptop"
            value={name}
            onChangeText={setName}
            maxLength={64}
            autoCapitalize="words"
            returnKeyType="done"
          />

          <View className="gap-2">
            <Text className="text-sm font-medium text-foreground">Kind of device</Text>
            <View className="flex-row flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <Chip key={p.value} label={p.label} tone="accent" selected={platform === p.value} onPress={() => setPlatform(p.value)} />
              ))}
            </View>
          </View>

          <View className="gap-2">
            <Text className="text-sm font-medium text-foreground">Access</Text>
            <View className="flex-row flex-wrap gap-2">
              {SCOPE_PRESETS.map((p) => {
                const allowed = presetWithinAuthority(p, callerScopes);
                return (
                  <Chip
                    key={p.id}
                    label={p.label}
                    tone="accent"
                    selected={presetId === p.id}
                    disabled={!allowed}
                    accessibilityHint={allowed ? p.hint : 'This phone does not hold every permission in this preset'}
                    onPress={() => setPresetId(p.id)}
                  />
                );
              })}
            </View>
            <Text className="text-sm text-muted-foreground">
              {SCOPE_PRESETS.find((p) => p.id === presetId)?.hint}
            </Text>
          </View>

          <Button
            label="Create pairing code"
            full
            loading={busy}
            disabled={!presetWithinAuthority(SCOPE_PRESETS.find((p) => p.id === presetId)!, callerScopes)}
            onPress={() => void create()}
          />
          <Text className="text-sm text-muted-foreground">
            The code works once and expires in five minutes. Anyone who has it can pair with the access chosen
            above.
          </Text>
        </View>
      )}
    </Sheet>
  );
}
