// ────────────────────────────────────────────────────────────────
// Review, plan and background-task endpoints client-core does not wrap.
//
// client-core has `review.threads/createThread/addComment/setThreadStatus/
// submit` and `chats.plans/planContent/decidePlan/backgroundTasks`. Web
// also edits comments, deletes threads, reads a plan's revisions and
// comments, saves a plan revision, posts plan comments, saves to the
// workspace, reads a worker digest and cancels a worker. Those live here on
// the same authenticated fetch — see the server routes cited per call.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import type { ReviewComment, ReviewThread } from '@generatorai/client-core';

import { useAuth } from '../../auth/AuthProvider';
import { json, requestJson, type AuthedFetch } from '../changes/api';
import type { ReviewSubmitBody } from './reviewBatch';

export interface PlanRevisionInfo {
  revision: number;
  content: string;
  summary: string;
  authoredBy: 'agent' | 'user';
  createdAt: string | number;
}

export interface PlanCommentInfo {
  id: string;
  planId: string;
  revision: number;
  anchor?: { startLine: number; endLine: number; quotedText: string; contentHash: string };
  body: string;
  resolved: boolean;
  createdAt: string | number;
}

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

export interface ReviewExtras {
  /** `GET /api/workspaces/:id/review/threads?scope=&scopeId=&all=true` (routes/review.ts:52). */
  threads: (
    workspaceId: string,
    params: { scope?: string; scopeId?: string; path?: string; all?: boolean },
  ) => Promise<{ workspaceId: string; threads: ReviewThread[] }>;
  /** `PATCH /api/workspaces/:id/review/threads/:threadId/comments/:commentId` (routes/review.ts:200). */
  updateComment: (workspaceId: string, threadId: string, commentId: string, body: string) => Promise<ReviewComment>;
  /** `DELETE /api/workspaces/:id/review/threads/:threadId` (routes/review.ts:186). */
  deleteThread: (workspaceId: string, threadId: string) => Promise<void>;
  /** `POST /api/workspaces/:id/review/submit` (routes/review.ts:237). */
  submit: (
    workspaceId: string,
    body: ReviewSubmitBody,
  ) => Promise<{ prompt: string; threadIds: string[]; reviewRound: number; delivered: boolean }>;
}

export interface PlanExtras {
  /** `GET /api/chats/:id/plans/:planId` — revisions + comments (routes/chats.ts:650). */
  get: (chatId: string, planId: string) => Promise<PlanDocumentInfo>;
  /** `GET /api/chats/:id/plans/:planId/content?revision=` (routes/chats.ts:674). */
  content: (chatId: string, planId: string, revision?: number) => Promise<PlanRevisionInfo>;
  /** `PUT /api/chats/:id/plans/:planId/content` → new revision (routes/chats.ts:709). */
  saveRevision: (
    chatId: string,
    planId: string,
    body: { content: string; summary?: string; expectedRevision: number },
  ) => Promise<PlanRevisionInfo>;
  /** `POST /api/chats/:id/plans/:planId/comments` (routes/chats.ts:754). */
  addComment: (
    chatId: string,
    planId: string,
    body: { body: string; revision: number; anchor?: PlanCommentInfo['anchor'] },
  ) => Promise<PlanCommentInfo>;
  /** `POST /api/chats/:id/plans/:planId/save-to-workspace` (routes/chats.ts:844). */
  saveToWorkspace: (chatId: string, planId: string) => Promise<{ ok: boolean; path: string | null }>;
}

export interface TaskExtras {
  /** `GET /api/chats/:id/background-tasks/:taskId` (routes/chats.ts:609). */
  digest: (chatId: string, taskId: string) => Promise<TaskDigest>;
  /** `POST /api/chats/:id/background-tasks/:taskId/cancel` (routes/chats.ts:620). */
  cancel: (chatId: string, taskId: string) => Promise<void>;
}

export function createReviewExtras(fetchImpl: AuthedFetch): ReviewExtras {
  return {
    threads: (id, params) => {
      const q = new URLSearchParams();
      if (params.scope) q.set('scope', params.scope);
      if (params.scopeId) q.set('scopeId', params.scopeId);
      if (params.path) q.set('path', params.path);
      if (params.all) q.set('all', 'true');
      const suffix = q.toString() ? `?${q}` : '';
      return requestJson(fetchImpl, `/api/workspaces/${id}/review/threads${suffix}`);
    },
    updateComment: (id, threadId, commentId, body) =>
      requestJson(fetchImpl, `/api/workspaces/${id}/review/threads/${threadId}/comments/${commentId}`, json({ body }, 'PATCH')),
    deleteThread: (id, threadId) =>
      requestJson(fetchImpl, `/api/workspaces/${id}/review/threads/${threadId}`, { method: 'DELETE' }),
    submit: (id, body) => requestJson(fetchImpl, `/api/workspaces/${id}/review/submit`, json(body)),
  };
}

export function createPlanExtras(fetchImpl: AuthedFetch): PlanExtras {
  return {
    get: (chatId, planId) => requestJson(fetchImpl, `/api/chats/${chatId}/plans/${planId}`),
    content: (chatId, planId, revision) =>
      requestJson(
        fetchImpl,
        `/api/chats/${chatId}/plans/${planId}/content${revision !== undefined ? `?revision=${revision}` : ''}`,
      ),
    saveRevision: (chatId, planId, body) =>
      requestJson(fetchImpl, `/api/chats/${chatId}/plans/${planId}/content`, json(body, 'PUT')),
    addComment: (chatId, planId, body) =>
      requestJson(fetchImpl, `/api/chats/${chatId}/plans/${planId}/comments`, json(body)),
    saveToWorkspace: (chatId, planId) =>
      requestJson(fetchImpl, `/api/chats/${chatId}/plans/${planId}/save-to-workspace`, json({})),
  };
}

export function createTaskExtras(fetchImpl: AuthedFetch): TaskExtras {
  return {
    digest: (chatId, taskId) => requestJson(fetchImpl, `/api/chats/${chatId}/background-tasks/${taskId}`),
    cancel: (chatId, taskId) =>
      requestJson(fetchImpl, `/api/chats/${chatId}/background-tasks/${taskId}/cancel`, json({})),
  };
}

export function useReviewExtras(): ReviewExtras {
  const { fetch } = useAuth();
  return useMemo(() => createReviewExtras(fetch), [fetch]);
}

export function usePlanExtras(): PlanExtras {
  const { fetch } = useAuth();
  return useMemo(() => createPlanExtras(fetch), [fetch]);
}

export function useTaskExtras(): TaskExtras {
  const { fetch } = useAuth();
  return useMemo(() => createTaskExtras(fetch), [fetch]);
}
