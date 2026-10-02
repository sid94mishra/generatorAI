// MP-23 SegmentedControl contract (03 MP-23; MD-47).
import type { MobileIconConcept } from '@generatorai/design-tokens';

export interface Segment<V extends string> {
  value: V;
  label: string;
  icon?: MobileIconConcept;
  /** Mono count after the label (forces the JS path: native segments cannot style it). */
  count?: number;
  disabled?: boolean;
  /** Lock glyph, not selectable ("GitHub Copilot" not signed in). */
  locked?: boolean;
}

export interface SegmentedControlProps<V extends string> {
  /** 2–4 on phones; more always falls back to Select (MD-47). */
  segments: ReadonlyArray<Segment<V>>;
  value: V;
  onValueChange: (v: V) => void;
  /** "Filter chats" — the radiogroup's name, and the Select label in the fallback. */
  accessibilityLabel: string;
  /** sm = Android h32 inside the turn sheet. Default md. */
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  /** Segments get `${testID}-${value}`. */
  testID?: string;
}
