// ────────────────────────────────────────────────────────────────
// F-composer-17 — attachment chips above the text.
//
// 24h chips (label max ~170): a picked / dropped / pasted file, an image
// (thumb glyph + hover preview of the picture), an @ file (mono), and a
// browser / terminal capture (filled: `selected` ground, no border). Each has
// its own remove button "Remove <label>". The END of a file name is what tells
// two attachments apart (`element-buy-<stamp>.md` vs `.png`), so only the stem
// truncates; the extension never does.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactElement } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';

/** MIME types (or file names) the hover preview can draw. */
export function isPreviewableImage(mimeType?: string | null, name?: string | null): boolean {
  if (mimeType && /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/i.test(mimeType)) return true;
  if (name && /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name)) return true;
  return false;
}

/** Object URL for a local image `File`, revoked when the file changes or the chip unmounts. */
function useImageUrl(file: File): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isPreviewableImage(file.type, file.name)) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/** `report.final.md` → `{ stem: 'report.final', ext: '.md' }`; a dotfile or a >8-char "extension" is not split. */
export function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > 9 || /[\s/]/.test(name.slice(dot))) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

function ImagePreview({ src, alt, children }: { src: string; alt: string; children: ReactElement }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <Tooltip
      className="max-w-none flex-col items-start gap-1 p-1.5"
      content={
        <span data-testid="image-hover-preview" className="flex flex-col gap-1">
          {failed ? (
            <span className="flex min-h-24 w-40 flex-col items-center justify-center gap-1 text-fg-3">
              <Icon concept="view" size={16} />
              <span className="text-micro">Preview unavailable</span>
            </span>
          ) : (
            <img
              src={src}
              alt={alt}
              onError={() => setFailed(true)}
              draggable={false}
              className="block max-h-80 max-w-100 rounded-control-sm bg-sunken object-contain"
            />
          )}
          <span className="max-w-100 truncate px-0.5 text-micro text-fg-3">{alt}</span>
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}

export interface ComposerChipProps {
  file: File;
  label: string;
  title?: string;
  /** `mention` = @ file (mono); `capture` = browser/terminal capture (filled). */
  kind?: 'file' | 'mention' | 'capture';
  icon?: IconConcept;
  onRemove?: (() => void) | undefined;
}

/** One attachment chip (`composer-attachment`). */
export function ComposerChip({ file, label, title, kind = 'file', icon, onRemove }: ComposerChipProps) {
  const previewUrl = useImageUrl(file);
  const image = isPreviewableImage(file.type, file.name);
  const { stem, ext } = splitExtension(label);
  const glyph: IconConcept = icon ?? (kind === 'mention' ? 'mention' : image ? 'view' : 'attach');
  const chip = (
    <div
      data-testid="composer-attachment"
      title={title ?? label}
      className={cn(
        'inline-flex h-control-sm max-w-full min-w-0 items-center gap-1.5 rounded-control-sm border pr-0.5 pl-2 text-small text-fg',
        kind === 'capture' ? 'border-transparent bg-selected' : 'border-line bg-raised',
      )}
    >
      <Icon concept={glyph} size={12} className="shrink-0 text-fg-3" />
      <span className={cn('flex max-w-43 min-w-0', kind === 'mention' && 'font-mono text-micro')}>
        <span className="truncate">{stem}</span>
        <span className="shrink-0">{ext}</span>
      </span>
      {onRemove ? (
        <IconButton icon="x" size="sm" label={`Remove ${label}`} tooltip={false} onClick={onRemove} className="size-4" />
      ) : (
        <span className="w-1" />
      )}
    </div>
  );
  return previewUrl ? (
    <ImagePreview src={previewUrl} alt={label}>
      {chip}
    </ImagePreview>
  ) : (
    chip
  );
}

/** "Attaching…" while a mention's contents are fetched. */
export function AttachingChip() {
  return (
    <div className="inline-flex h-control-sm items-center gap-1.5 rounded-control-sm border border-line px-2 text-small text-fg-3">
      <Spinner size={12} /> Attaching…
    </div>
  );
}
