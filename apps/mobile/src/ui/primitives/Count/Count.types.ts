// MP-09 Count contract (03 MP-09).
export interface CountProps {
  value: number;
  /** Default 'fg-3'. */
  tone?: 'fg-3' | 'warn' | 'run';
  /** inline mono number · bubble on a toggle (pane toggle) · dot (pane tab needs you). Default 'inline'. */
  form?: 'inline' | 'bubble' | 'dot';
  /** 99 → "99+". */
  max?: number;
  /** Hidden from assistive tech when the owning control's label already carries the count. */
  hidden?: boolean;
  testID?: string;
}
