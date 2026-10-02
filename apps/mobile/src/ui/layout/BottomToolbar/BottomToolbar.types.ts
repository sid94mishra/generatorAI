// ML-27 BottomToolbar contract (03 ML-27).
import type { ButtonProps } from '../../primitives/Button/Button.types';
import type { IconButtonProps } from '../../primitives/IconButton/IconButton.types';

export interface BottomToolbarProps {
  /** ↑ / ↓ navigation icon buttons (44 / 48). */
  nav?: ReadonlyArray<IconButtonProps>;
  actions?: ReadonlyArray<ButtonProps>;
  /** The screen's primary. Android shows it in the bottom app bar's FAB slot (48, radius 16): give it an icon. */
  primary?: Omit<ButtonProps, 'variant'>;
  testID?: string;
}
