// ────────────────────────────────────────────────────────────────
// P-15 Textarea (03 §2 P-15; Rosetta `textarea.inp`, the ChatCreate/NewChat
// task box).
//
// Same chrome as P-13 Input: 1px `line-strong` border (D-12), `bg-sunken`,
// `fieldFocus` (border-focus + 3px selected halo) / `fieldInvalid` + aria-invalid,
// fg-3 placeholder. The border lives on a wrapper <div>, the native
// <textarea> sits inside it (as Input does), so a footer row can share the box.
//   md     64 min-h, pad 7 10, `text-ui` (lh 1.45 comes with the step),
//          control radius.
//   prose  `text-body` (lh 1.6), pad 10 8 6 12 on the box, card radius,
//          96 min-h (112 with a `footer`): the footer is a bottom row in the
//          same box — an attach icon-button on the left, a KbdHintRow on the
//          right; the caller composes it.
// `autosize` (true | { minRows, maxRows }) grows the field with its content
// up to `maxRows`, then it scrolls. Defaults: md 2…8 rows, prose 3…12 rows.
// Props not listed below go to the <textarea> (value, onChange, name …);
// `className` styles the wrapper, `textareaClassName` the textarea.
// ────────────────────────────────────────────────────────────────

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type InputEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cva } from 'class-variance-authority';
import { Field as BaseField } from '@base-ui/react/field';
import { cn } from '../../lib/cn.js';
import { fieldFocus, fieldInvalid } from '../../lib/focus.js';

// ── Autosize (pure) ────────────────────────────────────────────

export interface AutosizeRows {
  minRows?: number;
  maxRows?: number;
}

export interface AutosizeMetrics {
  /** The textarea's scrollHeight measured at height 0 (content + padding). */
  scrollHeight: number;
  /** One line box in px. */
  lineHeight: number;
  /** padding-top + padding-bottom in px. */
  paddingBlock: number;
  /** border-top + border-bottom in px (box-sizing: border-box). */
  borderBlock: number;
}

/**
 * The border-box height for an autosizing textarea: content height clamped to
 * [minRows, maxRows] lines plus padding and border; `overflow` is true once the
 * content is taller than `maxRows` (the field then scrolls).
 */
export function autosizeHeight(metrics: AutosizeMetrics, rows: AutosizeRows): { height: number; overflow: boolean } {
  const { scrollHeight, lineHeight, paddingBlock, borderBlock } = metrics;
  const chrome = paddingBlock + borderBlock;
  const min = Math.max(1, rows.minRows ?? 1) * lineHeight + chrome;
  const max = rows.maxRows === undefined ? Number.POSITIVE_INFINITY : Math.max(rows.maxRows, rows.minRows ?? 1) * lineHeight + chrome;
  const content = scrollHeight + borderBlock;
  return { height: Math.min(max, Math.max(min, content)), overflow: content > max + 0.5 };
}

/** Resolved line height in px from a computed `line-height` ("18.85px", "1.45" or "normal"). */
export function lineHeightPx(lineHeight: string, fontSize: number): number {
  const n = Number.parseFloat(lineHeight);
  if (Number.isNaN(n)) return fontSize * 1.2;
  return lineHeight.trim().endsWith('px') ? n : n * fontSize;
}

const AUTOSIZE_DEFAULTS: Record<TextareaVariant, Required<AutosizeRows>> = {
  md: { minRows: 2, maxRows: 8 },
  prose: { minRows: 3, maxRows: 12 },
  inline: { minRows: 1, maxRows: 8 },
};

// ── Recipes ────────────────────────────────────────────────────

/**
 * `inline` (P4-08): the field sits inside a box that draws the chrome itself —
 * the composer's `raised` card shows the border and the focus — so the field
 * has no border, fill, padding or halo of its own; `text-body`.
 */
export type TextareaVariant = 'md' | 'prose' | 'inline';

export const textareaShellVariants = cva(
  'flex min-w-0 cursor-text flex-col border border-line-strong bg-sunken text-fg transition-control',
  {
    variants: {
      variant: {
        md: 'rounded-control',
        // pad 10 8 6 12 on the box; the textarea itself has none.
        prose: 'gap-1 rounded-card pt-2.5 pr-2 pb-1.5 pl-3',
        inline: 'border-transparent bg-transparent',
      },
      state: {
        default: fieldFocus,
        invalid: fieldInvalid,
        readOnly: 'bg-transparent text-fg-2',
        disabled: 'cursor-not-allowed text-fg-3',
      },
    },
    // The inline field's box draws focus and state; the field adds none.
    compoundVariants: [{ variant: 'inline', className: 'ring-0 focus-within:border-transparent focus-within:ring-0' }],
    defaultVariants: { variant: 'md', state: 'default' },
  },
);

/**
 * Minimum heights without autosize, so the whole box measures 64 (md) or
 * 96 / 112 (prose, without / with footer): box − border − box padding − footer.
 */
const MIN_HEIGHT = {
  md: 'min-h-15.5',
  prose: 'min-h-19.5',
  proseWithFooter: 'min-h-16.5',
} as const;

// ── Component ──────────────────────────────────────────────────

export interface TextareaProps extends Omit<ComponentProps<'textarea'>, 'ref'> {
  variant?: TextareaVariant;
  /** Grow with the content (`true` = the variant's default rows) up to `maxRows`, then scroll. */
  autosize?: boolean | AutosizeRows;
  /** Bottom row inside the box (prose): attach button left, KbdHintRow right. */
  footer?: ReactNode;
  invalid?: boolean;
  /** Ref to the <textarea>. */
  ref?: Ref<HTMLTextAreaElement>;
  /** Classes for the <textarea> itself (`className` is the wrapper). */
  textareaClassName?: string;
}

/** Base UI's Field.Control swapped to a <textarea>: same props as the element, plus Field wiring. */
function FieldTextarea(props: ComponentProps<'textarea'>) {
  const { rows, ...rest } = props;
  return (
    <BaseField.Control
      {...(rest as unknown as ComponentProps<typeof BaseField.Control>)}
      render={<textarea rows={rows} />}
    />
  );
}

/** A multi-line text field. Label it with <label>, `aria-label` or a kit Field. */
export function Textarea({
  variant = 'md',
  autosize = false,
  footer,
  invalid = false,
  className,
  textareaClassName,
  ref,
  disabled,
  readOnly,
  rows,
  value,
  onInput,
  ...rest
}: TextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const state = disabled ? 'disabled' : invalid ? 'invalid' : readOnly ? 'readOnly' : 'default';

  const enabled = autosize !== false;
  const config = typeof autosize === 'object' ? autosize : {};
  const minRows = config.minRows ?? AUTOSIZE_DEFAULTS[variant].minRows;
  const maxRows = config.maxRows ?? AUTOSIZE_DEFAULTS[variant].maxRows;

  const measure = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !enabled) return;
    const style = getComputedStyle(el);
    const fontSize = Number.parseFloat(style.fontSize) || 13;
    const metrics = {
      lineHeight: lineHeightPx(style.lineHeight, fontSize),
      paddingBlock: (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0),
      borderBlock: (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0),
    };
    // Collapse first so scrollHeight reports the content, not the current box.
    el.style.height = '0px';
    const { height, overflow } = autosizeHeight({ ...metrics, scrollHeight: el.scrollHeight }, { minRows, maxRows });
    el.style.height = `${height}px`;
    el.style.overflowY = overflow ? 'auto' : 'hidden';
  }, [enabled, minRows, maxRows]);

  // Re-measure when a controlled value changes (typing into an uncontrolled
  // field is covered by onInput below).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (enabled) {
      measure();
      return;
    }
    el.style.height = '';
    el.style.overflowY = '';
  }, [enabled, measure, value]);

  // Width changes re-wrap the text: re-measure on width, never on the height we set.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || !enabled || typeof ResizeObserver === 'undefined') return;
    let width = -1;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? width;
      if (next !== width) {
        width = next;
        measure();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, measure]);

  const setRefs = (node: HTMLTextAreaElement | null) => {
    textareaRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  const handleInput = (event: InputEvent<HTMLTextAreaElement>) => {
    measure();
    onInput?.(event);
  };

  // Clicking the box padding (prose) or empty footer space focuses the field.
  const focusTextarea = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target !== textareaRef.current && !target.closest('button, a, input, [role="button"]')) {
      event.preventDefault();
      textareaRef.current?.focus();
    }
  };

  return (
    <div className={cn(textareaShellVariants({ variant, state }), className)} onPointerDown={focusTextarea}>
      {/* Field.Control (rendered as a textarea) registers with a surrounding kit Field,
          so its label names the box; a bare <textarea> was named by its placeholder. */}
      <FieldTextarea
        ref={setRefs}
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        rows={enabled ? minRows : rows}
        aria-invalid={invalid || undefined}
        onInput={handleInput}
        className={cn(
          'block w-full min-w-0 bg-transparent text-current outline-none placeholder:text-fg-3 disabled:cursor-not-allowed',
          variant === 'md' ? 'px-2.5 py-1.75 text-ui' : 'text-body',
          variant === 'inline'
            ? 'resize-none'
            : enabled
              ? 'resize-none'
              : ['resize-y', variant === 'md' ? MIN_HEIGHT.md : footer != null ? MIN_HEIGHT.proseWithFooter : MIN_HEIGHT.prose],
          textareaClassName,
        )}
        {...rest}
      />
      {footer != null ? (
        <div className={cn('flex min-w-0 items-center gap-2', variant === 'md' && 'px-2.5 pb-1.5')}>{footer}</div>
      ) : null}
    </div>
  );
}
