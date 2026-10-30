// Gesture policy (MD-19; 06 §3.4). Every rule is enforced in code, not left to the gesture system.
import { nativePlatform, type NativePlatform } from './geometry';
import type { SizeClass } from './breakpoints';

/** Screen roles for the edge rule (ML-02 HeaderRole). */
export type GestureScreenRole = 'top' | 'workspace' | 'detail' | 'modal' | 'sheet' | 'palette' | 'public';

/** iOS drawer edge strip, pt (06 §3.4). */
export const DRAWER_EDGE_WIDTH = 28;
/** Pane close band at its leading edge, pt/dp. */
export const PANE_CLOSE_BAND = 24;
/** Panel pans: vertical intent fails the pan (today's values). */
export const PANEL_PAN = { activeOffsetX: [-12, 12] as [number, number], failOffsetY: [-12, 12] as [number, number] };
/** Row swipes never start in the drawer strip on module screens. */
export const DRAWER_EDGE_HIT_SLOP = { left: -DRAWER_EDGE_WIDTH };

export interface EdgeContext {
  role: GestureScreenRole;
  sizeClass: SizeClass;
  /** A surface that owns keys and gestures (terminal, WebView, map pinch) is focused (the D-46 twin). */
  surfaceOwnsGestures: boolean;
}

/** iOS: module roots in the compact class only; Android: never (both edges are system Back). */
export function edgeSwipeOpensDrawerOn(platform: NativePlatform, ctx: EdgeContext): boolean {
  return platform === 'ios' && ctx.role === 'top' && ctx.sizeClass === 'compact' && !ctx.surfaceOwnsGestures;
}

export function edgeSwipeOpensDrawer(ctx: EdgeContext): boolean {
  return edgeSwipeOpensDrawerOn(nativePlatform, ctx);
}

/** The pane never opens by gesture; it closes by pan unless a surface owns gestures. */
export function paneClosesByPan(ctx: Pick<EdgeContext, 'surfaceOwnsGestures'>): boolean {
  return !ctx.surfaceOwnsGestures;
}
