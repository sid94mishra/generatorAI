// IconButton surfaces (03 MP-05). Glass is drawn by GlassSurface (MP-38, M4-08); until it lands, `glass` uses
// GlassSurface's opaque fallback recipe on iOS (bg-overlay + border-line + shadow-float, 02 §8.2) and plain on Android.
import { cva } from 'class-variance-authority';

export const iconButtonSurface = cva('items-center justify-center rounded-full', {
  variants: {
    variant: {
      plain: '',
      glass: 'ios:border ios:border-line ios:bg-overlay ios:shadow-float',
      bordered: 'border ios:border-line android:border-line-strong',
      filled: 'bg-accent android:rounded-card-lg',
      tonal: 'bg-selected',
    },
    size: { sm: 'size-icon-button-sm', md: 'size-icon-button' },
    selected: { true: 'bg-selected', false: '' },
  },
  compoundVariants: [{ variant: 'filled', selected: true, className: 'bg-accent' }],
  defaultVariants: { variant: 'plain', size: 'md', selected: false },
});

/** Badge position over the drawn circle (03 MP-05): top 4 / end 2 (iOS), top 8 / end 6 (Android). */
export const BADGE_POSITION = 'absolute ios:end-0.5 ios:top-1 android:end-1.5 android:top-2';
