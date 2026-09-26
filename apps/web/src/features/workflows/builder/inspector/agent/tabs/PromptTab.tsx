// ────────────────────────────────────────────────────────────────
// Prompt tab (WorkflowStagePrompt board): Name · Key, Description and the
// container; Context — what earlier stages pass in (From: the source
// stages, empty = the direct predecessors; Mode) —; the prompts; and for a
// loop body the "Loop iterations" section (session reuse, compaction,
// follow-up prompts).
// ────────────────────────────────────────────────────────────────

import { useShallow } from 'zustand/react/shallow';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { FieldIssues, issuesAt } from '../../../fields/FieldIssues.js';
import { InspectorNote, InspectorSection } from '../../../fields/InspectorLayout.js';
import { StageBasics } from '../../../fields/StageBasics.js';
import type { AgentStageSpec } from '../../types.js';
import { PromptList, addPrompt } from '../PromptList.js';
import { Row } from '../Row.js';
import type { AgentTabProps } from './tabProps.js';

type ContextMode = AgentStageSpec['context']['mode'];

const CONTEXT_MODES: { value: ContextMode; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'output', label: 'Output' },
  { value: 'structured', label: 'Structured' },
  { value: 'none', label: 'None' },
];

const CONTEXT_HINTS: Record<ContextMode, string> = {
  summary: 'Each source stage’s summary.',
  output: 'The complete output text.',
  structured: 'The JSON output.',
  none: 'The stage starts with a clean slate.',
};

/** "What earlier stages pass in": the source stages as chips (+ Add) and the mode. */
function ContextSection({ stage, onUpdate, issues }: AgentTabProps) {
  const others = useWorkflowBuilderStore(
    useShallow((s) => s.nodes.filter((n) => n.id !== stage.key).map((n) => `${n.id}\u0000${n.data.stage.name}`)),
  ).map((entry) => {
    const [key, name] = entry.split('\u0000') as [string, string];
    return { key, name };
  });
  const from = stage.context.from;
  const setFrom = (next: string[] | undefined) => {
    const context = { ...stage.context };
    if (next === undefined) delete context.from;
    else context.from = next;
    onUpdate({ context });
  };
  const nameOf = (key: string) => others.find((o) => o.key === key)?.name ?? key;
  const addable = others.filter((o) => !(from ?? []).includes(o.key));

  return (
    <InspectorSection title="Context" action={<span className="text-small text-fg-3">what earlier stages pass in</span>}>
      {stage.context.mode !== 'none' && (others.length > 0 || from !== undefined) ? (
        <Row label="From" hint={from === undefined ? 'The direct predecessors.' : from.length === 0 ? 'No source stages: nothing is passed in.' : undefined}>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="context-sources">
            {(from ?? []).map((key) => (
              <Chip
                key={key}
                mono
                size="sm"
                title={nameOf(key)}
                onRemove={() => setFrom(from!.filter((k) => k !== key).length > 0 ? from!.filter((k) => k !== key) : undefined)}
                removeLabel={`Remove context source ${key}`}
              >
                {key}
              </Chip>
            ))}
            {addable.length > 0 || from !== undefined ? (
              <Menu.Root>
                <Menu.Trigger
                  render={
                    <Button variant="ghost" size="sm" icon="plus" aria-label="Add context source">
                      Add
                    </Button>
                  }
                />
                <Menu.Popup className="max-h-80 overflow-y-auto">
                  {from !== undefined ? (
                    <>
                      <Menu.Item icon="undo" onClick={() => setFrom(undefined)}>
                        Direct predecessors (default)
                      </Menu.Item>
                      {addable.length > 0 ? <Menu.Separator /> : null}
                    </>
                  ) : null}
                  {addable.map((o) => (
                    <Menu.Item key={o.key} icon="workflows" trailing={<span className="font-mono">{o.key}</span>} onClick={() => setFrom([...(from ?? []), o.key])}>
                      {o.name || o.key}
                    </Menu.Item>
                  ))}
                </Menu.Popup>
              </Menu.Root>
            ) : null}
          </div>
        </Row>
      ) : null}
      <Row label="Mode" stacked hint={CONTEXT_HINTS[stage.context.mode]}>
        <SegmentedControl
          label="Context mode"
          value={stage.context.mode}
          onValueChange={(mode) => onUpdate({ context: { ...stage.context, mode } })}
          items={CONTEXT_MODES}
        />
      </Row>
      <FieldIssues issues={issuesAt(issues, '/context')} />
    </InspectorSection>
  );
}

/**
 * How a body agent of a loop behaves from one iteration to the next:
 * follow-up prompts (sent instead of `prompts` from the second iteration
 * on), one continuing conversation or a fresh one each time, and compaction
 * of a continuing conversation. Shown for a stage inside a loop, and outside
 * one while any of these is still set (they only warn there), so it can be
 * cleared.
 */
function LoopIterationSection({ stage, onUpdate, issues }: AgentTabProps) {
  const inLoop = useWorkflowBuilderStore(
    (s) => !!stage.parentKey && s.nodes.find((n) => n.id === stage.parentKey)?.data.stage.kind === 'loop',
  );
  const followUps = stage.followUpPrompts;
  if (!inLoop && stage.sessionReuse === 'fresh' && !followUps && stage.compactAfter === undefined) return null;
  const continues = stage.sessionReuse === 'continue';

  return (
    <InspectorSection
      title="Loop iterations"
      count={followUps?.length ? followUps.length : undefined}
      data-testid="loop-iterations"
    >
      {!inLoop ? <InspectorNote tone="warn">This stage is not in a loop: these settings have no effect.</InspectorNote> : null}
      <Row
        label="Session reuse"
        hint={continues ? 'One conversation for the whole loop.' : 'A new conversation every iteration.'}
      >
        <SegmentedControl
          label="Session reuse"
          value={stage.sessionReuse}
          // compactAfter only applies to a continuing conversation.
          onValueChange={(v) => onUpdate(v === 'continue' ? { sessionReuse: 'continue' } : { sessionReuse: 'fresh', compactAfter: undefined })}
          items={[
            { value: 'fresh', label: 'Fresh' },
            { value: 'continue', label: 'Continue' },
          ]}
        />
        <FieldIssues issues={issuesAt(issues, '/sessionReuse')} />
      </Row>
      <Row
        label="Compact every"
        hint={
          continues
            ? 'Replaces the conversation with a fresh one seeded with a digest of the iterations so far (no model call). 0 = never.'
            : 'Only with a continuing conversation.'
        }
      >
        <NumberField
          size="sm"
          className="w-32"
          aria-label="Compact every N iterations"
          unit="iterations"
          value={stage.compactAfter ?? 0}
          onValueChange={(v) => onUpdate({ compactAfter: continues && v && v > 0 ? Math.min(20, Math.round(v)) : undefined })}
          min={0}
          max={continues ? 20 : 0}
          disabled={!continues}
        />
        <FieldIssues issues={issuesAt(issues, '/compactAfter')} />
      </Row>
      <Switch
        label="Different prompts from the second iteration"
        checked={followUps !== undefined}
        onCheckedChange={(checked) => onUpdate({ followUpPrompts: checked ? [] : undefined })}
      />
      <InspectorNote>Sent instead of the prompts above from iteration 2 on; they can read loop.last, loop.carry and loop.operatorInput.</InspectorNote>
      {followUps !== undefined ? (
        <>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" icon="plus" onClick={() => onUpdate({ followUpPrompts: addPrompt(followUps, 'Follow-up') })}>
              Add follow-up
            </Button>
          </div>
          <PromptList
            prompts={followUps}
            onChange={(followUpPrompts) => onUpdate({ followUpPrompts })}
            contentLabel="Follow-up"
            stageKey={stage.key}
            issues={issues}
            pointer="/followUpPrompts"
          />
        </>
      ) : null}
      <FieldIssues issues={issues.filter((i) => i.field === '/followUpPrompts')} />
    </InspectorSection>
  );
}

export function PromptTab(props: AgentTabProps) {
  const { stage, onUpdate, issues } = props;
  return (
    <>
      <StageBasics stage={stage} issues={issues} onUpdate={onUpdate} />
      <ContextSection {...props} />
      <InspectorSection
        title="Prompts"
        count={stage.prompts.length}
        action={
          <Button variant="ghost" size="sm" icon="plus" onClick={() => onUpdate({ prompts: addPrompt(stage.prompts, 'Prompt') })}>
            Add prompt
          </Button>
        }
        data-testid="stage-prompts"
      >
        <PromptList
          prompts={stage.prompts}
          onChange={(prompts) => onUpdate({ prompts })}
          contentLabel="Prompt"
          stageKey={stage.key}
          issues={issues}
          pointer="/prompts"
        />
        <FieldIssues issues={issues.filter((i) => i.field === '/prompts')} />
      </InspectorSection>
      <LoopIterationSection {...props} />
    </>
  );
}
