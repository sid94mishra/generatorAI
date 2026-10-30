// ────────────────────────────────────────────────────────────────
// FileInput — a hidden native `<input type="file">` behind a render-prop
// trigger (03 §1.2: `rawInputElement` bans a bare `<input>` outside
// `ui/primitives/**`; a file picker has no P-13 Input/Select equivalent, so
// it gets this one small primitive). Used by C-31 Dropzone's "Choose files"
// fallback button; any future file-picker button can reuse it directly.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface FileInputProps {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Pick a whole folder (every file under it, with `webkitRelativePath`). */
  directory?: boolean;
  onFilesSelected: (files: FileList) => void;
  /** Renders the visible trigger; call `open()` from its click handler. */
  children: (open: () => void) => ReactNode;
  className?: string;
}

/** A hidden file input plus a render-prop trigger that opens the native picker. */
export function FileInput({ accept, multiple = true, disabled, directory = false, onFilesSelected, children, className }: FileInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  // `webkitdirectory` is not a typed React prop; set the attribute directly.
  useEffect(() => {
    ref.current?.toggleAttribute('webkitdirectory', directory);
  }, [directory]);
  return (
    <>
      {children(() => ref.current?.click())}
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className={cn('hidden', className)}
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) onFilesSelected(event.target.files);
          event.target.value = '';
        }}
      />
    </>
  );
}
