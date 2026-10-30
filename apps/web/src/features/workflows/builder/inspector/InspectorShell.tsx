// ────────────────────────────────────────────────────────────────
// The chrome every builder inspector shares (L-04 inspector boards):
//
//   eyebrow   "‹ Workflow settings" — back to the workflow's own settings
//             (deselects the stage or edge)
//   title     the stage name (edge: "From → To")
//   subtitle  "`key` · Agent stage · 2 of 6" (a stage inside a container:
//             "· in fix_review")
//   actions   close (hides the inspector; the header's toggle brings it back)
//   tabs      the kind's tabs, a count per tab, a dot on a tab with errors
//
// `BuilderInspectorContext` carries the page's handlers into the panels:
// `close` (hide the inspector) and `openSettings(tab)` (a Hooks tab's
// "Workflow hooks ›" link opens the workflow settings on that tab).
// ────────────────────────────────────────────────────────────────

import { createContext, useContext, type ReactNode } from 'react';
import type { StageSpec } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import type { TabItem } from '@/ui/primitives/Tabs/Tabs.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Inspector } from '@/ui/patterns/Inspector/Inspector.js';
import { KIND_META } from '../model/kindMeta.js';

/** Workflow settings tabs (WorkflowSettingsPanel board). */
export type SettingsTab = 'general' | 'project' | 'variables' | 'hooks' | 'tags' | 'budget';

export interface BuilderInspectorApi {
  /** Hide the inspector. */
  close: () => void;
  /** Show the workflow's settings (deselecting any stage or edge), on `tab`. */
  openSettings: (tab?: SettingsTab) => void;
}

export const BuilderInspectorContext = createContext<BuilderInspectorApi>({
  close: () => undefined,
  openSettings: () => undefined,
});

export function useBuilderInspector(): BuilderInspectorApi {
  return useContext(BuilderInspectorContext);
}

/** A tab's count, with the error dot of a tab whose fields have errors (WorkflowValidate board). */
export function tabCount(count: number | undefined, hasError = false): ReactNode {
  if (!count && !hasError) return undefined;
  return (
    <span className="inline-flex items-center gap-1">
      {count ? count : null}
      {hasError ? <span aria-label="has errors" role="img" className="inline-block size-1.5 rounded-full bg-err" /> : null}
    </span>
  );
}

/** "‹ Workflow settings" + the close button: the header parts of every stage/edge inspector. */
export function useInspectorChrome(): { eyebrow: ReactNode; actions: ReactNode } {
  const { close, openSettings } = useBuilderInspector();
  return {
    eyebrow: (
      <Button variant="ghost" size="sm" icon="chevron-left" className="-ml-2" onClick={() => openSettings()}>
        Workflow settings
      </Button>
    ),
    actions: <IconButton icon="x" size="sm" label="Close inspector" onClick={close} />,
  };
}

/** "`key` · Agent stage · 2 of 6" (+ "· in <container>" for a body stage). */
export function useStageSubtitle(stage: StageSpec): string {
  const position = useWorkflowBuilderStore((s) => {
    const i = s.nodes.findIndex((n) => n.id === stage.key);
    return i >= 0 ? `${i + 1} of ${s.nodes.length}` : '';
  });
  return [stage.key, KIND_META[stage.kind].noun, position, stage.parentKey ? `in ${stage.parentKey}` : '']
    .filter(Boolean)
    .join(' · ');
}

export interface StageInspectorShellProps {
  stage: StageSpec;
  tabs: readonly TabItem[];
  tab: string;
  onTabChange: (tab: string) => void;
  footer?: ReactNode;
  children?: ReactNode;
}

/** The Inspector of a stage of any kind: shared chrome, the kind's tabs, the active tab's body. */
export function StageInspectorShell({ stage, tabs, tab, onTabChange, footer, children }: StageInspectorShellProps) {
  const chrome = useInspectorChrome();
  const subtitle = useStageSubtitle(stage);
  return (
    <Inspector
      title={stage.name || 'Untitled stage'}
      label="Stage inspector"
      eyebrow={chrome.eyebrow}
      subtitle={subtitle}
      actions={chrome.actions}
      tabs={{ items: tabs, value: tab, onValueChange: onTabChange }}
      footer={footer}
    >
      {children}
    </Inspector>
  );
}
