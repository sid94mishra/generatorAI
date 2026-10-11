// ────────────────────────────────────────────────────────────────
// Source-control request-body schemas — merging a pull request and the issue
// writes (create, comment, close). Shared by the project routes and the
// agent's GitHub tools so both accept exactly the same shape and limits
// (GitHub caps a title at 256 characters and a body at 65,536).
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const ISSUE_TITLE_MAX = 256;
export const ISSUE_BODY_MAX = 65_536;

export const PullRequestMergeMethodSchema = z.enum(['merge', 'squash', 'rebase']);

export const MergePullRequestBodySchema = z.object({
  method: PullRequestMergeMethodSchema.default('merge'),
  deleteBranch: z.boolean().optional(),
  commitTitle: z.string().trim().min(1).max(ISSUE_TITLE_MAX).optional(),
  commitMessage: z.string().max(ISSUE_BODY_MAX).optional(),
});

const label = z.string().trim().min(1).max(50);

export const CreateIssueBodySchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(ISSUE_TITLE_MAX),
  body: z.string().max(ISSUE_BODY_MAX).optional(),
  labels: z.array(label).max(20).optional(),
});

export const IssueCommentBodySchema = z.object({
  body: z.string().trim().min(1, 'comment body is required').max(ISSUE_BODY_MAX),
});

export const CloseIssueBodySchema = z.object({
  reason: z.enum(['completed', 'not_planned']).optional(),
  comment: z.string().trim().min(1).max(ISSUE_BODY_MAX).optional(),
});

export type MergePullRequestBody = z.infer<typeof MergePullRequestBodySchema>;
export type CreateIssueBody = z.infer<typeof CreateIssueBodySchema>;
export type IssueCommentBody = z.infer<typeof IssueCommentBodySchema>;
export type CloseIssueBody = z.infer<typeof CloseIssueBodySchema>;
