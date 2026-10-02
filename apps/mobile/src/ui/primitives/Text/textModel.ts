// Role → vocabulary class and geometry step (mobile 02 §4.1, 03 §1.4). Pure.
import type { MobileTextStep, TextStep } from '@generatorai/design-tokens';
import type { TextRole, TextTone } from './Text.types';

export const ROLE_STEP = {
  largeTitle: 'display',
  title: 'heading',
  headline: 'title',
  detailTitle: 'detail-title',
  body: 'body',
  transcript: 'transcript',
  subhead: 'ui',
  footnote: 'small',
  caption: 'micro',
  monoLg: 'mono-lg',
  mono: 'mono',
  monoSm: 'mono-sm',
} as const satisfies Record<TextRole, TextStep | MobileTextStep>;

/** Static class strings, so Tailwind's scanner sees every one. */
export const ROLE_CLASS = {
  largeTitle: 'text-display',
  title: 'text-heading',
  headline: 'text-title',
  detailTitle: 'text-detail-title',
  body: 'text-body',
  transcript: 'text-transcript',
  subhead: 'text-ui',
  footnote: 'text-small',
  caption: 'text-micro',
  monoLg: 'text-mono-lg',
  mono: 'text-mono',
  monoSm: 'text-mono-sm',
} as const satisfies Record<TextRole, string>;

export const TONE_CLASS = {
  fg: 'text-fg',
  'fg-2': 'text-fg-2',
  'fg-3': 'text-fg-3',
  'on-accent': 'text-on-accent',
  run: 'text-run',
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-err',
  surface: 'text-surface',
} as const satisfies Record<TextTone, string>;

export const WEIGHT_CLASS = { 400: 'font-normal', 500: 'font-medium', 600: 'font-semibold' } as const;

/** `start` follows the layout direction (natural alignment), so it sets no class. */
export const ALIGN_CLASS = { start: '', center: 'text-center', end: 'text-right' } as const;

export const isMonoRole = (role: TextRole): boolean => role === 'mono' || role === 'monoSm' || role === 'monoLg';
export const isHeadingRole = (role: TextRole): boolean =>
  role === 'largeTitle' || role === 'title' || role === 'headline' || role === 'detailTitle';
