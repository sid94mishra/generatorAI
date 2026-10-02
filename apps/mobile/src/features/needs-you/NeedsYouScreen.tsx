// "Needs you" (04 §1.2: the drawer's "Show all", Home's "See all"; replaces the legacy /approvals sheet): every item
// waiting on a person, oldest ask first, from the attention feed of the active server (MB-19). A row opens the item
// (a gate opens its sheet over the chat; a run its run). Detail header (MD-18).
import React from 'react';

import { AttentionList, useAttentionLists } from '../../blocks/AttentionList';
import { useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { EmptyState } from '../../ui/primitives/EmptyState';

export default function NeedsYouScreen(): React.ReactElement {
  const onBack = useHeaderBack();
  const { needsYou, loaded } = useAttentionLists();
  const state = !loaded ? { kind: 'loading' as const } : needsYou.length === 0 ? { kind: 'empty' as const, empty: <EmptyState copyKey="needsYou" /> } : { kind: 'ready' as const };
  return (
    <Screen header={<Header role="detail" title="Needs you" breadcrumb={[{ label: 'Home', onPress: onBack }]} onBack={onBack} />} state={state} testID="needs-you">
      <AttentionList variant="list" />
    </Screen>
  );
}
