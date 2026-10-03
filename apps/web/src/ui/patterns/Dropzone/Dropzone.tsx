// ────────────────────────────────────────────────────────────────
// C-31 Dropzone (03 §3 C-31): attachment pickers (VariableInputModal
// `UploadSection` and its kind).
//
// 40h row (or a larger area via `className`), pad 0 8 0 12, gap 8, 1px
// **dashed** `border-line-strong`, `rounded-card`: icon · `label`
// (`text-small text-fg-3`) · a sm "Choose files" button (opens the native
// picker). Dragging a file over it swaps to `bg-hover border-fg-3`.
// ────────────────────────────────────────────────────────────────

import { useState, type DragEvent } from 'react';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';
import { Button } from '../../primitives/Button/Button.js';
import { FileInput } from '../../primitives/FileInput/FileInput.js';

export interface DropzoneProps {
  onFiles: (files: FileList) => void;
  accept?: string;
  multiple?: boolean;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/** A dashed drop target with a file-picker fallback button. */
export function Dropzone({ onFiles, accept, multiple = true, label = 'Drop files or', disabled, className }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) onFiles(event.dataTransfer.files);
  };

  return (
    <div
      role="group"
      aria-label="Drop files here"
      aria-disabled={disabled || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={disabled ? undefined : handleDrop}
      className={cn(
        'flex h-panel-bar items-center gap-2 rounded-card border border-dashed border-line-strong pr-2 pl-3 transition-control',
        dragging && 'border-fg-3 bg-hover',
        // A dimmed icon (decorative) keeps the disabled look; the label text stays
        // at its normal fg-3 contrast (D-12 guarantees fg-3 clears 4.5:1 on its own —
        // dropping it under an `opacity-45` wrapper would fail that on every surface).
        disabled && 'pointer-events-none cursor-not-allowed',
        className,
      )}
    >
      <Icon concept="upload" size={16} className="shrink-0 text-fg-3" />
      {/* "Drop files or [Choose files]" reads as one phrase (board WorkflowRunDialog). */}
      <span className="min-w-0 truncate text-small text-fg-3">{label}</span>
      <FileInput accept={accept} multiple={multiple} disabled={disabled} onFilesSelected={onFiles}>
        {(open) => (
          <Button size="sm" variant="secondary" disabled={disabled} onClick={open}>
            Choose files
          </Button>
        )}
      </FileInput>
    </div>
  );
}
