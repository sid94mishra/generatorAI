// ────────────────────────────────────────────────────────────────
// EditScopesSheet — change what another paired device may do.
//
// Presets first (the four names the desktop uses), then every scope as a
// switch grouped Read / Act / Sensitive. Scopes this phone does not hold are
// shown but disabled: the server refuses to grant beyond the caller's own
// authority, and a disabled switch with a reason beats a 403 after Save.
//
// Adding any sensitive scope requires a biometric step-up before the PUT;
// withdrawing never does. Rules live in `deviceAdmin.ts`.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { SCOPE_PRESETS, groupScopes, matchScopePreset } from '../../auth/scopePresets';
import { describeScope, isSensitiveScope } from '../../auth/scopeLabels';
import { requireStepUp } from '../../auth/stepUp';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Switch } from '../ui/Form';
import { Sheet } from '../ui/Sheet';
import {
  applyPreset,
  canGrantScope,
  diffScopes,
  editableScopeList,
  sameScopes,
  sensitiveAdditions,
  toggleScope,
} from './deviceAdmin';

export interface EditableDevice {
  deviceId: string;
  deviceName: string;
  scopes: string[];
}

export function EditScopesSheet({
  device,
  callerScopes,
  isThisDevice,
  onClose,
  onSave,
}: {
  device: EditableDevice | null;
  /** This phone's own scopes — the ceiling of what it may grant. */
  callerScopes: readonly string[];
  isThisDevice: boolean;
  onClose: () => void;
  /** Performs the PUT. Throwing keeps the sheet open. */
  onSave: (device: EditableDevice, scopes: string[]) => Promise<void>;
}): React.ReactElement | null {
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(device ? [...device.scopes] : []);
  }, [device]);

  const groups = useMemo(
    () => (device ? groupScopes(editableScopeList(device.scopes), isSensitiveScope) : []),
    [device],
  );
  const preset = matchScopePreset(draft);
  const diff = device ? diffScopes(device.scopes, draft) : { added: [], removed: [] };
  const dirty = device ? !sameScopes(device.scopes, draft) : false;
  const losesAdmin = isThisDevice && diff.removed.includes('admin:devices');

  if (!device) return null;

  const save = async (): Promise<void> => {
    const risky = sensitiveAdditions(device.scopes, draft, isSensitiveScope);
    if (risky.length > 0 && !(await requireStepUp(`Confirm granting ${device.deviceName} more access`))) return;
    setSaving(true);
    try {
      await onSave(device, draft);
      onClose();
    } catch {
      // The caller toasts the error; keep the draft so nothing is lost.
    } finally {
      setSaving(false);
    }
  };

  const summary = [
    diff.added.length ? `+${diff.added.length} granted` : null,
    diff.removed.length ? `−${diff.removed.length} withdrawn` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Access for ${device.deviceName}`}
      persistent={saving}
      keyboardAware={false}
      action={
        <Button
          label="Save"
          size="sm"
          disabled={!dirty}
          loading={saving}
          accessibilityLabel={`Save access for ${device.deviceName}`}
          onPress={() => void save()}
        />
      }
    >
      <View className="gap-4 px-4 pb-6">
        <View className="gap-2">
          <Text className="text-sm font-semibold text-muted-foreground">Preset</Text>
          <View className="flex-row flex-wrap gap-2">
            {SCOPE_PRESETS.map((p) => (
              <Chip
                key={p.id}
                label={p.label}
                selected={preset?.id === p.id}
                tone="accent"
                accessibilityHint={p.hint}
                onPress={() => setDraft(applyPreset(p, device.scopes, callerScopes))}
              />
            ))}
          </View>
          <Text className="text-sm text-muted-foreground">
            {preset ? preset.hint : 'Custom — a mix that does not match a preset.'}
          </Text>
        </View>

        {groups.map((group) => (
          <View key={group.id} className="gap-1">
            <Text
              accessibilityRole="header"
              className={`text-sm font-semibold ${group.id === 'sensitive' ? 'text-warning' : 'text-muted-foreground'}`}
            >
              {group.title}
            </Text>
            {group.scopes.map((scope) => {
              const on = draft.includes(scope);
              const locked = !on && !canGrantScope(callerScopes, scope);
              return (
                <View key={scope} className="min-h-12 flex-row items-center gap-3 py-1">
                  <View className="flex-1">
                    <Text className={`text-sm ${locked ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {describeScope(scope)}
                    </Text>
                    <Text className="font-mono text-xs text-muted-foreground">
                      {scope}
                      {locked ? ' · this phone does not hold it' : ''}
                    </Text>
                  </View>
                  <Switch
                    value={on}
                    disabled={locked || saving}
                    accessibilityLabel={`${describeScope(scope)}${locked ? ', not grantable from this phone' : ''}`}
                    onValueChange={(next) => setDraft((prev) => toggleScope(prev, scope, next, callerScopes))}
                  />
                </View>
              );
            })}
          </View>
        ))}

        {summary ? <Text className="text-sm text-muted-foreground">{summary}</Text> : null}
        {losesAdmin ? (
          <View className="rounded-2xl border border-warning bg-warning-muted p-3">
            <Text className="text-sm text-foreground">
              This is the phone you are holding. Withdrawing “Pair and revoke other devices” means it can no
              longer open this editor.
            </Text>
          </View>
        ) : null}
        <Text className="text-sm text-muted-foreground">
          Changes apply to that device’s next request. Granting anything sensitive asks you to confirm
          with Face ID, fingerprint or your passcode.
        </Text>
      </View>
    </Sheet>
  );
}
