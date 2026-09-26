// ────────────────────────────────────────────────────────────────
// The "Map" tab of a map stage (P05 §4.1): the body (the stages whose
// parentKey is the map) runs once per item of a runtime list. The list
// expression and an optional stable item key, the bounds (max items,
// concurrency, tolerated failures), the workspace (shared, or a git
// worktree per item with its setup commands and how the item mounts come
// back, including the judge-picked winner) and extra per-item result
// fields. The cumulative budget lives on the Policy tab.
// ────────────────────────────────────────────────────────────────

import { MAP_MERGES, mapMergeMode, type CheckSpec, type MapMergeMode, type MapSpec, type MapStage } from '@generatorai/workflow-spec';
import type { BuilderIssue, StageUpdate } from '@/stores/workflowBuilderStore.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { ExpressionField } from '../../fields/ExpressionField.js';
import { FieldIssues, issuesAt } from '../../fields/FieldIssues.js';
import { InspectorNote, InspectorRow, InspectorSection } from '../../fields/InspectorLayout.js';
import { ExpressionTable, num } from '../../fields/stageFields.js';
import { CheckCommandFields, CommandAdminNote, EnvTable, mergeCheckSpec } from './checkFields.js';

interface MapTabProps {
  stage: MapStage;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
}

const MERGE_LABELS: Record<MapMergeMode, { label: string; description: string }> = {
  none: { label: 'Keep the item mounts', description: 'Nothing comes back: each item keeps its worktree until the run ends.' },
  sequential: { label: 'Merge each item', description: 'A 3-way merge into the run mount, one item at a time; a conflict fails that item.' },
  pr_per_item: { label: 'A branch (and PR) per item', description: 'Push each item on its own branch; PRs follow the post-processing settings.' },
  winner: {
    label: 'Merge the winner',
    description: 'A stage after the map (a judge) picks one item; only that item is merged into the run mount.',
  },
};
const MERGE_MODES: readonly MapMergeMode[] = [...MAP_MERGES, 'winner'];

const WORKSPACE_LABELS: Record<MapSpec['workspace'], { label: string; description: string }> = {
  shared: { label: 'The run workspace (shared)', description: 'Every item sees and edits the same files.' },
  mount_per_item: {
    label: 'A worktree per item',
    description: 'Each item gets a git worktree cut from a snapshot of the run mounts (uncommitted changes included).',
  },
};

/** A new item setup step (an install that needs no network by default). */
function blankSetup(): CheckSpec {
  return { command: 'pnpm', args: ['install', '--offline'], timeoutMs: 600_000, parseJson: false, failOnNonZero: true, tailBytes: 16_384 };
}

/** Every section of the Map tab (after the stage basics). */
export function MapSections({ stage, onUpdate, issues }: MapTabProps) {
  const map = stage.map;
  /** Merge `updates` into `map`; an `undefined` value removes the field. */
  const setMap = (updates: Partial<MapSpec>) => {
    const next: Record<string, unknown> = { ...map, ...updates };
    for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
    onUpdate({ map: next as MapSpec });
  };
  const perItem = map.workspace === 'mount_per_item';
  const winner = typeof map.merge === 'object' ? map.merge : undefined;
  const mergeMode = mapMergeMode(map.merge);
  const setup = map.itemSetup ?? [];
  const setSetup = (next: CheckSpec[]) => setMap({ itemSetup: next.length > 0 ? next : undefined });

  return (
    <>
      <InspectorSection title="Items">
        <InspectorRow
          label="For each item of"
          stacked
          hint={
            <>
              A list, evaluated when the map starts. In the body, <InlineCode dense>item</InlineCode> is the item and{' '}
              <InlineCode dense>map.index</InlineCode>, <InlineCode dense>map.key</InlineCode>, <InlineCode dense>map.count</InlineCode>{' '}
              describe it.
            </>
          }
        >
          <ExpressionField
            place={{ kind: 'map', context: 'items' }}
            value={map.items}
            onChange={(items) => setMap({ items })}
            placeholder="e.g. stages.plan.output.files"
            issues={issuesAt(issues, '/map/items')}
            ariaLabel="Map items expression"
          />
        </InspectorRow>
        <InspectorRow
          label="Item key"
          stacked
          optional
          hint="A stable key per item (a string); re-running one item names it. Two items with one key fail the map."
        >
          <ExpressionField
            place={{ kind: 'map', context: 'item' }}
            value={map.itemKey ?? ''}
            onChange={(v) => setMap({ itemKey: v.trim() ? v : undefined })}
            placeholder="e.g. item.path (empty: the index)"
            issues={issuesAt(issues, '/map/itemKey')}
            ariaLabel="Map item key expression"
          />
        </InspectorRow>
      </InspectorSection>

      <InspectorSection title="Limits">
        <div className="grid grid-cols-3 gap-2.5">
          <InspectorRow label="Max items" stacked>
            <NumberField
              size="sm"
              aria-label="Max items"
              value={map.maxItems}
              onValueChange={(v) => setMap({ maxItems: Math.min(200, Math.max(1, num(v, 1))) })}
              min={1}
              max={200}
            />
          </InspectorRow>
          <InspectorRow label="Concurrency" stacked>
            <NumberField
              size="sm"
              aria-label="Items at the same time"
              value={map.concurrency}
              onValueChange={(v) => setMap({ concurrency: Math.min(16, Math.max(1, num(v, 1))) })}
              min={1}
              max={16}
            />
          </InspectorRow>
          <InspectorRow label="Tolerated" stacked>
            <NumberField
              size="sm"
              aria-label="Tolerated failed items (%)"
              value={map.toleratedFailurePercent}
              onValueChange={(v) => setMap({ toleratedFailurePercent: Math.min(100, Math.max(0, num(v))) })}
              min={0}
              max={100}
              step={5}
              unit="%"
            />
          </InspectorRow>
        </div>
        <InspectorNote>
          Items at the same time: how many bodies run at once. Above the tolerated share of failed items the map fails; its failed
          items are listed in output.failures.
        </InspectorNote>
        <FieldIssues issues={issuesAt(issues, '/map/maxItems', '/map/concurrency', '/map/toleratedFailurePercent')} />
      </InspectorSection>

      <InspectorSection title="Workspace">
        <InspectorRow label="Items work in" hint={WORKSPACE_LABELS[map.workspace].description}>
          <Select
            aria-label="Map workspace"
            size="sm"
            value={map.workspace}
            onValueChange={(v) =>
              v && setMap(v === 'shared' ? { workspace: 'shared', merge: 'none', itemSetup: undefined } : { workspace: 'mount_per_item' })
            }
            items={(['shared', 'mount_per_item'] as const).map((w) => ({ value: w, label: WORKSPACE_LABELS[w].label }))}
          />
          <FieldIssues issues={issuesAt(issues, '/map/workspace')} />
        </InspectorRow>
        <InspectorRow
          label="When an item finishes"
          hint={perItem ? MERGE_LABELS[mergeMode].description : 'Merges need a worktree per item.'}
        >
          <Select
            aria-label="Map merge"
            size="sm"
            value={mergeMode}
            disabled={!perItem}
            onValueChange={(v) =>
              v && setMap({ merge: v === 'winner' ? { mode: 'winner', key: winner?.key ?? '' } : (v as Exclude<MapMergeMode, 'winner'>) })
            }
            items={MERGE_MODES.map((m) => ({ value: m, label: MERGE_LABELS[m].label }))}
          />
          <FieldIssues issues={issuesAt(issues, '/map/merge').filter((i) => !(i.field ?? '').startsWith('/map/merge/key'))} />
        </InspectorRow>
        {winner ? (
          <InspectorRow
            label="Winner"
            stacked
            hint="The winning item's key, read from a stage after the map (the judge). Stages after the judge wait until the winner is merged; null merges nothing."
          >
            <ExpressionField
              place={{ kind: 'map', context: 'winner' }}
              value={winner.key}
              onChange={(key) => setMap({ merge: { mode: 'winner', key } })}
              placeholder="e.g. stages.judge.output.winner"
              issues={issuesAt(issues, '/map/merge/key')}
              ariaLabel="Map winner key expression"
            />
          </InspectorRow>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Item setup" count={setup.length || undefined}>
        {!perItem ? (
          <InspectorNote>Setup commands run in each item&apos;s own worktree: choose a worktree per item first.</InspectorNote>
        ) : (
          <>
            <InspectorNote>
              Run in each item worktree before its body (a worktree has no dependencies installed); a failing step fails the item.
            </InspectorNote>
            {setup.length > 0 ? <CommandAdminNote what="Item setup runs commands in the repository" /> : null}
            {setup.map((step, i) => {
              const at = `/map/itemSetup/${i}`;
              const setStep = (updates: Partial<CheckSpec>) => setSetup(setup.map((s, j) => (j === i ? mergeCheckSpec(s, updates) : s)));
              return (
                <div key={i} className="flex flex-col gap-2.5 rounded-card border border-line-soft p-2.5">
                  <div className="flex items-center gap-1.5">
                    <Icon concept="terminal" size={14} className="text-fg-3" />
                    <span className="text-ui font-medium text-fg">Step {i + 1}</span>
                    <IconButton
                      icon="trash"
                      size="sm"
                      className="ml-auto"
                      label={`Remove setup step ${i + 1}`}
                      onClick={() => setSetup(setup.filter((_, j) => j !== i))}
                    />
                  </div>
                  <CheckCommandFields spec={step} onChange={setStep} issues={issues} pointer={at} label={`Setup step ${i + 1}`} />
                  <InspectorRow label="Environment" stacked>
                    <EnvTable
                      env={step.env}
                      onChange={(env) => setStep({ env })}
                      issues={issues}
                      pointer={`${at}/env`}
                      label={`Setup step ${i + 1} variable`}
                    />
                  </InspectorRow>
                  <InspectorRow label="Timeout">
                    <NumberField
                      size="sm"
                      aria-label={`Setup step ${i + 1} timeout (seconds)`}
                      value={Math.round(step.timeoutMs / 1000)}
                      onValueChange={(v) => setStep({ timeoutMs: Math.min(3600, Math.max(1, num(v, 1))) * 1000 })}
                      min={1}
                      max={3600}
                      step={30}
                      unit="sec"
                    />
                  </InspectorRow>
                  <FieldIssues issues={issues.filter((x) => x.field === at || x.field === `${at}/timeoutMs`)} />
                </div>
              );
            })}
            <div>
              <Button size="sm" variant="ghost" icon="plus" className="-ml-2" onClick={() => setSetup([...setup, blankSetup()])}>
                Add setup step
              </Button>
            </div>
          </>
        )}
        <FieldIssues issues={issues.filter((x) => x.field === '/map/itemSetup')} />
      </InspectorSection>

      <InspectorSection title="Output" count={Object.keys(map.output.select ?? {}).length || undefined}>
        <InspectorNote>
          <InlineCode dense>stages.{stage.key}.output</InlineCode> has <InlineCode dense>count</InlineCode>,{' '}
          <InlineCode dense>results</InlineCode> and <InlineCode dense>failures</InlineCode>; each result has index, key, item, status,
          error, stages and pr. Extra fields below are evaluated per item (the item and its body stages in scope).
        </InspectorNote>
        <ExpressionTable
          record={map.output.select}
          onChange={(select) => setMap({ output: select ? { select } : {} })}
          issues={issues}
          pointer="/map/output/select"
          noun="field"
          placeholder="e.g. stages.edit.output.summary"
          addLabel="Add result field"
        />
      </InspectorSection>
    </>
  );
}
