// Status words → the tones the SCM and pull-request models report (`neutral`, `info`, `success`, `warning`, `danger`;
// mapped to kit tones where they are drawn). Domain meaning lives in `@generatorai/shared` status (MD-25); this only
// renames the badge tone. Moved from `theme/status.ts` when the legacy kit went (M10-01).
import {
  CHANGE_KIND,
  STATUS_MAPS,
  resolveStatus,
  type ResolvedStatus,
  type StatusBadgeTone,
  type StatusDomain,
  type StatusValue,
} from '@generatorai/shared/client';

const MODEL_TONES = {
  idle: 'neutral', run: 'info', ok: 'success', warn: 'warning', err: 'danger',
} as const satisfies Record<StatusBadgeTone, string>;

export type ModelTone = (typeof MODEL_TONES)[StatusBadgeTone];

/** The shared definition of a status word, or null for a word this build does not know (a newer server). */
export function domainStatus<D extends StatusDomain>(domain: D, value: string | null | undefined): ResolvedStatus | null {
  if (!value || !Object.hasOwn(STATUS_MAPS[domain], value)) return null;
  return resolveStatus(domain, value as StatusValue<D>);
}

export function domainStatusTone(domain: StatusDomain, value: string | null | undefined): ModelTone {
  return MODEL_TONES[domainStatus(domain, value)?.def.badge ?? 'idle'];
}

export function changeKind(value: string) {
  return Object.hasOwn(CHANGE_KIND, value) ? CHANGE_KIND[value as keyof typeof CHANGE_KIND] : null;
}

export function changeTone(value: string): ModelTone {
  const tone = changeKind(value)?.tone;
  return !tone || tone === 'fg-3' ? 'neutral' : MODEL_TONES[tone];
}
