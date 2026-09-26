// ────────────────────────────────────────────────────────────────
// The prompt list of an agent stage (WorkflowStagePrompt board): one card
// per prompt turn — number, label, ↑ ↓ reorder, ⋯ (duplicate, remove) —
// with an "Insert variable" menu (variables, earlier stage outputs, run
// paths from the stage's scope model), a Preview of the template with its
// placeholders highlighted, "n lines · n refs", the template editor and the
// prompt's issues with their quick fixes. Also the loop's follow-up prompts.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { PromptDefinition } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { cn } from '@/ui/lib/cn.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { builderScopeModel } from '../../expression/builderScope.js';
import { ExpressionField } from '../../fields/ExpressionField.js';
import { FieldIssues, issuesAt } from '../../fields/FieldIssues.js';
import { InspectorNote } from '../../fields/InspectorLayout.js';
import { appendPlaceholder, fallbackGroups, insertableGroups, stageScopeModel, templateStats } from './insertables.js';

/** The menu of what a template of `stageKey` may read; picking one appends `{{ path }}`. */
function InsertVariableMenu({ stageKey, onInsert, label }: { stageKey: string; onInsert: (path: string) => void; label: string }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button variant="ghost" size="sm" icon="variable" trailingIcon="chevron-down" aria-label={label}>
            Insert variable
          </Button>
        }
      />
      <Menu.Popup className="max-h-96 overflow-y-auto">
        <InsertVariableItems stageKey={stageKey} onInsert={onInsert} />
      </Menu.Popup>
    </Menu.Root>
  );
}

/** Mounted only while the menu is open: the scope model is read then. */
function InsertVariableItems({ stageKey, onInsert }: { stageKey: string; onInsert: (path: string) => void }) {
  const graph = useWorkflowBuilderStore.getState().toGraph();
  const model = stageScopeModel(graph, stageKey, builderScopeModel({ kind: 'stage', key: stageKey }));
  const groups = model ? insertableGroups(model) : fallbackGroups(graph, stageKey);
  if (groups.length === 0) {
    return <p className="px-2 py-1.5 text-small text-fg-3">Nothing to insert yet: declare a variable or connect an earlier stage.</p>;
  }
  return (
    <>
      {groups.map((group, i) => (
        <Menu.Group key={group.id}>
          {i > 0 ? <Menu.Separator /> : null}
          <Menu.GroupLabel>{group.label}</Menu.GroupLabel>
          {group.items.map((item) => (
            <Menu.Item key={item.path} icon="variable" trailing={item.type} onClick={() => onInsert(item.path)}>
              <span className="font-mono">{item.path}</span>
            </Menu.Item>
          ))}
        </Menu.Group>
      ))}
    </>
  );
}

/** The template with its `{{ … }}` placeholders drawn as code chips. */
function TemplatePreview({ text }: { text: string }) {
  if (!text) return <p className="px-1 py-2 text-small text-fg-3 italic">Empty prompt</p>;
  const parts = text.split(/(\{\{[^}]*\}\})/g);
  return (
    <p className="rounded-control bg-sunken p-2.5 text-ui whitespace-pre-wrap text-fg">
      {parts.map((part, i) =>
        part.startsWith('{{') && part.endsWith('}}') ? (
          <InlineCode key={i} dense>
            {part.slice(2, -2).trim()}
          </InlineCode>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

export interface PromptListProps {
  prompts: PromptDefinition[];
  onChange: (prompts: PromptDefinition[]) => void;
  /** "Prompt" / "Follow-up": card labels, control names ("Prompt 1 text"). */
  contentLabel: string;
  stageKey: string;
  issues: readonly BuilderIssue[];
  /** JSON pointer of the list (`/prompts`, `/followUpPrompts`). */
  pointer: string;
}

/** Cards of prompt turns; the host renders the "Add prompt" action (see `addPrompt`). */
export function PromptList({ prompts, onChange, contentLabel, stageKey, issues, pointer }: PromptListProps) {
  const [preview, setPreview] = useState<ReadonlySet<number>>(new Set());
  const noun = contentLabel.toLowerCase();
  const update = (index: number, patch: Partial<PromptDefinition>) => onChange(prompts.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const move = (index: number, to: number) => {
    if (to < 0 || to >= prompts.length) return;
    const next = [...prompts];
    [next[index], next[to]] = [next[to]!, next[index]!];
    onChange(next);
    setPreview(new Set());
  };
  const remove = (index: number) => {
    onChange(prompts.filter((_, i) => i !== index));
    setPreview(new Set());
  };
  const duplicate = (index: number) => {
    const source = prompts[index]!;
    onChange([...prompts.slice(0, index + 1), { ...source, label: `${source.label} (copy)` }, ...prompts.slice(index + 1)]);
    setPreview(new Set());
  };
  const togglePreview = (index: number) =>
    setPreview((p) => {
      const next = new Set(p);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  if (prompts.length === 0) {
    return (
      <InspectorNote>
        No {noun}s configured. Add {/^[aeiou]/i.test(contentLabel) ? 'an' : 'a'} {noun} to define what this stage does.
      </InspectorNote>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {prompts.map((prompt, index) => {
        const n = index + 1;
        const promptIssues = issuesAt(issues, `${pointer}/${index}`);
        const hasError = promptIssues.some((i) => i.severity === 'error');
        const stats = templateStats(prompt.text);
        const previewing = preview.has(index);
        return (
          <div
            key={index}
            className={cn('flex flex-col rounded-card border bg-surface', hasError ? 'border-err' : 'border-line-soft')}
            data-testid="prompt-card"
          >
            <div className="flex items-center gap-1.5 border-b border-line-soft px-2 py-1.5">
              <span className="w-4 shrink-0 text-center font-mono text-micro text-fg-3">{n}</span>
              <Input
                size="sm"
                className="min-w-0 flex-1"
                value={prompt.label}
                onChange={(e) => update(index, { label: e.target.value })}
                placeholder={`${contentLabel} label`}
                aria-label={`${contentLabel} ${n} label`}
              />
              <IconButton icon="chevron-up" size="sm" label={`Move ${noun} ${n} up`} disabled={index === 0} onClick={() => move(index, index - 1)} />
              <IconButton
                icon="chevron-down"
                size="sm"
                label={`Move ${noun} ${n} down`}
                disabled={index === prompts.length - 1}
                onClick={() => move(index, index + 1)}
              />
              <MenuButton
                iconOnly
                icon="more"
                size="sm"
                variant="ghost"
                label={`${contentLabel} ${n} actions`}
                items={[
                  { id: 'duplicate', label: 'Duplicate', icon: 'copy', onSelect: () => duplicate(index) },
                  { type: 'separator' },
                  { id: 'remove', label: `Remove ${noun}`, icon: 'trash', danger: true, onSelect: () => remove(index) },
                ]}
              />
            </div>
            <div className="flex items-center gap-1 px-2 pt-1.5">
              <InsertVariableMenu
                stageKey={stageKey}
                label={`Insert variable into ${noun} ${n}`}
                onInsert={(path) => update(index, { text: appendPlaceholder(prompt.text, path) })}
              />
              <Button variant="ghost" size="sm" icon="view" pressed={previewing} onClick={() => togglePreview(index)}>
                Preview
              </Button>
              <span className="ml-auto font-mono text-micro text-fg-3">
                {stats.lines} {stats.lines === 1 ? 'line' : 'lines'} · {stats.refs} {stats.refs === 1 ? 'ref' : 'refs'}
              </span>
            </div>
            <div className="p-2">
              {previewing ? (
                <div className="flex flex-col gap-1">
                  <TemplatePreview text={prompt.text} />
                  <FieldIssues issues={promptIssues} />
                </div>
              ) : (
                <ExpressionField
                  mode="template"
                  value={prompt.text}
                  onChange={(text) => update(index, { text })}
                  rows={5}
                  ariaLabel={`${contentLabel} ${n} text`}
                  placeholder="Enter prompt text... Use {{variableName}} or {{ stages.<key>.output }} (Ctrl+Space completes)"
                  issues={promptIssues}
                />
              )}
            </div>
          </div>
        );
      })}
      <InspectorNote>Type {'{{'} for suggestions. A bare name is a workflow variable.</InspectorNote>
    </div>
  );
}

/** The list with one more, empty prompt ("Prompt 3"). */
export function addPrompt(prompts: PromptDefinition[], contentLabel: string): PromptDefinition[] {
  return [...prompts, { label: `${contentLabel} ${prompts.length + 1}`, text: '' }];
}
