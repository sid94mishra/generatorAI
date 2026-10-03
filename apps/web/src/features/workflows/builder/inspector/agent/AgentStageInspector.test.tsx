// Smoke test of the agent-stage and edge inspectors: every tab renders
// against the builder store, and the main edits reach the store.

import { useState, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import type { AgentStageSpec } from '../types.js';
import { AgentStageInspector } from './AgentStageInspector.js';
import { EdgeInspector } from './EdgeInspector.js';

/** Every platform call resolves empty; providers resolve an empty catalog. */
const platform = new Proxy(
  {},
  {
    get: (_t, key) =>
      key === 'getHarnessProviders'
        ? async () => ({ primary: 'copilot', stale: false, providers: [] })
        : key === 'then'
          ? undefined
          : async () => [],
  },
);

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <PlatformContext.Provider value={platform as never}>
        <MemoryRouter>{node}</MemoryRouter>
      </PlatformContext.Provider>
    </QueryClientProvider>,
  );
}

function Harness({ stageKey }: { stageKey: string }) {
  const stage = useWorkflowBuilderStore((s) => s.nodes.find((n) => n.id === stageKey)?.data.stage) as AgentStageSpec;
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const updateStage = useWorkflowBuilderStore((s) => s.updateStage);
  const [tab, setTab] = useState<string | undefined>(undefined);
  return (
    <AgentStageInspector
      stage={stage}
      issues={issues.filter((i) => i.stageKey === stageKey)}
      onUpdate={(u) => updateStage(stageKey, u)}
      tab={tab}
      onTabChange={setTab}
    />
  );
}

const stageOf = (key: string) => useWorkflowBuilderStore.getState().nodes.find((n) => n.id === key)!.data.stage as AgentStageSpec;

describe('AgentStageInspector', () => {
  let first = '';
  let second = '';
  beforeEach(() => {
    const store = useWorkflowBuilderStore.getState();
    store.resetBuilder();
    first = store.addStage('Scan');
    second = store.addStage('Assess');
    store.updateWorkflow({ variables: [{ name: 'target_branch', type: 'string', label: 'Target branch', required: false }] });
    store.selectNode(second);
  });

  // One test per tab: each renders the inspector once and opens one tab, so a
  // slow (loaded) machine pays for one tab at a time and a failure names it.
  const openTab = (name: RegExp) => {
    wrap(<Harness stageKey={second} />);
    fireEvent.click(screen.getByRole('tab', { name }));
  };

  it('Prompt (default tab): adds a prompt, inserts a variable and a context source', async () => {
    wrap(<Harness stageKey={second} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add prompt' }));
    expect(stageOf(second).prompts).toHaveLength(1);
    expect(await screen.findByLabelText('Prompt 1 text')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Insert variable into prompt 1' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /target_branch/ }));
    await waitFor(() => expect(stageOf(second).prompts[0]!.text).toBe('{{ target_branch }}'));
    expect(screen.getByRole('radiogroup', { name: 'Context mode' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add context source' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Scan/ }));
    await waitFor(() => expect(stageOf(second).context.from).toEqual([first]));
  });

  it('Session: the session spec editor, and the session group reaches the stage', async () => {
    openTab(/^Session/);
    expect(await screen.findByTestId('session-spec-editor-stage')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'stage provider' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'stage agent mode' })).toBeTruthy();
    expect(screen.getByTestId('stage-customize-capabilities')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Session group' }), { target: { value: 'audit' } });
    expect(stageOf(second).sessionGroup).toBe('audit');
  });

  it('Tools: the integrated browser switch', async () => {
    openTab(/^Tools/);
    fireEvent.click(await screen.findByRole('switch', { name: 'Integrated browser' }));
    await waitFor(() => expect(stageOf(second).session?.browser?.enabled).toBe(false));
  });

  it('Output: adds a rule; format and schema fields', async () => {
    openTab(/^Output/);
    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
    expect(stageOf(second).output.rules).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove rule 1' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Output format' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Output JSON Schema' })).toBeTruthy();
  });

  it('Policy: retry on failure, jitter, exhaustion and the guard', async () => {
    openTab(/^Policy/);
    fireEvent.click(await screen.findByRole('switch', { name: 'Retry on failure' }));
    await waitFor(() => expect(stageOf(second).retry?.maxAttempts).toBe(2));
    expect(screen.getByRole('combobox', { name: 'Retry jitter' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'When retries are exhausted' })).toBeTruthy();
    expect(await screen.findByLabelText('Guard expression')).toBeTruthy();
  });

  it('Hooks: adds a hook and counts it on the tab', async () => {
    openTab(/^Hooks/);
    fireEvent.click(await screen.findByRole('button', { name: 'Add hook' }));
    expect(stageOf(second).hooks).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove Hook 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit workflow hooks' })).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: /^Hooks/ })).getByText('1')).toBeTruthy();
  });

  it('shows the loop section for a loop body stage', async () => {
    const store = useWorkflowBuilderStore.getState();
    const loop = store.addStage('Fix loop', { kind: 'loop' });
    const body = useWorkflowBuilderStore.getState().nodes.find((n) => n.data.stage.parentKey === loop)!.id;
    wrap(<Harness stageKey={body} />);
    expect(await screen.findByTestId('loop-iterations')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Continue' }));
    await waitFor(() => expect(stageOf(body).sessionReuse).toBe('continue'));
  });
});

describe('EdgeInspector', () => {
  it('edits and deletes an edge', async () => {
    const store = useWorkflowBuilderStore.getState();
    store.resetBuilder();
    const a = store.addStage('A');
    const b = store.addStage('B');
    store.onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    const edgeId = useWorkflowBuilderStore.getState().edges[0]!.id;
    wrap(<EdgeInspector edgeId={edgeId} />);
    expect(screen.getByRole('combobox', { name: 'Edge condition' })).toBeTruthy();
    expect(await screen.findByLabelText('Edge when expression')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Handles failure' }));
    expect(useWorkflowBuilderStore.getState().edges[0]!.data!.edge.handlesFailure).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete edge' }));
    expect(useWorkflowBuilderStore.getState().edges).toHaveLength(0);
  });
});
