// cn() — clsx + tailwind-merge with the mobile vocabulary (mobile 02 §9.7): the shared design names plus the
// mobile-only ones merge as their real groups, so `cn('min-h-row', 'min-h-row-2')` keeps the later one and
// `cn('text-fg-2', 'text-title')` keeps both (a colour and a size).
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { mobileTwMergeExtension } from '@generatorai/design-tokens';

const twMerge = extendTailwindMerge(mobileTwMergeExtension() as Parameters<typeof extendTailwindMerge>[0]);

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
