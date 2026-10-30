// ────────────────────────────────────────────────────────────────
// Tools tab (WorkflowStageTools board): the skills and MCP servers the
// stage session adds (the bound agent's own marked "From agent") and the
// platform toggles — browser, computer use, widgets.
// ────────────────────────────────────────────────────────────────

import { FieldIssues } from '../../../fields/FieldIssues.js';
import { isToolField } from '../agentTabs.js';
import { useStageSessionEditor } from './SessionTab.js';
import type { AgentTabProps } from './tabProps.js';

export function ToolsTab(props: AgentTabProps) {
  const editor = useStageSessionEditor(props);
  return (
    <>
      {editor(['skills', 'mcp', 'platform'])}
      <FieldIssues issues={props.issues.filter((i) => isToolField(i.field))} />
    </>
  );
}
