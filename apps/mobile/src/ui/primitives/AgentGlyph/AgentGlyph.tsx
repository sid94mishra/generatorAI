// MP-37 AgentGlyph (03 MP-37): agent → bot glyph + name (600) + model (fg-3); model → the model name alone (it is the
// identity); team → users glyph + "Orchestrator · members"; you → user glyph + "You". Never initials.
import React from 'react';
import { View } from 'react-native';
import type { MobileIconConcept } from '@generatorai/design-tokens';

import { Icon } from '../Icon';
import { Text } from '../Text';
import type { TextRole } from '../Text/Text.types';
import type { AgentGlyphProps } from './AgentGlyph.types';

export type { AgentGlyphProps } from './AgentGlyph.types';

const ROLE: Record<NonNullable<AgentGlyphProps['size']>, TextRole> = { 12: 'caption', 14: 'footnote', 16: 'subhead', 20: 'body' };
const GLYPH: Record<AgentGlyphProps['kind'], MobileIconConcept | null> = { agent: 'agents', model: null, team: 'users', you: 'user' };

export function agentGlyphLabel({ kind, name, model, members, locked }: AgentGlyphProps): string {
  const parts = [kind === 'you' ? 'You' : name];
  if (kind === 'team' && members?.length) parts.push(members.join(', '));
  if (model && kind === 'agent') parts.push(model);
  if (locked) parts.push('locked');
  return parts.join(', ');
}

export function AgentGlyph(props: AgentGlyphProps): React.ReactElement {
  const { kind, name, model, members, size = 14, locked = false, testID } = props;
  const glyph = GLYPH[kind];
  const role = ROLE[size];
  return (
    <View testID={testID} accessible accessibilityLabel={agentGlyphLabel(props)} className="min-w-0 flex-row items-center gap-1.5">
      {glyph ? <Icon concept={glyph} size={size} tone="fg-3" /> : null}
      <Text role={role} weight={600} numberOfLines={1} className="shrink">
        {kind === 'you' ? 'You' : name}
        {kind === 'team' && members?.length ? <Text role={role} tone="fg-3">{` · ${members.join(', ')}`}</Text> : null}
      </Text>
      {model && kind === 'agent' ? (
        <Text role={role} tone="fg-3" numberOfLines={1} className="shrink">
          {model}
        </Text>
      ) : null}
      {locked ? <Icon concept="lock" size={12} tone="fg-3" /> : null}
    </View>
  );
}
