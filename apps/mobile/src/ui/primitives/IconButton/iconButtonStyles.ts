// IconButton surfaces (03 MP-05). The iOS `glass` circle is drawn by GlassSurface (MP-38, with its own opaque
// fallback); Android draws `glass` plain.
import { cva } from 'class-variance-authority';

export const iconButtonSurface = cva('items-center justify-center rounded-full', {
  variants: {
    variant: {
      plain: '',
      glass: '',
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
