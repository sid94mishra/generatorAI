// ML-03 Breadcrumb contract (03 ML-03; MD-128: no router in ui/, navigation is the caller's onPress).
export interface BreadcrumbSegment {
  label: string;
  /** Pops to that level (router.dismissTo, by the caller). Absent → plain text (not a real ancestor, e.g. "Step 4 of 6"). */
  onPress?: () => void;
  accessibilityLabel?: string;
}

export interface BreadcrumbProps {
  segments: ReadonlyArray<BreadcrumbSegment>;
  /** iOS centred (title view), Android start. Default 'start'. */
  align?: 'center' | 'start';
  testID?: string;
}

/** The iOS header title view (03 ML-02): breadcrumb 12 fg-3 over the detail title, one accessibility element whose
 * tappable segments are accessibility actions ("Go to Chats"). */
export interface BreadcrumbTitleProps {
  breadcrumb?: ReadonlyArray<BreadcrumbSegment>;
  title: string;
  align?: 'center' | 'start';
  testID?: string;
}
