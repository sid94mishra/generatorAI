// MP-36 Separator contract (03 MP-36).
export interface SeparatorProps {
  /** Default 'horizontal'. */
  orientation?: 'horizontal' | 'vertical';
  /** Start inset: 16; 48 (iOS grouped-row icon column: 16 + 20 + 12); 56 (Android list icon inset). Default 0. */
  inset?: 0 | 16 | 48 | 56;
  /** 'band' = the iOS JS-menu group band (8, bg-hover). Default 'line'. */
  variant?: 'line' | 'band';
  testID?: string;
}
