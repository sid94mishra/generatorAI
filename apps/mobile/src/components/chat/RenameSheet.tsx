// ────────────────────────────────────────────────────────────────
// RenameSheet — a single-field edit.
//
// A sheet rather than `Alert.prompt` because that only exists on iOS, and
// rather than a full screen because renaming is not worth a navigation. It
// fits its content, so the keyboard and the field are the whole surface.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Sheet } from '../ui/Sheet';
import { Field } from '../ui/Form';
import { Button } from '../ui/Button';

export function RenameSheet({
  visible,
  title,
  label = 'Name',
  initialValue,
  busy = false,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  label?: string;
  initialValue: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}): React.ReactElement | null {
  const [value, setValue] = useState(initialValue);

  // Re-seeded on open rather than on mount: the sheet stays mounted between
  // targets, so without this the second rename starts on the first one's text.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const trimmed = value.trim();

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={onClose} title={title} detents={[0.4]} fitContent>
      <View className="gap-4 px-4 pt-4">
        <Field
          label={label}
          value={value}
          onChangeText={setValue}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => trimmed && onSubmit(trimmed)}
          error={trimmed.length === 0 ? 'A name is required.' : null}
        />
        <Button
          label="Save"
          full
          loading={busy}
          disabled={trimmed.length === 0 || trimmed === initialValue}
          onPress={() => onSubmit(trimmed)}
        />
      </View>
    </Sheet>
  );
}
