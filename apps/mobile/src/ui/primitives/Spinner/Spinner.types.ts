// MP-12 Spinner contract (03 MP-12): the only inline spinner.
import type { TextTone } from '../Text/Text.types';

export interface SpinnerProps {
  /** Default 16. */
  size?: 12 | 14 | 16 | 20;
  /** Default 'run'. */
  tone?: TextTone;
  /** Present → a busy progressbar with this name; absent → decorative. */
  label?: string;
  testID?: string;
}
