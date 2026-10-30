// MP-07 StatusBadge (03 MP-07; MD-25, MD-64): glyph + word from STATUS_STATE_DEFS, never a local map.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { STATUS_STATE_DEFS, type StatusBadgeTone, type StatusState } from '@generatorai/shared';
import type { StatusContext } from '@generatorai/shared/ui-contract';

import { cn } from '../../lib/cn';
import { formatElapsed, spokenElapsed } from '../../lib/format';
import { badgeFrame } from '../Badge';
import { Icon } from '../Icon';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import { Text } from '../Text';
import type { TextTone } from '../Text/Text.types';
import type { StatusBadgeProps } from './StatusBadge.types';

export type { StatusBadgeProps } from './StatusBadge.types';

const SURFACE: Record<StatusBadgeTone, string> = {
  idle: 'bg-selected',
  run: 'bg-run-bg',
  ok: 'bg-ok-bg',
  warn: 'bg-warn-bg',
  err: 'bg-err-bg',
};
const WORD: Record<StatusBadgeTone, TextTone> = { idle: 'fg-2', run: 'run', ok: 'ok', warn: 'warn', err: 'err' };

/** The word (03 MP-07): label ?? (chat + succeeded → "Done") ?? the state's label. */
export function statusWord(state: StatusState, context: StatusContext = 'run', label?: string): string {
  return label ?? (context === 'chat' && state === 'succeeded' ? 'Done' : STATUS_STATE_DEFS[state].label);
}

function useElapsed(since: string | undefined): number | null {
  const start = since ? Date.parse(since) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (Number.isNaN(start)) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [start]);
  return Number.isNaN(start) ? null : now - start;
}

export function StatusBadge({ state, context = 'run', label, phase, detail, elapsedSince, size = 'md', testID }: StatusBadgeProps): React.ReactElement {
  const def = STATUS_STATE_DEFS[state];
  const word = statusWord(state, context, label);
  const elapsed = useElapsed(elapsedSince);
  const spoken = [word, phase, detail, elapsed === null ? undefined : spokenElapsed(elapsed)].filter(Boolean).join(', ');
  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={spoken} className={cn(badgeFrame(size), SURFACE[def.badge])}>
      <Icon concept={def.glyph as MobileIconConcept} size={size === 'sm' ? 12 : 14} tone={def.tone} spinning={def.spin} />
      <Text role="caption" tone={WORD[def.badge]} chrome numberOfLines={1}>
        {word}
        {phase ? ` · ${phase}` : ''}
        {detail ? (
          <Text role="caption" tone="fg-2" weight={500} chrome>
            {` · ${detail}`}
          </Text>
        ) : null}
      </Text>
      {elapsed === null ? null : (
        <Text role="monoSm" tone={WORD[def.badge]} chrome>
          {formatElapsed(elapsed)}
        </Text>
      )}
    </View>
  );
}
