// MP-44 Link contract (03 MP-44; MD-128: internal navigation is the caller's onPress — ui/ never imports the router).
export interface LinkProps {
  label: string;
  /** External URL (opens the in-app browser). */
  url?: string;
  onPress?: () => void;
  /** Adds the external-link glyph. Implied by `url`. */
  external?: boolean;
  /** "See all ›": a standalone row-level link (fg-2, 500, trailing chevron) with a hit frame. */
  standalone?: boolean;
  testID?: string;
}
