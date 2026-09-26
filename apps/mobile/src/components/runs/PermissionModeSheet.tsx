// ────────────────────────────────────────────────────────────────
// PermissionModeSheet — flip a live run's tool-permission mode.
//
// A chip on the run screen opens this picker. Tightening applies at once;
// loosening (fewer prompts — e.g. to auto-approve) asks first, because it
// lets running agents act without anyone looking. The option list itself
// (`PermissionModeOptions`) is also the start-run sheet's picker.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ShieldAlert, ShieldCheck } from 'lucide-react-native';

import { ConfirmSheet } from '../ui/ActionSheet';
import { Chip } from '../ui/Chip';
import { Sheet, SheetRow } from '../ui/Sheet';
import { useTheme } from '../../theme/ThemeProvider';
import {
  RUN_PERMISSION_MODES,
  RUN_PERMISSION_MODE_DETAIL,
  RUN_PERMISSION_MODE_LABEL,
  isLoosening,
  permissionModeTone,
  type RunPermissionMode,
} from './permissionMode';

/** The chip that shows the current mode and opens the picker. */
export function PermissionModeChip({
  mode,
  onPress,
  disabled,
}: {
  mode: RunPermissionMode;
  onPress: () => void;
  disabled?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const tone = permissionModeTone(mode);
  const Icon = tone === 'warning' ? ShieldAlert : ShieldCheck;
  return (
    <Chip
      label={RUN_PERMISSION_MODE_LABEL[mode]}
      icon={<Icon size={14} color={tone === 'warning' ? colors.warning : colors['muted-foreground']} />}
      selected={tone === 'warning'}
      tone={tone === 'warning' ? 'warning' : 'neutral'}
      size="sm"
      showChevron={!disabled}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={`Permissions: ${RUN_PERMISSION_MODE_LABEL[mode]}`}
      accessibilityHint={disabled ? undefined : 'Changes how this run asks before using tools'}
    />
  );
}

/** The modes, strictest first, as sheet rows. `current: null` = none chosen yet. */
export function PermissionModeOptions({
  current,
  onChoose,
}: {
  current: RunPermissionMode | null;
  onChoose: (mode: RunPermissionMode) => void;
}): React.ReactElement {
  return (
    <>
      {RUN_PERMISSION_MODES.map((mode) => (
        <SheetRow
          key={mode}
          title={RUN_PERMISSION_MODE_LABEL[mode]}
          subtitle={RUN_PERMISSION_MODE_DETAIL[mode]}
          selected={mode === current}
          onPress={() => onChoose(mode)}
        />
      ))}
    </>
  );
}

export function PermissionModeSheet({
  visible,
  onClose,
  current,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  current: RunPermissionMode;
  onChange: (next: RunPermissionMode) => void;
}): React.ReactElement {
  const [pending, setPending] = useState<RunPermissionMode | null>(null);

  const choose = (next: RunPermissionMode): void => {
    if (next === current) {
      onClose();
      return;
    }
    if (isLoosening(current, next)) {
      setPending(next);
      return;
    }
    onChange(next);
    onClose();
  };

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Permissions" fitContent detents={[0.55]}>
        <View className="pb-6">
          <Text className="px-4 pb-2 text-sm text-muted-foreground">
            How this run's agents ask before using tools. Takes effect on their next tool call.
          </Text>
          <PermissionModeOptions current={current} onChoose={choose} />
        </View>
      </Sheet>
      <ConfirmSheet
        visible={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? `Switch to ${RUN_PERMISSION_MODE_LABEL[pending]}?` : 'Loosen permissions?'}
        message={
          pending
            ? `${RUN_PERMISSION_MODE_DETAIL[pending]} Running agents will ask you less from now on.`
            : undefined
        }
        confirmLabel="Loosen permissions"
        onConfirm={() => {
          if (pending) onChange(pending);
          setPending(null);
          onClose();
        }}
      />
    </>
  );
}
