// Pure GlassSurface logic (02 §8.2): the radius per step and the opaque fallback recipe (MD-72).
import type { GlassRadiusStep } from './GlassSurface.types';

export const GLASS_RADIUS_CLASS: Record<GlassRadiusStep, string> = {
  composer: 'rounded-composer',
  new: 'rounded-new',
  toast: 'rounded-toast',
  full: 'rounded-full',
};

/** Reduce Transparency, no Liquid Glass, Android, web and Jest: opaque overlay + line + float shadow. */
export const GLASS_FALLBACK_CLASS = 'border border-line bg-overlay shadow-float';
