// ────────────────────────────────────────────────────────────────
// The composer's placeholder while the model catalog loads
// (`chat-input-skeleton`). Same footprint as the real box so the swap is a
// fade, not a jump; non-interactive — there is nothing to type into until
// the composer knows which models exist.
// ────────────────────────────────────────────────────────────────

import { cn } from '@/ui/lib/cn.js';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton.js';

export function ComposerSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn(!compact && 'px-4 pt-3 pb-3')} aria-hidden="true" data-testid="chat-input-skeleton">
      <div className={cn('mx-auto w-full', !compact && 'max-w-190')}>
        <div className="flex flex-col gap-3 rounded-dialog border border-line bg-raised px-3.5 pt-3 pb-2">
          <Skeleton className="w-2/5" />
          <div className="flex items-center gap-2">
            <Skeleton className="w-28" />
            <Skeleton className="w-20" />
            <Skeleton className="ml-auto w-7" />
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          Loading available models…
        </p>
      </div>
    </div>
  );
}
