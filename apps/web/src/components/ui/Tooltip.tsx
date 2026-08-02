// ────────────────────────────────────────────────────────────────
// Tooltip — simple content-prop tooltip. Built on Radix Tooltip
// (portal, collision-aware positioning, ARIA, focus/hover handling)
// while keeping the original content/children/side/delayMs API.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from './primitives/tooltip.js';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delayMs?: number;
}

export function Tooltip({ content, children, side = 'bottom', delayMs = 300 }: TooltipProps) {
  return (
    <TooltipProvider delayDuration={delayMs}>
      <TooltipRoot>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{content}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
