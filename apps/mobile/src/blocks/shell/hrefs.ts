// Route builders for the (app) tree (04 §1.2; MD-79, MD-80). Paths mirror web paths, so an AttentionItem.href,
// a push `href` and a SearchResult.href land on the same screen without a mapping table. Pure, unit-tested.

const seg = (value: string): string => encodeURIComponent(value);

export const HOME_HREF = '/';
export const CHATS_HREF = '/chats';
export const NEW_CHAT_HREF = '/chats/new';
export const NEEDS_YOU_HREF = '/needs-you';
export const SEARCH_HREF = '/search';
export const SERVERS_HREF = '/servers';
export const SCOPE_REQUEST_HREF = '/scope-request';
export const SETTINGS_HREF = '/settings';
export const WORKFLOWS_HREF = '/workflows';
export const PROJECTS_HREF = '/projects';
export const PAIR_HREF = '/pair';

export const chatHref = (chatId: string): string => `/chats/${seg(chatId)}`;
/** The Turn sheet (MB-02). */
export const turnHref = (chatId: string): string => `${chatHref(chatId)}/turn`;
/** Step detail (MB-14): a tool call of the chat by its call id. */
export const stepHref = (chatId: string, callId: string): string => `${chatHref(chatId)}/steps/${seg(callId)}`;
export const gateHref = (chatId: string, interactionId: string): string => `${chatHref(chatId)}/gate/${seg(interactionId)}`;
/** A plan opens in the chat's pane, on the Plan tab (04 §1.5; M6-11). */
export const planHref = (chatId: string, planId: string): string => `${chatHref(chatId)}?dock=plan&plan=${seg(planId)}`;
export const workflowHref = (workflowId: string): string => `/workflows/${seg(workflowId)}`;
/** A run lives under its workflow (MD-80): there is no `/runs/<id>`. */
export const runHref = (workflowId: string, runId: string): string => `${workflowHref(workflowId)}/runs/${seg(runId)}`;
export const stageHref = (workflowId: string, runId: string, stageRunId: string): string =>
  `${runHref(workflowId, runId)}/stages/${seg(stageRunId)}`;
export const NEW_WORKFLOW_HREF = '/workflows/new';
/** The run sheet (MWorkflowLaunch), a route sheet over the workflow (R-5). */
export const runSheetHref = (workflowId: string): string => `${workflowHref(workflowId)}/run`;
export const workflowRunsHref = (workflowId: string): string => `${workflowHref(workflowId)}/runs`;
/** The definition graph, read-only (MWorkflowDetail "Tap for full screen"). */
export const workflowGraphHref = (workflowId: string): string => `${workflowHref(workflowId)}/graph`;
export const runGraphHref = (workflowId: string, runId: string): string => `${runHref(workflowId, runId)}/graph`;
/** The stage approval sheet (MB-50, MRunApproval). */
export const approvalHref = (workflowId: string, runId: string, stageRunId: string): string => `${runHref(workflowId, runId)}/approval/${seg(stageRunId)}`;
/** The builder (MBuilderList), a full-screen modal group. */
export const builderHref = (workflowId: string): string => `${workflowHref(workflowId)}/edit`;
export const stageEditorHref = (workflowId: string, stageKey: string, tab?: string): string => `${builderHref(workflowId)}/stages/${seg(stageKey)}${tab ? `?tab=${seg(tab)}` : ''}`;
export const workflowVersionsHref = (workflowId: string): string => `${workflowHref(workflowId)}/versions`;
export const automationHref = (id: string): string => `/automations/${seg(id)}`;
export const scriptHref = (id: string): string => `/scripts/${seg(id)}`;
export const projectHref = (id: string): string => `/projects/${seg(id)}`;
export const codebaseHref = (projectId: string, codebaseId: string): string => `${projectHref(projectId)}/codebases/${seg(codebaseId)}`;
export const NEW_PROJECT_HREF = '/projects/new';
/** Project tabs are path segments (R-3); `codebases` is the project screen itself. */
export const projectTabHref = (id: string, tab: string, query?: string): string => (tab === 'codebases' ? projectHref(id) : `${projectHref(id)}/${seg(tab)}${query ? `?${query}` : ''}`);
export const addCodebaseHref = (projectId: string): string => `${projectHref(projectId)}/add-codebase`;
export const codebaseFilesHref = (projectId: string, codebaseId: string): string => `${codebaseHref(projectId, codebaseId)}/files`;
export const codebaseLogsHref = (projectId: string, codebaseId: string): string => `${codebaseHref(projectId, codebaseId)}/logs`;
export const codebaseFileHref = (projectId: string, codebaseId: string, path: string): string => `${codebaseHref(projectId, codebaseId)}/file?path=${encodeURIComponent(path)}`;
export const pullRequestHref = (projectId: string, codebaseId: string, number: number): string => `${codebaseHref(projectId, codebaseId)}/pull-requests/${number}`;
export const skillHref = (projectId: string, configId: string): string => `${projectHref(projectId)}/skills/${seg(configId)}`;
export const skillEditHref = (projectId: string, configId: string): string => `${skillHref(projectId, configId)}/edit`;
export const AGENTS_HREF = '/agents';
export const agentHref = (id: string): string => `/agents/${seg(id)}`;
export const AUTOMATIONS_HREF = '/automations';
export const SCRIPTS_HREF = '/scripts';
export const settingsHref = (section?: string): string => (section ? `/settings/${seg(section)}` : SETTINGS_HREF);
/** The scope request sheet (MScopeRequest, MD-30) pre-filled with the scopes a control needs. */
export const scopeRequestHref = (scopes: ReadonlyArray<string>, reason?: string): string =>
  `${SCOPE_REQUEST_HREF}?scopes=${scopes.map(seg).join(',')}${reason ? `&reason=${seg(reason)}` : ''}`;
const query = (params: Record<string, string | null | undefined>): string => {
  const q = Object.entries(params)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return q ? `?${q}` : '';
};
/** Workspace screens pushed from the pane (04 §1.2, MPaneDiff / MPaneFilePreview) and the commit sheet (MPaneCommit). */
export const workspaceDiffHref = (workspaceId: string, p: { path: string; alias?: string; base?: string; chat?: string | null }): string =>
  `/workspaces/${seg(workspaceId)}/diff${query({ path: p.path, alias: p.alias, base: p.base, chat: p.chat })}`;
export const workspaceFileHref = (workspaceId: string, p: { path: string; alias?: string; chat?: string | null }): string =>
  `/workspaces/${seg(workspaceId)}/file${query({ path: p.path, alias: p.alias, chat: p.chat })}`;
export const workspaceCommitHref = (workspaceId: string, p: { alias?: string; chat?: string | null } = {}): string =>
  `/workspaces/${seg(workspaceId)}/commit${query({ alias: p.alias, chat: p.chat })}`;
