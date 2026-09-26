// ────────────────────────────────────────────────────────────────
// CodeExpressionEditor — the CodeMirror 6 editor of expressions and
// templates (P05 WP-5B.5, P5-39). Loaded lazily (its own chunk, with
// CodeMirror); `ExpressionField` renders a plain textarea until it arrives.
//
//   • autocomplete from the scope model of the field's place: roots,
//     fields of typed paths (variables, stage outputs, loop.*/loops.*,
//     item/map/maps, carry names, signals), functions with signatures, and
//     the filters after `|` inside `{{ }}`;
//   • a live parse and type check (the validator's own checker) as lint
//     marks;
//   • hover over a path: its type and its value in the latest run of the
//     workflow.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import { autocompletion, closeBrackets, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { linter, type Diagnostic } from '@codemirror/lint';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap, placeholder as placeholderExt, type Tooltip } from '@codemirror/view';
import { checkExpression, checkTemplate, parseExpression, parseTemplate, type ExprDiagnostic } from '@generatorai/workflow-spec';
import {
  completeExpression,
  filterEntries,
  openPlaceholder,
  pathAt,
  shortType,
  typeAtPath,
  type CompletionEntry,
  type ScopeModel,
} from './scopeModel.js';

export interface LastRunValue {
  /** Which run the value comes from (its name and status). */
  label: string;
  /** The value, or undefined when the path has none in that run. */
  value: unknown;
}

export interface CodeExpressionEditorProps {
  id?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  ariaLabel?: string | undefined;
  /** An expression, or a template (`{{ … }}` placeholders in text). */
  mode: 'expression' | 'template';
  /** A condition must be a boolean (guards, edge `when`, exit rules). */
  expect?: 'boolean' | 'any' | undefined;
  /** The scope model of the field's place, computed on demand from the current graph. */
  getModel: () => ScopeModel | null;
  /** The value of a path in the latest run of this workflow (hover). */
  lastValue?: ((path: string) => Promise<LastRunValue | null>) | undefined;
  /** Minimum height in lines. */
  rows?: number | undefined;
}

function toCompletion(e: CompletionEntry): Completion {
  return { label: e.label, type: e.type, ...(e.detail ? { detail: e.detail } : {}), ...(e.info ? { info: e.info } : {}), ...(e.apply ? { apply: e.apply } : {}) };
}

function diagnostic(d: ExprDiagnostic, length: number): Diagnostic {
  const from = Math.max(0, Math.min(d.start, length));
  const to = Math.max(from, Math.min(Math.max(d.end, d.start + 1), length));
  return { from, to, severity: 'error', message: d.hint ? `${d.message} — ${d.hint}` : d.message, source: d.code };
}

function preview(value: unknown): string {
  if (value === undefined) return 'no value in that run';
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value, null, 1);
  if (text === undefined) return String(value);
  return text.length > 400 ? `${text.slice(0, 397)}…` : text;
}

const theme = EditorView.theme({
  '&': { fontSize: '12px', backgroundColor: 'transparent', color: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', padding: '6px 0', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 10px' },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', lineHeight: '1.5' },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    fontSize: '11px',
    maxWidth: '420px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' },
  '.cm-completionDetail': { color: 'var(--muted-foreground)', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-expr-hover': { padding: '6px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  '.cm-expr-hover-type': { fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
  '.cm-expr-hover-value': { marginTop: '4px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
});

export default function CodeExpressionEditor(props: CodeExpressionEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  // Extensions read the latest props through this ref (they are built once).
  const latest = useRef(props);
  latest.current = props;
  const editable = useRef(new Compartment());
  const attrs = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const p = latest.current;

    const complete = (ctx: CompletionContext): CompletionResult | null => {
      const { mode, getModel } = latest.current;
      const before = ctx.state.sliceDoc(0, ctx.pos);
      let scoped = before;
      if (mode === 'template') {
        const ph = openPlaceholder(before);
        if (ph === null) return null;
        const filter = /\|\s*([A-Za-z_]*)$/.exec(ph);
        if (filter) return { from: ctx.pos - (filter[1]?.length ?? 0), options: filterEntries().map(toCompletion), validFor: /^\w*$/ };
        scoped = before;
      }
      const word = ctx.matchBefore(/[\w.]+$/);
      if (!ctx.explicit && !word && !(mode === 'template' && /\{\{\s*$/.test(before))) return null;
      const model = getModel();
      if (!model) return null;
      const r = completeExpression(model, scoped, mode === 'template');
      if (!r || r.options.length === 0) return null;
      return { from: r.from, options: r.options.map(toCompletion), validFor: /^\w*$/ };
    };

    const lint = (v: EditorView): Diagnostic[] => {
      const { mode, getModel, expect } = latest.current;
      const text = v.state.doc.toString();
      if (!text.trim()) return [];
      const model = getModel();
      const len = text.length;
      if (mode === 'template') {
        if (!text.includes('{{')) return [];
        const diags = model ? checkTemplate(text, model.env, { variableNames: model.variableNames }) : parseTemplate(text).diagnostics;
        return diags.map((d) => diagnostic(d, len));
      }
      if (!model) {
        const parsed = parseExpression(text);
        return parsed.ok ? [] : [diagnostic(parsed.error, len)];
      }
      return checkExpression(text, model.env, { expect: expect ?? 'any' }).diagnostics.map((d) => diagnostic(d, len));
    };

    const hover = hoverTooltip((v, pos): Tooltip | null => {
      const { mode, getModel, lastValue } = latest.current;
      const text = v.state.doc.toString();
      if (mode === 'template' && openPlaceholder(text.slice(0, pos)) === null) return null;
      const at = pathAt(text, pos);
      if (!at) return null;
      const model = getModel();
      const t = model ? typeAtPath(model.env, at.path.split('.')) : undefined;
      if (!t) return null;
      return {
        pos: at.from,
        end: at.to,
        above: true,
        create: () => {
          const dom = document.createElement('div');
          dom.className = 'cm-expr-hover';
          const head = document.createElement('div');
          head.className = 'cm-expr-hover-type';
          head.textContent = `${at.path}: ${shortType(t)}${t.kind === 'unavailable' ? ` — ${t.message}` : ''}`;
          dom.appendChild(head);
          if (lastValue && t.kind !== 'unavailable') {
            const line = document.createElement('div');
            line.className = 'cm-expr-hover-value';
            line.textContent = 'Last run: …';
            dom.appendChild(line);
            lastValue(at.path)
              .then((r) => {
                line.textContent = r ? `Last run (${r.label}): ${preview(r.value)}` : 'No earlier run of this workflow';
              })
              .catch(() => {
                line.textContent = 'Last run: unavailable';
              });
          }
          return { dom };
        },
      };
    });

    const state = EditorState.create({
      doc: p.value,
      extensions: [
        history(),
        closeBrackets(),
        keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        placeholderExt(p.placeholder ?? ''),
        autocompletion({ override: [complete], activateOnTyping: true, icons: false }),
        linter(lint, { delay: 250 }),
        hover,
        theme,
        EditorView.theme({ '.cm-content': { minHeight: `${(p.rows ?? 2) * 18}px` } }),
        editable.current.of([EditorView.editable.of(!p.disabled), EditorState.readOnly.of(!!p.disabled)]),
        attrs.current.of(
          EditorView.contentAttributes.of({
            ...(p.id ? { id: p.id } : {}),
            ...(p.ariaLabel ? { 'aria-label': p.ariaLabel } : {}),
            'aria-multiline': 'true',
            spellcheck: 'false',
          }),
        ),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) latest.current.onChange(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is built once; later prop changes are applied below.
  }, []);

  // An outside change of the value (undo in the builder, a reset) replaces the document.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== props.value) v.dispatch({ changes: { from: 0, to: current.length, insert: props.value } });
  }, [props.value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: [
        editable.current.reconfigure([EditorView.editable.of(!props.disabled), EditorState.readOnly.of(!!props.disabled)]),
        attrs.current.reconfigure(
          EditorView.contentAttributes.of({
            ...(props.id ? { id: props.id } : {}),
            ...(props.ariaLabel ? { 'aria-label': props.ariaLabel } : {}),
            'aria-multiline': 'true',
            spellcheck: 'false',
          }),
        ),
      ],
    });
  }, [props.disabled, props.id, props.ariaLabel]);

  return (
    <div
      ref={host}
      data-testid="expression-editor"
      className="w-full rounded-md border border-input bg-background text-xs transition-all duration-150 focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-primary/20"
    />
  );
}
