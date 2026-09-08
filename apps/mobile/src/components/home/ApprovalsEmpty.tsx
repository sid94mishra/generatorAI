// A one-line hint under the approvals empty state: only the twelve most
// likely chats are probed for gates (D10), so an older chat with a gate can
// be missed. Say so rather than let "nothing waiting" over-promise.

import React from 'react';
import { Text } from 'react-native';

import { GATE_PROBE_LIMIT } from '../../api/activityRanking';

export function ApprovalsQueueEmptyHint(): React.ReactElement {
  return (
    <Text className="px-6 text-center text-xs leading-relaxed text-muted-foreground">
      The {GATE_PROBE_LIMIT} most recent and running chats are checked for open gates. An older
      chat can still be waiting — open it to see.
    </Text>
  );
}
