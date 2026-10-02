// Pure EntityRow logic (03 ML-14): the one spoken label.
import { STATUS_STATE_DEFS } from '@generatorai/shared';
import { spokenRelative } from '../../lib/format';
import type { EntityRowProps } from './EntityRow.types';

/** "<status word>, <title>, <meta>, <time>" plus pinned / unread / archived / selected words. */
export function entityRowLabel({ leading, title, meta, time, pinned, unread, archived }: Pick<EntityRowProps, 'leading' | 'title' | 'meta' | 'time' | 'pinned' | 'unread' | 'archived'>, now?: number): string {
  const parts: string[] = [];
  if ('status' in leading) parts.push(STATUS_STATE_DEFS[leading.status].label);
  parts.push(title);
  if (pinned) parts.push('pinned');
  if (unread) parts.push('unread');
  if (archived) parts.push('archived');
  for (const m of meta ?? []) if (typeof m === 'string') parts.push(m);
  if (time) parts.push(spokenRelative(time, now));
  return parts.filter(Boolean).join(', ');
}
