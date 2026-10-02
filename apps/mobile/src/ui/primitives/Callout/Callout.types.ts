// MP-45 Callout (+ Banner) contract (03 MP-45; MD-25).
export type CalloutTone = 'info' | 'warn' | 'err' | 'ok';

export interface CalloutProps {
  /** Tinted tones only for state messages (MD-25), never decoration. */
  tone: CalloutTone;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  /** card (default) or the one-line banner (h40). */
  form?: 'card' | 'banner';
  testID?: string;
}
