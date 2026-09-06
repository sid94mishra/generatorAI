// ────────────────────────────────────────────────────────────────
// ImageHoverPreview — hover (or focus) an image chip to see the picture.
//
// Used wherever the transcript or composer shows an image by NAME only:
// a pasted screenshot in the composer, an attachment on a sent message, a
// screenshot the agent took while driving the browser. Hover reveals the
// actual picture in a portal'd card next to the trigger, so the user never
// has to open a tab to know what "capture-1725…png" is.
//
// Built on the vendored Radix Tooltip: it already handles hover/focus
// intent, portal positioning, collision flipping and ARIA — a tooltip that
// happens to contain an image, not a bespoke popover.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from '@/components/ui/primitives/tooltip.js';
import { cn } from '@/lib/utils.js';

/** MIME types (or file names) the preview knows how to draw. */
export function isPreviewableImage(mimeType?: string | null, name?: string | null): boolean {
  if (mimeType && /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/i.test(mimeType)) return true;
  if (name && /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name)) return true;
  return false;
}

/**
 * Object URL for a local `File`/`Blob`, revoked when the file changes or the
 * chip unmounts. Returns `null` for anything that is not an image.
 */
export function useObjectUrl(file: File | Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !isPreviewableImage(file.type, file instanceof File ? file.name : null)) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export interface ImageHoverPreviewProps {
  /** Image source. When absent the trigger renders alone (no preview). */
  src: string | null | undefined;
  /** Accessible description + caption. */
  alt: string;
  /** Optional caption line under the image (defaults to `alt`). */
  caption?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** The chip / button / row the preview hangs off. */
  children: React.ReactElement;
  className?: string;
}

export function ImageHoverPreview({ src, alt, caption, side = 'top', children, className }: ImageHoverPreviewProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src) return children;
  return (
    <TooltipProvider delayDuration={250}>
      <TooltipRoot>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          sideOffset={8}
          className={cn('max-w-none p-1.5', className)}
          data-testid="image-hover-preview"
        >
          {failed ? (
            <div className="flex h-24 w-40 flex-col items-center justify-center gap-1 text-[var(--color-muted-foreground)]">
              <ImageOff className="h-4 w-4" />
              <span className="text-[10.5px]">Preview unavailable</span>
            </div>
          ) : (
            <img
              src={src}
              alt={alt}
              onError={() => setFailed(true)}
              className="block max-h-[320px] max-w-[420px] rounded-[4px] bg-[var(--color-subtle)] object-contain"
              draggable={false}
            />
          )}
          <p className="mt-1 max-w-[420px] truncate px-0.5 text-[10.5px] text-[var(--color-muted-foreground)]">
            {caption ?? alt}
          </p>
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
