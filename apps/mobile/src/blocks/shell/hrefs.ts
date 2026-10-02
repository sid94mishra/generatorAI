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
/** Step detail (MB-14): a tool call of the chat by its call id. */
export const stepHref = (chatId: string, callId: string): string => `${chatHref(chatId)}/steps/${seg(callId)}`;
export const gateHref = (chatId: string, interactionId: string): string => `${chatHref(chatId)}/gate/${seg(interactionId)}`;
/** Legacy plan sheet until M6 replaces it with `/chats/<id>?dock=plan` (04 §1.5). */
export const planHref = (chatId: string, planId: string): string => `${chatHref(chatId)}/plan/${seg(planId)}`;
export const workflowHref = (workflowId: string): string => `/workflows/${seg(workflowId)}`;
/** A run lives under its workflow (MD-80): there is no `/runs/<id>`. */
export const runHref = (workflowId: string, runId: string): string => `${workflowHref(workflowId)}/runs/${seg(runId)}`;
export const stageHref = (workflowId: string, runId: string, stageRunId: string): string =>
  `${runHref(workflowId, runId)}/stages/${seg(stageRunId)}`;
export const automationHref = (id: string): string => `/automations/${seg(id)}`;
export const scriptHref = (id: string): string => `/scripts/${seg(id)}`;
export const projectHref = (id: string): string => `/projects/${seg(id)}`;
export const codebaseHref = (projectId: string, codebaseId: string): string => `${projectHref(projectId)}/codebases/${seg(codebaseId)}`;
export const settingsHref = (section?: string): string => (section ? `/settings/${seg(section)}` : SETTINGS_HREF);
/** Workspace screens (diff, file) are M6; the legacy Changes and Terminal routes stay until then. */
export const changesHref = (workspaceId: string): string => `/changes/${seg(workspaceId)}`;
export const terminalHref = (workspaceId: string): string => `/terminal/${seg(workspaceId)}`;
