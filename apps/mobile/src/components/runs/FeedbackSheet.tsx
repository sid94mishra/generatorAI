// ────────────────────────────────────────────────────────────────
// FeedbackSheet — the text a decision carries.
//
// "Request changes" with no text gives the agent nothing to act on, so the
// sheet requires it; an approval's follow-up is optional. The same sheet
// serves both, told apart by `required`.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Field } from '../ui/Form';

export function FeedbackSheet({
  visible,
  onClose,
  title,
  message,
  placeholder,
  submitLabel,
  required,
  busy,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  placeholder: string;
  submitLabel: string;
  required: boolean;
  busy?: boolean;
  onSubmit: (text: string) => void;
}): React.ReactElement {
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const trimmed = text.trim();
  const blocked = required && trimmed.length === 0;

  return (
    <Sheet visible={visible} onClose={onClose} title={title} detents={[0.6, 0.9]}>
      <View className="gap-3 px-4 pb-6 pt-2">
        {message ? <Text className="text-sm leading-relaxed text-muted-foreground">{message}</Text> : null}
        <Field
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          multiline
          autoFocus
          accessibilityLabel={title}
          style={{ minHeight: 120, textAlignVertical: 'top' }}
        />
        <Button
          label={submitLabel}
          full
          size="lg"
          haptic="commit"
          loading={busy}
          disabled={blocked || busy}
          onPress={() => onSubmit(trimmed)}
        />
      </View>
    </Sheet>
  );
}
