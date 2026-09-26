// ────────────────────────────────────────────────────────────────
// StageKindPanels — the builder side panel of the non-agent stage kinds
// (P05: check, loop). An agent stage uses StagePropertiesPanel's tabs.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { X, Settings2, AlertCircle } from 'lucide-react';
import type { StageSpec } from '@generatorai/workflow-spec';
import type { BuilderIssue, StageUpdate } from '@/stores/workflowBuilderStore.js';
import { Button, Input, Textarea } from '@/components/ui/index.js';

export interface StageKindPanelProps {
  stage: Exclude<StageSpec, { kind: 'agent' }>;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
  onClose: () => void;
}

/** A JSON editor of one object field; applies on blur when the text parses. */
function JsonField({ label, value, onApply }: { label: string; value: unknown; onApply: (v: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-foreground">{label}</span>
      <Textarea
        value={text}
        rows={12}
        className="font-mono text-[11px]"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            onApply(JSON.parse(text));
            setError(null);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
      {error && <span className="text-danger">{error}</span>}
    </label>
  );
}

export function StageKindPanel({ stage, onUpdate, issues, onClose }: StageKindPanelProps) {
  const errors = issues.filter((i) => i.severity === 'error');
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Settings2 className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{stage.name}</h3>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {stage.key} · {stage.kind}
            </p>
          </div>
        </div>
        <Button onClick={onClose} aria-label="Close properties panel" variant="ghost" size="icon-sm">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" key={stage.key}>
        {errors.map((i, n) => (
          <p key={n} className="flex items-center gap-1.5 rounded-md bg-danger-muted px-2 py-1 text-[11px] text-danger">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {i.path}: {i.message}
          </p>
        ))}
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-foreground">Name</span>
          <Input value={stage.name} onChange={(e) => onUpdate({ name: e.target.value })} />
        </label>
        {stage.kind === 'loop' ? (
          <JsonField label="Loop settings" value={stage.loop} onApply={(v) => onUpdate({ loop: v })} />
        ) : (
          <JsonField label="Command" value={stage.check} onApply={(v) => onUpdate({ check: v })} />
        )}
      </div>
    </div>
  );
}
