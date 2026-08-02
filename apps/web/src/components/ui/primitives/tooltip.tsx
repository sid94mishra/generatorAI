// ────────────────────────────────────────────────────────────────
// tooltip — vendored shadcn/ui part (Radix Tooltip)
// App code should normally use <Tooltip> from '@/components/ui'
// (simple content-prop wrapper); these parts are for composition.
// ────────────────────────────────────────────────────────────────

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils.js';

const TooltipProvider = TooltipPrimitive.Provider;
const TooltipRoot = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[1200] max-w-xs rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md',
        'data-[state=delayed-open]:animate-fade-in',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent };
