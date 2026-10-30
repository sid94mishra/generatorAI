// ────────────────────────────────────────────────────────────────
// CanvasPanels — the controls floating over the builder canvas (board
// WorkflowBuilder): the top-left "Add stage ▾ A" card with the kind palette
// (WF-16) and the edge legend, the multi-selection bar (Wrap in loop / map,
// Unwrap), the bottom-left zoom bar, and the empty-canvas prompt.
// ────────────────────────────────────────────────────────────────

import { useRef } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import type { EdgeOn, StageKind } from '@generatorai/workflow-spec';
import { StageKindPalette, type StageKindOption, type StageKindPick } from '@/blocks/workflow/StageKindPalette/StageKindPalette.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { PopoverPopup, PopoverRoot, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';
import { ADDABLE_KINDS, KIND_META } from '../model/kindMeta.js';
import { EDGE_DASHES, EDGE_LABELS, EDGE_STROKES, EDGE_TEXT } from '../model/edgeStyles.js';
import { FIT_OPTIONS } from './canvasTheme.js';
import type { StagePreset } from './stageTemplates.js';

/** A floating card on the canvas. */
const CARD = 'flex items-center gap-0.5 rounded-card border border-line-soft bg-raised p-0.5';

const KIND_OPTIONS: readonly StageKindOption<StageKind>[] = ADDABLE_KINDS.map((kind) => ({
  kind,
  icon: KIND_META[kind].icon,
  name: KIND_META[kind].name,
  hint: KIND_META[kind].hint,
  ...(KIND_META[kind].admin ? { admin: true } : {}),
}));

// ── Add stage ──────────────────────────────────────────────────

export interface AddStageControlProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The default kind straight away (the button's main part). */
  onAddDefault: () => void;
  onPick: (pick: StageKindPick<StageKind>) => void;
  templates: readonly StagePreset[] | null;
}

/** "+ Add stage" (adds an agent stage) and "▾ A", which opens the kind palette. */
export function AddStageControl({ open, onOpenChange, onAddDefault, onPick, templates }: AddStageControlProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <PopoverRoot open={open} onOpenChange={(next) => onOpenChange(next)}>
      <div ref={cardRef} className={CARD}>
        <Button variant="ghost" size="sm" icon="plus" onClick={onAddDefault} title="Add an agent stage">
          Add stage
        </Button>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              trailingIcon="chevron-down"
              shortcut={['A']}
              aria-label="Add a stage of another kind"
              title="Add a stage of another kind or a template (A)"
            />
          }
        />
      </div>
      <PopoverPopup anchor={cardRef} align="start" className="w-97.5 p-1" initialFocus={inputRef}>
        <StageKindPalette<StageKind>
          kinds={KIND_OPTIONS}
          templates={templates?.map((t) => ({ id: t.name, title: t.title, description: t.description })) ?? null}
          onPick={onPick}
          inputRef={inputRef}
        />
      </PopoverPopup>
    </PopoverRoot>
  );
}

// ── Edge legend ────────────────────────────────────────────────

const SWATCH_WIDTH = 16;
const SWATCH_HEIGHT = 2;

/** The edge kinds on the canvas, each with its stroke (only kinds the graph uses). */
export function EdgeLegend({ kinds, handlesFailure }: { kinds: readonly EdgeOn[]; handlesFailure: boolean }) {
  if (kinds.length === 0 && !handlesFailure) return null;
  return (
    <div className={cn(CARD, 'h-control gap-3 px-2.5 text-small')} aria-label="Edge legend" role="group">
      {kinds.map((on) => (
        <span key={on} className={cn('flex items-center gap-1.5', on === 'failure' ? EDGE_TEXT[on] : 'text-fg-3')}>
          <svg aria-hidden width={SWATCH_WIDTH} height={SWATCH_HEIGHT}>
            <line
              x1={0}
              y1={SWATCH_HEIGHT / 2}
              x2={SWATCH_WIDTH}
              y2={SWATCH_HEIGHT / 2}
              stroke={EDGE_STROKES[on]}
              strokeWidth={SWATCH_HEIGHT}
              strokeDasharray={EDGE_DASHES[on]}
            />
          </svg>
          {EDGE_LABELS[on]}
        </span>
      ))}
      {handlesFailure ? (
        <span className="flex items-center gap-1.5 text-fg-3">
          <Icon concept="shield" size={12} />
          Handles failure
        </span>
      ) : null}
    </div>
  );
}

// ── Selection bar ──────────────────────────────────────────────

const SCOPE_RULE = 'Select stages of one scope (all top level, or all in one container)';

export interface SelectionBarProps {
  count: number;
  /** Every selected stage shares one scope (wrapping needs that). */
  sameScope: boolean;
  /** The one selected stage when it is a container (Unwrap). */
  containerKey: string | null;
  onWrap: (kind: 'loop' | 'map') => void;
  onUnwrap: (key: string) => void;
}

/** "N selected · Wrap in loop · Wrap in map · Unwrap". */
export function SelectionBar({ count, sameScope, containerKey, onWrap, onUnwrap }: SelectionBarProps) {
  return (
    <div className={cn(CARD, 'pl-2.5 text-small text-fg-2')} role="group" aria-label="Selection">
      <span className="pr-1">{count} selected</span>
      <Tooltip content={sameScope ? 'Repeat the selected stages in a new loop' : SCOPE_RULE} side="bottom">
        <span className="inline-flex">
          <Button variant="ghost" size="sm" icon="repeat" disabled={!sameScope} onClick={() => onWrap('loop')}>
            Wrap in loop
          </Button>
        </span>
      </Tooltip>
      <Tooltip content={sameScope ? 'Run the selected stages once per item of a list' : SCOPE_RULE} side="bottom">
        <span className="inline-flex">
          <Button variant="ghost" size="sm" icon="layers" disabled={!sameScope} onClick={() => onWrap('map')}>
            Wrap in map
          </Button>
        </span>
      </Tooltip>
      {containerKey ? (
        <Button variant="ghost" size="sm" icon="ungroup" onClick={() => onUnwrap(containerKey)}>
          Unwrap
        </Button>
      ) : null}
    </div>
  );
}

// ── Zoom bar ───────────────────────────────────────────────────

/** Zoom out · "100%" (resets to 100%) · zoom in · fit view. */
export function ZoomBar() {
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className={CARD} role="group" aria-label="Zoom">
      <IconButton size="sm" icon="zoom-out" label="Zoom out" onClick={() => void flow.zoomOut({ duration: 150 })} />
      <Button variant="ghost" size="sm" className="min-w-12 tabular-nums" title="Reset zoom to 100%" onClick={() => void flow.zoomTo(1, { duration: 150 })}>
        {Math.round(zoom * 100)}%
      </Button>
      <IconButton size="sm" icon="zoom-in" label="Zoom in" onClick={() => void flow.zoomIn({ duration: 150 })} />
      <IconButton size="sm" icon="maximize" label="Fit view" onClick={() => void flow.fitView({ ...FIT_OPTIONS, duration: 300 })} />
    </div>
  );
}

// ── Empty canvas ───────────────────────────────────────────────

/** The prompt an empty canvas shows, with its "Add first stage" action. */
export function EmptyCanvas({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-5 flex items-center justify-center p-6">
      <div className="pointer-events-auto rounded-card border border-line-soft bg-raised px-10 py-8">
        <EmptyState
          icon="workflows"
          title="Start building your workflow"
          description="Add a stage, or press A to pick a kind or a stage template."
          action={
            <Button variant="primary" icon="plus" onClick={onAdd}>
              Add first stage
            </Button>
          }
        />
      </div>
    </div>
  );
}
