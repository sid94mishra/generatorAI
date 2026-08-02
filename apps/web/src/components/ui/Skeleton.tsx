// ────────────────────────────────────────────────────────────────
// Skeleton — shimmer loading placeholder + common layout presets.
// Prefer skeletons over spinners for content with predictable shape
// (lists, cards, message history). Moved into ui/ from
// components/Skeleton.tsx (which re-exports for compatibility).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

/** Sidebar session list skeleton */
export function SessionListSkeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <Skeleton className="h-4 w-4 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Chat message list skeleton */
export function ChatMessageSkeleton() {
  return (
    <div className="space-y-6 px-4 py-4">
      <div className="flex gap-3">
        <Skeleton className="h-8 w-8 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-16 w-4/5 rounded-lg" />
        </div>
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-8 w-8 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-8 w-8 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-12 w-3/5 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Card grid skeleton */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-1.5 pt-1">
            <Skeleton className="h-4 w-12 rounded" />
            <Skeleton className="h-4 w-16 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
