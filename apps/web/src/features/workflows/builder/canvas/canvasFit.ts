// The builder's automatic fit (first render, a stage added, Auto-layout).
// Fitting a long chain whole lands near MIN_ZOOM, where nothing is readable
// (U-12). Below READABLE_ZOOM the canvas opens at READABLE_ZOOM instead, each
// axis centred when it fits and anchored to the start (entry stages on the
// left, top) when it does not. The zoom bar's "Fit view" still shows it all.
import { getViewportForBounds, type Rect, type Viewport } from '@xyflow/react';
import { FIT_OPTIONS, MIN_ZOOM } from './canvasTheme.js';

export const READABLE_ZOOM = 0.6;
/** Screen gap between the graph's start edge and the canvas edge when anchored. */
const ANCHOR_PX = 48;

function axis(start: number, size: number, viewport: number, zoom: number): number {
  const scaled = size * zoom;
  return scaled + 2 * ANCHOR_PX <= viewport ? (viewport - scaled) / 2 - start * zoom : ANCHOR_PX - start * zoom;
}

/** The viewport for `bounds` in a `width`×`height` canvas: a full fit, or a readable start. */
export function readableViewport(bounds: Rect, width: number, height: number): Viewport {
  const fit = getViewportForBounds(bounds, width, height, MIN_ZOOM, FIT_OPTIONS.maxZoom, FIT_OPTIONS.padding);
  if (fit.zoom >= READABLE_ZOOM) return fit;
  const zoom = READABLE_ZOOM;
  return { zoom, x: axis(bounds.x, bounds.width, width, zoom), y: axis(bounds.y, bounds.height, height, zoom) };
}
