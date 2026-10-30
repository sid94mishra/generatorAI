// MP-01 Text contract (03 MP-01; mobile 02 §4.1–4.2, MD-71).
import type { ReactNode } from 'react';

export type TextRole =
  | 'largeTitle'
  | 'title'
  | 'headline'
  | 'detailTitle'
  | 'body'
  | 'transcript'
  | 'subhead'
  | 'footnote'
  | 'caption'
  | 'mono'
  | 'monoSm'
  | 'monoLg';

export type TextTone = 'fg' | 'fg-2' | 'fg-3' | 'on-accent' | 'run' | 'ok' | 'warn' | 'err' | 'surface';

export interface TextProps {
  /** Default 'body'. */
  role?: TextRole;
  /** Default 'fg'. */
  tone?: TextTone;
  weight?: 400 | 500 | 600;
  numberOfLines?: number;
  ellipsizeMode?: 'tail' | 'middle' | 'head';
  /** Dense chrome: caps at chromeScaleCap 1.4. */
  chrome?: boolean;
  /** Default true for mono roles. */
  tabular?: boolean;
  selectable?: boolean;
  align?: 'start' | 'center' | 'end';
  accessibilityRole?: 'header' | 'text' | 'link';
  accessibilityLabel?: string;
  /** Design utilities only (lint). */
  className?: string;
  testID?: string;
  children: ReactNode;
}
