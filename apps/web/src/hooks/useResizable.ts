// ────────────────────────────────────────────────────────────────
// useResizable — Hook for drag-resizable panels
// Returns width state, drag handle props, and a ResizeHandle component
// ────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseResizableOptions {
  /** Initial width in pixels */
  initialWidth: number;
  /** Minimum width in pixels */
  minWidth: number;
  /** Maximum width in pixels */
  maxWidth: number;
  /** Direction the handle sits relative to the panel. 'left' means dragging the left edge. */
  side: 'left' | 'right';
}

interface UseResizableReturn {
  /** Current panel width */
  width: number;
  /** Whether the user is currently dragging */
  isDragging: boolean;
  /** Props to spread on the drag handle element */
  handleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    style: React.CSSProperties;
    role: 'separator';
    'aria-label': string;
    'aria-valuenow': number;
    'aria-valuemin': number;
    'aria-valuemax': number;
    tabIndex: number;
  };
}

export function useResizable({
  initialWidth,
  minWidth,
  maxWidth,
  side,
}: UseResizableOptions): UseResizableReturn {
  const [width, setWidth] = useState(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setIsDragging(true);
    },
    [width],
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startXRef.current;
      // If handle is on the left side of panel, dragging left = wider
      const delta = side === 'left' ? -dx : dx;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging, minWidth, maxWidth, side]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 50 : 20;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowRight' ? step : -step;
        setWidth((w) => Math.max(minWidth, Math.min(maxWidth, w + (side === 'left' ? -delta : delta))));
      }
    },
    [minWidth, maxWidth, side],
  );

  const handleProps = {
    onMouseDown,
    onKeyDown,
    style: {
      cursor: 'col-resize' as const,
    },
    role: 'separator' as const,
    'aria-label': 'Resize panel',
    'aria-valuenow': width,
    'aria-valuemin': minWidth,
    'aria-valuemax': maxWidth,
    tabIndex: 0,
  };

  return { width, isDragging, handleProps };
}
