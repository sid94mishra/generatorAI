import { transcriptStepStatus, type StepStatus } from '@generatorai/client-core';
/** Token-name bridge for the legacy kit. Domain meaning lives in shared/status. */
import {
  STATUS_MAPS,
  HEALTH,
  CHANGE_KIND,
  resolveMapping,
  type ChangeKindTone,
  type StatusTone,
  resolveStatus,
  type ResolvedStatus,
  type StatusDomain,
  type StatusValue,
  type StatusBadgeTone,
} from '@generatorai/shared/client';

const LEGACY_TONES = {
  idle: 'neutral', run: 'info', ok: 'success', warn: 'warning', err: 'danger',
} as const satisfies Record<StatusBadgeTone, string>;

export function domainStatus<D extends StatusDomain>(domain: D, value: string | null | undefined): ResolvedStatus | null {
  if (!value || !Object.hasOwn(STATUS_MAPS[domain], value)) return null;
  return resolveStatus(domain, value as StatusValue<D>);
}

export function legacyStatusTone(status: ResolvedStatus | null) {
  return LEGACY_TONES[status?.def.badge ?? 'idle'];
}

export function domainStatusTone(domain: StatusDomain, value: string | null | undefined) {
  return legacyStatusTone(domainStatus(domain, value));
}

/** Legacy run/stage rows accept both domains; shared definitions agree on overlap. */
export function runStatus(value: string): ResolvedStatus | null {
  return domainStatus('workflowRun', value) ?? domainStatus('stageRun', value);
}

export function runStatusTone(value: string) {
  return legacyStatusTone(runStatus(value));
}

export function domainStatusLabel(domain: StatusDomain, value: string | null | undefined): string {
  return domainStatus(domain, value)?.label ?? value ?? 'Unknown';
}

export function healthTone(domain: keyof typeof HEALTH, value: string | null | undefined) {
  const map = HEALTH[domain] as Record<string, { tone: StatusBadgeTone }>;
  const tone = value && Object.hasOwn(map, value) ? map[value]?.tone : undefined;
  return LEGACY_TONES[tone ?? 'idle'];
}

export function changeKind(value: string) {
  return Object.hasOwn(CHANGE_KIND, value) ? CHANGE_KIND[value as keyof typeof CHANGE_KIND] : null;
}

export function changeTone(value: string) {
  const tone = changeKind(value)?.tone;
  return !tone || tone === 'fg-3' ? 'neutral' : LEGACY_TONES[tone];
}

/** Native legacy hosts consume the current theme's literals, never raw colors. */
const COLOR_KEYS = {
  'fg-2': 'secondary-foreground', 'fg-3': 'muted-foreground',
  run: 'info', ok: 'success', warn: 'warning', err: 'danger',
} as const satisfies Record<StatusTone | ChangeKindTone, string>;

export function statusColorToken(status: ResolvedStatus | null) {
  return COLOR_KEYS[status?.def.tone ?? 'fg-3'];
}

export function stepStatus(status: StepStatus) {
  return resolveMapping(transcriptStepStatus(status));
}
