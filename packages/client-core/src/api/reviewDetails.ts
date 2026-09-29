import type { PlanCommentAnchor, PlanComment, PlanRevision } from '@generatorai/shared';
import type { ReviewThread } from './client.js';

type EndpointRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
const enc = encodeURIComponent;
const json = (body: unknown, method = 'POST'): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export type PlanRevisionInfo = Omit<PlanRevision, 'createdAt'> & { createdAt?: string | number };
export type PlanCommentInfo = Omit<PlanComment, 'createdAt'> & { createdAt: string | number };
export interface PlanDocumentInfo {
  id: string;
  chatId: string;
  title: string;
  fileName: string;
  filePath?: string;
  status: string;
  currentRevision: number;
  revisions: PlanRevisionInfo[];
  comments: PlanCommentInfo[];
}
export type ReviewSubmitTarget =
  | { kind: 'chat'; chatId: string }
  | { kind: 'stage_followup'; runId: string; stageId: string }
  | { kind: 'clipboard' };
export interface ReviewSubmitBody {
  threadIds: string[];
  target: ReviewSubmitTarget;
  note?: string;
  preview?: boolean;
}
export interface TaskDigest {
  taskId: string;
  taskName: string;
  status: string;
  summary?: string;
  keyFindings?: string[];
  artifacts?: Array<{ path: string; kind?: string }>;
  risks?: string[];
  openQuestions?: string[];
}

export function createReviewMethods(request: EndpointRequest) {
  const root = (id: string) => `/api/workspaces/${enc(id)}/review/threads`;
  return {
    threadsForScope: (id: string, params: { scope?: string; scopeId?: string; path?: string; all?: boolean }) => {
      const query = new URLSearchParams();
      if (params.scope) query.set('scope', params.scope);
      if (params.scopeId) query.set('scopeId', params.scopeId);
      if (params.path) query.set('path', params.path);
      if (params.all) query.set('all', 'true');
      return request<{ workspaceId: string; threads: ReviewThread[] }>(`${root(id)}${query.size ? `?${query}` : ''}`);
    },
    updateComment: (id: string, threadId: string, commentId: string, body: string) =>
      request<ReviewThread>(`${root(id)}/${enc(threadId)}/comments/${enc(commentId)}`, json({ body }, 'PATCH')),
    deleteThread: (id: string, threadId: string) =>
      request<void>(`${root(id)}/${enc(threadId)}`, { method: 'DELETE' }),
  };
}

export function createPlanMethods(request: EndpointRequest) {
  const root = (chatId: string, planId: string) => `/api/chats/${enc(chatId)}/plans/${enc(planId)}`;
  return {
    get: (chatId: string, planId: string) => request<PlanDocumentInfo>(root(chatId, planId)),
    content: (chatId: string, planId: string, revision?: number) =>
      request<PlanRevisionInfo>(`${root(chatId, planId)}/content${revision !== undefined ? `?revision=${revision}` : ''}`),
    saveRevision: (chatId: string, planId: string, body: { content: string; summary?: string; expectedRevision: number }) =>
      request<PlanRevisionInfo>(`${root(chatId, planId)}/content`, json(body, 'PUT')),
    addComment: (chatId: string, planId: string, body: { body: string; revision: number; anchor?: PlanCommentAnchor }) =>
      request<PlanCommentInfo>(`${root(chatId, planId)}/comments`, json(body)),
    saveToWorkspace: (chatId: string, planId: string) =>
      request<{ ok: boolean; path: string | null }>(`${root(chatId, planId)}/save-to-workspace`, json({})),
  };
}
