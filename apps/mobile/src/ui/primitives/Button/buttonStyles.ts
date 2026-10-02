// Button surface recipes (03 MP-04; MD-51). Per-OS differences are platform classes (MD-115), so one file serves
// both. Tonal is Android's M3 tonal button; iOS renders it as secondary (MD-51).
import { cva } from 'class-variance-authority';
import type { IconTone } from '../Icon/Icon.types';
import type { TextRole, TextTone } from '../Text/Text.types';
import type { ButtonSize, ButtonVariant } from './Button.types';

const SECONDARY = 'ios:border ios:border-line ios:bg-raised android:border android:border-line-strong';

export const buttonSurface = cva('flex-row items-center justify-center gap-2 rounded-full', {
  variants: {
    variant: {
      primary: 'bg-accent',
      secondary: SECONDARY,
      ghost: '',
      destructive: SECONDARY,
      tonal: 'ios:border ios:border-line ios:bg-raised android:bg-selected',
    },
    size: {
      sm: 'min-h-control-sm px-3.5',
      md: 'min-h-control ios:px-4.5 android:px-5',
      lg: 'min-h-control-lg px-6',
    },
  },
  compoundVariants: [{ variant: 'ghost', size: 'md', className: 'android:px-3' }],
  defaultVariants: { variant: 'secondary', size: 'md' },
});

export const LABEL_ROLE: Record<ButtonSize, TextRole> = { sm: 'subhead', md: 'subhead', lg: 'headline' };

export const LABEL_TONE: Record<ButtonVariant, TextTone & IconTone> = {
  primary: 'on-accent',
  secondary: 'fg',
  ghost: 'fg-2',
  destructive: 'err',
  tonal: 'fg',
};

export const ICON_SIZE: Record<ButtonSize, 16 | 18> = { sm: 16, md: 16, lg: 18 };
