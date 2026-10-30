// "Rewind to here" (MB-08 menu, MB-32 scrubber; Claude Code's `/rewind`): the three scopes in their order, each with
// the line that says what it moves; the whole set is disabled as a unit (with the reason on the rows) while a turn
// streams, the chat is archived or the message has no turn. Content for the kit Sheet (`useRewindSheet` presents it);
// the option model is `model/rewindOptions.ts`. Row testIDs `rewind-sheet-all | -conversation | -code` (03 §1.5).
import React, { useCallback } from 'react';
import { View } from 'react-native';
import type { RewindScope } from '@generatorai/client-core';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { useSheet } from '../../ui/native/Sheet';
import { Text } from '../../ui/primitives/Text';
import { rewindOptions, type RewindAvailability } from './model/rewindOptions';

export interface RewindSheetContentProps {
  availability: RewindAvailability;
  /** The prompt being rewound to, so the choice is visible. */
  preview?: string | null;
  onChoose: (scope: RewindScope) => void;
}

export function RewindSheetContent({ availability, preview, onChoose }: RewindSheetContentProps): React.ReactElement {
  const options = rewindOptions(availability);
  return (
    <View className="gap-2 pb-2">
      <View className="gap-1 px-4">
        <Text role="footnote" tone="fg-2">
          Go back to the moment just before this message was sent.
        </Text>
        {preview ? (
          <Text role="footnote" tone="fg-3" numberOfLines={2}>
            {`“${preview.trim()}”`}
          </Text>
        ) : null}
      </View>
      <ListSection footer="Restoring code uses this chat's own checkpoints, so it covers files changed by shell commands and sub-agents too.">
        {options.map((option) => (
          <ListRow
            key={option.scope}
            kind="navigation"
            icon="history"
            title={option.title}
            subtitle={option.disabled ? (option.disabledReason ?? undefined) : option.help}
            disabled={option.disabled}
            {...(option.disabled && option.disabledReason ? { disabledReason: option.disabledReason } : {})}
            onPress={() => onChoose(option.scope)}
            testID={option.testID}
          />
        ))}
      </ListSection>
    </View>
  );
}

/** Presents the rewind choices in the one imperative sheet; the choice closes it before `onChoose` runs. */
export function useRewindSheet(): (input: RewindSheetContentProps) => void {
  const sheet = useSheet();
  return useCallback(
    ({ availability, preview, onChoose }: RewindSheetContentProps) =>
      sheet.present(
        <RewindSheetContent
          availability={availability}
          {...(preview !== undefined ? { preview } : {})}
          onChoose={(scope) => {
            sheet.dismiss();
            onChoose(scope);
          }}
        />,
        { title: 'Rewind to here', detents: ['content'], testID: 'rewind-sheet' },
      ),
    [sheet],
  );
}
