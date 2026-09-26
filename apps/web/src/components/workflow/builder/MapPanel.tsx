// ────────────────────────────────────────────────────────────────
// MapPanel — the inspector of a map stage (P05 §4.1, WP-5B.1).
//
// A map runs its body (the stages whose parentKey is the map) once per
// item of a runtime list: the list expression and an optional stable item
// key, the bounds (max items, concurrency, tolerated failures), the
// workspace (shared, or a git worktree per item with its setup commands
// and how the item mounts come back), the cumulative budget and extra
// per-item result fields. Inside the body `item`, `map.index`,
// `map.count` and `maps.<key>.item` are in scope.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { GitMerge, Layers3, ListChecks, Package, Plus, SquareTerminal, Trash2, Wand2 } from 'lucide-react';
import { MAP_MERGES, mapMergeMode, type CheckSpec, type MapMergeMode, type MapSpec, type MapStage } from '@generatorai/workflow-spec';
import type { BuilderIssue, StageUpdate } from '@/stores/workflowBuilderStore.js';
import { Button, Select } from '@/components/ui/index.js';
import { CollapsibleSection } from '../CollapsibleSection.js';
import { NumberStepper } from '../NumberStepper.js';
import { ExpressionField, FieldIssues, issuesAt } from '../engineGate.js';
import { CheckCommandFields, CommandAdminNote, EnvTable, mergeCheckSpec } from './CheckPanel.js';
import { BudgetFields, ExpressionTable } from './fields.js';

interface MapPanelProps {
  stage: MapStage;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
}

const MERGE_LABELS: Record<MapMergeMode, { label: string; description: string }> = {
  none: { label: 'Keep the item mounts', description: 'Nothing comes back: each item keeps its worktree until the run ends' },
  sequential: { label: 'Merge each item', description: 'A 3-way merge into the run mount, one item at a time; a conflict fails that item' },
  pr_per_item: { label: 'A branch (and PR) per item', description: 'Push each item on its own branch; PRs follow the post-processing settings' },
  winner: { label: 'Merge the winner', description: 'A stage after the map (a judge) picks one item; only that item is merged into the run mount' },
};
const MERGE_MODES: readonly MapMergeMode[] = [...MAP_MERGES, 'winner'];

/** A new item setup step (an install that needs no network by default). */
function blankSetup(): CheckSpec {
  return { command: 'pnpm', args: ['install', '--offline'], timeoutMs: 600_000, parseJson: false, failOnNonZero: true, tailBytes: 16_384 };
}

export function MapPanel({ stage, onUpdate, issues }: MapPanelProps) {
  const map = stage.map;
  /** Merge `updates` into `map`; an `undefined` value removes the field. */
  const setMap = (updates: Partial<MapSpec>) => {
    const next: Record<string, unknown> = { ...map, ...updates };
    for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
    onUpdate({ map: next as MapSpec });
  };
  const perItem = map.workspace === 'mount_per_item';
  const winner = typeof map.merge === 'object' ? map.merge : undefined;
  const setup = map.itemSetup ?? [];
  const setSetup = (next: CheckSpec[]) => setMap({ itemSetup: next.length > 0 ? next : undefined });

  return (
    <div>
      <CollapsibleSection title="Items" icon={<Layers3 className="h-3.5 w-3.5" />} defaultOpen>
        <div>
          <label htmlFor="map-items" className="mb-1.5 block text-xs font-medium text-foreground">For each item of</label>
          <ExpressionField
            id="map-items"
            place={{ kind: 'map', context: 'items' }}
            value={map.items}
            onChange={(items) => setMap({ items })}
            placeholder="e.g. stages.plan.output.files"
            issues={issuesAt(issues, '/map/items')}
            ariaLabel="Map items expression"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            A list, evaluated when the map starts. In the body, <code>item</code> is the item and <code>map.index</code>,{' '}
            <code>map.key</code>, <code>map.count</code> describe it.
          </p>
        </div>
        <div>
          <label htmlFor="map-item-key" className="mb-1.5 block text-xs font-medium text-foreground">Item key</label>
          <ExpressionField
            id="map-item-key"
            place={{ kind: 'map', context: 'item' }}
            value={map.itemKey ?? ''}
            onChange={(v) => setMap({ itemKey: v.trim() ? v : undefined })}
            placeholder="e.g. item.path (empty: the index)"
            issues={issuesAt(issues, '/map/itemKey')}
            ariaLabel="Map item key expression"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            A stable key per item (a string); re-running one item names it. Two items with one key fail the map.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Limits" icon={<ListChecks className="h-3.5 w-3.5" />} defaultOpen>
        <NumberStepper label="Max items" value={map.maxItems} onChange={(maxItems) => setMap({ maxItems })} min={1} max={200} />
        <FieldIssues issues={issuesAt(issues, '/map/maxItems')} />
        <NumberStepper
          label="Items at the same time"
          value={map.concurrency}
          onChange={(concurrency) => setMap({ concurrency })}
          min={1}
          max={16}
        />
        <FieldIssues issues={issuesAt(issues, '/map/concurrency')} />
        <NumberStepper
          label="Tolerated failed items (%)"
          value={map.toleratedFailurePercent}
          onChange={(toleratedFailurePercent) => setMap({ toleratedFailurePercent })}
          min={0}
          max={100}
          step={5}
          unit="%"
        />
        <p className="text-[10px] text-muted-foreground">Above this share of failed items the map fails; its failed items are listed in output.failures.</p>
        <FieldIssues issues={issuesAt(issues, '/map/toleratedFailurePercent')} />
      </CollapsibleSection>

      <CollapsibleSection title="Workspace" icon={<GitMerge className="h-3.5 w-3.5" />} defaultOpen={perItem}>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Items work in</label>
          <Select
            aria-label="Map workspace"
            value={map.workspace}
            onChange={(v) =>
              setMap(
                v === 'shared'
                  ? { workspace: 'shared', merge: 'none', itemSetup: undefined }
                  : { workspace: 'mount_per_item' },
              )
            }
            options={[
              { value: 'shared', label: 'The run workspace (shared)', description: 'Every item sees and edits the same files' },
              {
                value: 'mount_per_item',
                label: 'A worktree per item',
                description: 'Each item gets a git worktree cut from a snapshot of the run mounts (uncommitted changes included)',
              },
            ]}
          />
          <FieldIssues issues={issuesAt(issues, '/map/workspace')} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">When an item finishes</label>
          <Select
            aria-label="Map merge"
            value={mapMergeMode(map.merge)}
            onChange={(v) =>
              setMap({ merge: v === 'winner' ? { mode: 'winner', key: winner?.key ?? '' } : (v as Exclude<MapMergeMode, 'winner'>) })
            }
            disabled={!perItem}
            options={MERGE_MODES.map((m) => ({ value: m, label: MERGE_LABELS[m].label, description: MERGE_LABELS[m].description }))}
          />
          {!perItem && <p className="mt-1 text-[10px] text-muted-foreground">Merges need a worktree per item.</p>}
          <FieldIssues issues={issuesAt(issues, '/map/merge')} />
        </div>
        {winner && (
          <div>
            <label htmlFor="map-winner-key" className="mb-1.5 block text-xs font-medium text-foreground">Winner</label>
            <ExpressionField
              id="map-winner-key"
              place={{ kind: 'map', context: 'winner' }}
              value={winner.key}
              onChange={(key) => setMap({ merge: { mode: 'winner', key } })}
              placeholder="e.g. stages.judge.output.winner"
              issues={issuesAt(issues, '/map/merge/key')}
              ariaLabel="Map winner key expression"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              The winning item&apos;s key, read from a stage after the map (the judge). Stages after the judge wait until the winner is merged; null merges nothing.
            </p>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Item setup"
        icon={<Wand2 className="h-3.5 w-3.5" />}
        defaultOpen={setup.length > 0}
        badge={setup.length > 0 ? String(setup.length) : undefined}
      >
        {!perItem ? (
          <p className="text-[10px] text-muted-foreground">
            Setup commands run in each item&apos;s own worktree: choose a worktree per item first.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground">
              Run in each item worktree before its body (a worktree has no dependencies installed); a failing step fails the item.
            </p>
            {setup.length > 0 && <CommandAdminNote what="Item setup runs commands in the repository" />}
            {setup.map((step, i) => {
              const at = `/map/itemSetup/${i}`;
              const setStep = (updates: Partial<CheckSpec>) => setSetup(setup.map((s, j) => (j === i ? mergeCheckSpec(s, updates) : s)));
              return (
                <div key={i} className="space-y-3 rounded-lg border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <SquareTerminal className="h-3.5 w-3.5" /> Step {i + 1}
                    </span>
                    <Button
                      type="button"
                      onClick={() => setSetup(setup.filter((_, j) => j !== i))}
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove setup step ${i + 1}`}
                      className="h-auto w-auto p-1 text-muted-foreground hover:bg-transparent hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <CheckCommandFields spec={step} onChange={setStep} issues={issues} pointer={at} idPrefix={`setup-${i}`} label={`Setup step ${i + 1}`} />
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-foreground">Environment</label>
                    <EnvTable env={step.env} onChange={(env) => setStep({ env })} issues={issues} pointer={`${at}/env`} />
                  </div>
                  <NumberStepper
                    label="Timeout (seconds)"
                    value={Math.round(step.timeoutMs / 1000)}
                    onChange={(v) => setStep({ timeoutMs: v * 1000 })}
                    min={1}
                    max={3600}
                    step={30}
                    unit="sec"
                  />
                  <FieldIssues issues={issues.filter((x) => x.field === at || x.field === `${at}/timeoutMs`)} />
                </div>
              );
            })}
            <Button
              type="button"
              onClick={() => setSetup([...setup, blankSetup()])}
              variant="ghost"
              size="sm"
              className="h-auto gap-1 bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
            >
              <Plus className="h-3 w-3" /> Add setup step
            </Button>
            <FieldIssues issues={issues.filter((x) => x.field === '/map/itemSetup')} />
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Budget" icon={<ListChecks className="h-3.5 w-3.5" />} defaultOpen={!!stage.budget}>
        <p className="text-[10px] text-muted-foreground">Cumulative over every item.</p>
        <BudgetFields budget={stage.budget} onChange={(budget) => onUpdate({ budget })} issues={issuesAt(issues, '/budget')} />
      </CollapsibleSection>

      <CollapsibleSection title="Output" icon={<Package className="h-3.5 w-3.5" />} defaultOpen={!!map.output.select}>
        <p className="text-[10px] text-muted-foreground">
          <code>stages.{stage.key}.output</code> has <code>count</code>, <code>results</code> and <code>failures</code>; each
          result has index, key, item, status, error, stages and pr. Extra fields below are evaluated per item (the item and its
          body stages in scope).
        </p>
        <ExpressionTable
          record={map.output.select}
          onChange={(select) => setMap({ output: select ? { select } : {} })}
          issues={issues}
          pointer="/map/output/select"
          noun="field"
          placeholder="e.g. stages.edit.output.summary"
          addLabel="Add result field"
        />
      </CollapsibleSection>
    </div>
  );
}
