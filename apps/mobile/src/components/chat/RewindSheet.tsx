// ────────────────────────────────────────────────────────────────
// RewindSheet — "Rewind to here", from a user message.
//
// Claude Code's `/rewind` menu, re-homed onto a phone: the same three
// choices in the same order, each with the one line that says what it
// actually moves. On a desktop those lines are a hover tooltip; here they
// are permanent, because a phone has no hover and "Restore code" is not a
// self-explaining phrase — people reasonably read it as "re-run the edits".
//
// The whole sheet is disabled as a unit while a turn streams (the server
// would answer 409 CHAT_BUSY) with the reason ON the rows, not hidden behind
// a toast that only appears after a tap that was always going to fail.
//
// The option model is `rewindOptions.ts` — pure, shared with the tests, so
// the wording cannot drift between what is rendered and what is asserted.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { History } from 'lucide-react-native';

import { Sheet, SheetRow } from '../ui/Sheet';
import { Spinner } from '../ui/States';
import { rewindOptions, type RewindAvailability } from './rewindOptions';
import { useTheme } from '../../theme/ThemeProvider';
import type { RewindScope } from '@generatorai/client-core';

export function RewindSheet({
  visible,
  onClose,
  onChoose,
  availability,
  busy = false,
  /** The prompt being rewound TO, so the user can see what they picked. */
  preview,
}: {
  visible: boolean;
  onClose: () => void;
  onChoose: (scope: RewindScope) => void;
  availability: RewindAvailability;
  busy?: boolean;
  preview?: string | null;
}): React.ReactElement | null {
  const { colors } = useTheme();
  if (!visible) return null;

  const options = rewindOptions(availability);

  return (
    <Sheet visible={visible} onClose={onClose} title="Rewind to here" detents={[0.6]} fitContent>
      <View className="gap-1 px-4 pb-2">
        <Text className="text-sm text-muted-foreground">
          Go back to the moment just before this message was sent.
        </Text>
        {preview ? (
          <Text numberOfLines={2} className="text-sm italic text-muted-foreground">
            “{preview.trim()}”
          </Text>
        ) : null}
      </View>

      {options.map((option) => (
        <SheetRow
          key={option.scope}
          testID={option.testID}
          title={option.title}
          // A disabled row says WHY in place of its help text: the reason is
          // the only thing the user can act on while it is unavailable.
          subtitle={option.disabled ? option.disabledReason : option.help}
          disabled={option.disabled || busy}
          left={
            <History
              size={18}
              color={option.disabled ? colors['muted-foreground'] : colors.foreground}
            />
          }
          right={busy ? <Spinner /> : undefined}
          onPress={() => onChoose(option.scope)}
        />
      ))}

      <Text className="px-4 pb-3 pt-2 text-xs text-muted-foreground">
        Restoring code uses this chat&apos;s own checkpoints, so it covers files changed by shell
        commands and sub-agents too.
      </Text>
    </Sheet>
  );
}
