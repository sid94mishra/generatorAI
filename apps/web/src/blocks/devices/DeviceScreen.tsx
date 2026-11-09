// ────────────────────────────────────────────────────────────────
// DeviceScreen (docs/devices §2): the live device screen, fitted to the pane
// at the device's aspect ratio, with
//   • input — click-drag is a touch, the wheel scrolls, typed keys and paste
//     go to the device while it has focus (it owns every key: D-46);
//   • agent marks — a ripple at each agent tap, a trail for each swipe (DV-12);
//   • Select — the element under the pointer outlined from the latest
//     snapshot; a click picks it (DV-11).
// All coordinates are fractions of the screen (DV-6).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import type { DeviceActionMark, DeviceElement, DeviceInputEvent, DeviceKey, DeviceSnapshot } from '@generatorai/shared';
import { elementAt } from './deviceSelection.js';
import { cn } from '@/ui/lib/cn.js';

const NAMED_KEYS: Record<string, DeviceKey> = {
  Enter: 'enter',
  Backspace: 'delete',
  Tab: 'tab',
  Escape: 'escape',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export interface DeviceScreenProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Native size; the frame keeps its aspect ratio. */
  size: { width: number; height: number } | null;
  hasFrame: boolean;
  /** The user may touch and type (false while the agent drives and the user has not taken over). */
  interactive: boolean;
  marks: DeviceActionMark[];
  send: (event: DeviceInputEvent) => void;
  /** Select mode: hover outlines, click picks. */
  selecting: boolean;
  snapshot: DeviceSnapshot | null;
  onPick: (element: DeviceElement) => void;
  onCancelSelect: () => void;
  label: string;
}

function fit(box: { width: number; height: number }, size: { width: number; height: number } | null) {
  if (!size || size.width === 0 || size.height === 0 || box.width === 0 || box.height === 0) return null;
  const scale = Math.min(box.width / size.width, box.height / size.height);
  return { width: Math.floor(size.width * scale), height: Math.floor(size.height * scale) };
}

export function DeviceScreen({
  canvasRef,
  size,
  hasFrame,
  interactive,
  marks,
  send,
  selecting,
  snapshot,
  onPick,
  onCancelSelect,
  label,
}: DeviceScreenProps): React.JSX.Element {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<DeviceElement | null>(null);
  const down = useRef(false);
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      // 16 px of breathing room around the screen.
      setBox({ width: Math.max(0, entry.contentRect.width - 32), height: Math.max(0, entry.contentRect.height - 32) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!selecting) setHover(null);
  }, [selecting]);

  const dims = fit(box, size);

  const point = (e: PointerEvent<HTMLElement> | WheelEvent<HTMLElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.focus();
    if (selecting) return;
    if (!interactive || e.button !== 0) return;
    down.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    send({ type: 'touch', action: 'down', ...point(e) });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = point(e);
    if (selecting) {
      setHover(snapshot ? (elementAt(snapshot, p.x, p.y) ?? null) : null);
      return;
    }
    if (!down.current) return;
    // One move per animation frame: a trackpad emits far more than the device needs.
    pendingMove.current = p;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      if (pendingMove.current && down.current) send({ type: 'touch', action: 'move', ...pendingMove.current });
      pendingMove.current = null;
    });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (selecting) {
      const p = point(e);
      const el = snapshot ? elementAt(snapshot, p.x, p.y) : undefined;
      if (el) onPick(el);
      return;
    }
    if (!down.current) return;
    down.current = false;
    send({ type: 'touch', action: 'up', ...point(e) });
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!interactive || selecting) return;
    const p = point(e);
    // A wheel notch (~100 px) scrolls about a tenth of the screen.
    send({ type: 'scroll', x: p.x, y: p.y, dx: e.deltaX / 1000, dy: e.deltaY / 1000 });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (selecting && e.key === 'Escape') {
      e.preventDefault();
      onCancelSelect();
      return;
    }
    if (!interactive) return;
    // Leave app shortcuts (⌘/Ctrl chords) alone; paste arrives as a paste event.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const named = NAMED_KEYS[e.key];
    if (named) {
      e.preventDefault();
      send({ type: 'key', key: named });
    } else if (e.key.length === 1) {
      e.preventDefault();
      send({ type: 'text', text: e.key });
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      e.preventDefault();
      send({ type: 'text', text });
    }
  };

  return (
    <div ref={areaRef} data-testid="device-screen-area" className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-sunken">
      <div
        data-testid="device-screen"
        role="application"
        aria-label={label}
        aria-roledescription="device screen"
        tabIndex={0}
        data-gai-keys="own"
        className={cn(
          'relative overflow-hidden rounded-card bg-ground shadow-pop ring-1 ring-line focus-visible:ring-2 focus-visible:ring-accent focus:outline-none',
          selecting ? 'cursor-crosshair' : interactive ? 'cursor-pointer' : 'cursor-default',
          !dims && 'hidden',
        )}
        style={dims ? { width: dims.width, height: dims.height } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          down.current = false;
        }}
        onPointerLeave={() => setHover(null)}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={canvasRef} className={cn('block h-full w-full select-none', !hasFrame && 'opacity-0')} />

        {marks.map((m) =>
          m.kind === 'swipe' && m.toX !== undefined && m.toY !== undefined && m.x !== undefined && m.y !== undefined && dims ? (
            <SwipeTrail key={`${m.at}-${m.x}`} mark={m} dims={dims} />
          ) : m.x !== undefined && m.y !== undefined ? (
            <span
              key={`${m.at}-${m.x}`}
              data-testid="device-tap-mark"
              aria-hidden
              className="pointer-events-none absolute size-8 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
            >
              <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
              <span className="absolute inset-2 rounded-full border-2 border-accent bg-run-bg" />
            </span>
          ) : null,
        )}

        {selecting && hover && (
          <div
            data-testid="device-select-outline"
            className="pointer-events-none absolute rounded-badge border-2 border-accent bg-run-bg"
            style={{
              left: `${hover.frame.x * 100}%`,
              top: `${hover.frame.y * 100}%`,
              width: `${hover.frame.w * 100}%`,
              height: `${hover.frame.h * 100}%`,
            }}
          >
            <span className="absolute -top-6 left-0 max-w-64 truncate rounded-badge bg-accent px-1.5 py-0.5 font-mono text-micro text-on-accent">
              {hover.role}
              {hover.label ? ` · ${hover.label}` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** A fading line from where a swipe started to where it ended. */
function SwipeTrail({ mark, dims }: { mark: DeviceActionMark; dims: { width: number; height: number } }) {
  const x1 = (mark.x ?? 0) * dims.width;
  const y1 = (mark.y ?? 0) * dims.height;
  const x2 = (mark.toX ?? 0) * dims.width;
  const y2 = (mark.toY ?? 0) * dims.height;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return (
    <span
      data-testid="device-swipe-mark"
      aria-hidden
      className="pointer-events-none absolute origin-left animate-pulse border-t-4 border-accent"
      style={{ left: x1, top: y1, width: length, transform: `rotate(${angle}deg)` }}
    />
  );
}
