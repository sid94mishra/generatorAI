// ────────────────────────────────────────────────────────────────
// Review Routes — inline comments on diffs
// ────────────────────────────────────────────────────────────────
//
// Mounted under /api/workspaces/:id/review so a thread is always scoped to
// the workspace whose files it annotates.
//
// Submission is a SERVER concern, not a composer concern: the same batch
// must produce a byte-identical prompt whether it came from the web UI, the
// CLI or the SDK, and only the server can atomically mark the batch
// submitted after delivery succeeds.

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import type {
  ReviewIntent,
  ReviewScope,
  ReviewSide,
  ReviewThreadStatus,
} from '@generatorai/review';

const VALID_INTENTS: ReviewIntent[] = ['fix', 'question', 'note', 'refactor', 'test'];
const VALID_STATUSES: ReviewThreadStatus[] = [
  'draft',
  'pending',
  'submitted',
  'addressed',
  'resolved',
  'outdated',
];

export function createReviewRoutes(container: Container): Router {
  // `mergeParams` so `:id` (the workspace) is visible on this sub-router.
  // The generic is required: without it Express types the merged params as
  // `{}` and every `req.params['id']` read is an implicit-any error.
  const router = Router({ mergeParams: true }) as Router;
  const {
    reviewThreadService,
    chatManagementService,
    stageExecutionService,
    checkpointService,
    logger,
  } = container;

  /** Workspace id from the parent route. */
  const workspaceIdOf = (req: { params: unknown }): string => {
    const params = req.params as Record<string, string | undefined>;
    return String(params['id'] ?? '');
  };

  // GET /workspaces/:id/review/threads
  router.get('/threads', async (req, res, next) => {
    try {
      const workspaceId = workspaceIdOf(req);
      const statusParam = req.query['status'];
      const statuses =
        typeof statusParam === 'string'
          ? statusParam
              .split(',')
              .map((s) => s.trim())
              .filter((s): s is ReviewThreadStatus =>
                VALID_STATUSES.includes(s as ReviewThreadStatus),
              )
          : undefined;

      const threads = await reviewThreadService.listThreads({
        workspaceId,
        ...(typeof req.query['scope'] === 'string'
          ? { scope: req.query['scope'] as ReviewScope }
          : {}),
        ...(typeof req.query['scopeId'] === 'string'
          ? { scopeId: String(req.query['scopeId']) }
          : {}),
        ...(typeof req.query['path'] === 'string' ? { path: String(req.query['path']) } : {}),
        ...(typeof req.query['alias'] === 'string'
          ? { repoAlias: String(req.query['alias']) }
          : {}),
        ...(statuses?.length ? { statuses } : {}),
        openOnly: String(req.query['all'] ?? '') !== 'true',
      });
      res.json({ workspaceId, threads });
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/review/threads
  router.post('/threads', async (req, res, next) => {
    try {
      const workspaceId = workspaceIdOf(req);
      const body = req.body ?? {};

      const path = typeof body.path === 'string' ? body.path.trim() : '';
      const text = typeof body.body === 'string' ? body.body.trim() : '';
      const anchorText = typeof body.anchorText === 'string' ? body.anchorText : '';
      const scopeId = typeof body.scopeId === 'string' ? body.scopeId : '';
      const startLine = Number(body.startLine);
      const endLine = Number(body.endLine);

      if (!path || !text || !scopeId) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'path, body and scopeId are required',
          },
        });
        return;
      }
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'startLine and endLine must be positive integers',
          },
        });
        return;
      }

      const thread = await reviewThreadService.createThread({
        workspaceId,
        scope: (body.scope as ReviewScope) ?? 'chat',
        scopeId,
        repoAlias: typeof body.alias === 'string' ? body.alias : '.',
        path,
        baseCheckpointId: String(body.baseCheckpointId ?? ''),
        headCheckpointId: String(body.headCheckpointId ?? ''),
        side: (body.side as ReviewSide) ?? 'additions',
        startLine,
        endLine: Math.max(startLine, endLine),
        anchorText,
        body: text,
        ...(VALID_INTENTS.includes(body.intent) ? { intent: body.intent as ReviewIntent } : {}),
      });

      res.status(201).json(thread);
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/review/threads/:threadId/comments
  router.post('/threads/:threadId/comments', async (req, res, next) => {
    try {
      const threadId = String(req.params['threadId']);
      const text = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      if (!text) {
        res
          .status(400)
          .json({ error: { code: 'VALIDATION_ERROR', message: 'body is required' } });
        return;
      }
      const comment = await reviewThreadService.addComment(
        threadId,
        text,
        VALID_INTENTS.includes(req.body?.intent) ? req.body.intent : undefined,
      );
      res.status(201).json(comment);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /workspaces/:id/review/threads/:threadId
  router.patch('/threads/:threadId', async (req, res, next) => {
    try {
      const threadId = String(req.params['threadId']);
      const status = req.body?.status;
      if (!VALID_STATUSES.includes(status)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `status must be one of: ${VALID_STATUSES.join(', ')}`,
          },
        });
        return;
      }
      await reviewThreadService.setStatus(threadId, status);
      const thread = await reviewThreadService.getThread(threadId);
      res.json(thread);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /workspaces/:id/review/threads/:threadId
  router.delete('/threads/:threadId', async (req, res, next) => {
    try {
      await reviewThreadService.deleteThread(String(req.params['threadId']));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // PATCH /workspaces/:id/review/threads/:threadId/comments/:commentId
  //
  // Edits the wording of a comment the user already wrote. Agent replies are
  // rejected: they are a record of what was actually said, and letting the UI
  // rewrite them would make the thread transcript lie.
  router.patch('/threads/:threadId/comments/:commentId', async (req, res, next) => {
    try {
      const threadId = String(req.params['threadId']);
      const commentId = String(req.params['commentId']);
      const text = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      if (!text) {
        res
          .status(400)
          .json({ error: { code: 'VALIDATION_ERROR', message: 'body is required' } });
        return;
      }
      const thread = await reviewThreadService.getThread(threadId);
      const comment = thread?.comments.find((c) => c.id === commentId);
      if (!thread || !comment) {
        res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'comment not found' } });
        return;
      }
      if (comment.author !== 'user') {
        res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'only your own comments can be edited' },
        });
        return;
      }
      await reviewThreadService.updateComment(commentId, text);
      res.json(await reviewThreadService.getThread(threadId));
    } catch (err) {
      next(err);
    }
  });

  // POST /workspaces/:id/review/submit
  //
  // Serialises the selected threads into one structured instruction and
  // delivers it to the agent. `preview: true` returns the prompt without
  // sending or mutating anything, so the UI can show exactly what will go out.
  router.post('/submit', async (req, res, next) => {
    try {
      const workspaceId = workspaceIdOf(req);
      const body = req.body ?? {};
      const threadIds: string[] = Array.isArray(body.threadIds)
        ? body.threadIds.filter((t: unknown): t is string => typeof t === 'string')
        : [];

      if (threadIds.length === 0) {
        res
          .status(400)
          .json({ error: { code: 'VALIDATION_ERROR', message: 'threadIds is required' } });
        return;
      }

      const submission = await reviewThreadService.buildSubmission({
        workspaceId,
        threadIds,
        target: body.target ?? { kind: 'clipboard' },
        ...(typeof body.note === 'string' ? { note: body.note } : {}),
      });

      if (submission.prompt === '') {
        res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'No matching review threads' } });
        return;
      }

      if (body.preview === true) {
        res.json({ ...submission, delivered: false });
        return;
      }

      const target = body.target ?? { kind: 'clipboard' };
      let delivered = false;

      if (target.kind === 'chat' && typeof target.chatId === 'string') {
        await chatManagementService.sendPrompt(target.chatId, submission.prompt);
        delivered = true;
      } else if (
        target.kind === 'stage_followup' &&
        typeof target.runId === 'string' &&
        typeof target.stageId === 'string'
      ) {
        await stageExecutionService.sendStageFollowUp(
          target.stageId,
          target.runId,
          submission.prompt,
        );
        delivered = true;
      }

      // Only mark submitted once delivery actually succeeded — otherwise a
      // failed send would silently consume the user's pending batch.
      if (delivered) {
        // Re-anchor the batch to the checkpoint that exists RIGHT NOW.
        // `sendPrompt` captures a turn checkpoint before the agent runs, so
        // by this point the latest checkpoint is exactly "the workspace as
        // the reviewer saw it". Everything the agent does next is measured
        // against it, which is what makes the `addressed` signal meaningful
        // instead of firing on the whole session's history.
        // Each mount has its own checkpoint history. Managed workspaces use
        // aliases such as "main", and multi-repository batches cannot share
        // the root mount's checkpoint.
        const byAlias = new Map<string, string[]>();
        for (const id of submission.threadIds) {
          const thread = await reviewThreadService.getThread(id);
          if (!thread || thread.workspaceId !== workspaceId) continue;
          const ids = byAlias.get(thread.repoAlias) ?? [];
          ids.push(id);
          byAlias.set(thread.repoAlias, ids);
        }
        for (const [alias, ids] of byAlias) {
          const latest = await checkpointService.getLatest(workspaceId, alias);
          await reviewThreadService.markSubmitted(
            ids, submission.reviewRound, undefined, latest?.id,
          );
        }
        logger.info(
          `[ReviewRoutes] Submitted ${submission.threadIds.length} review thread(s) for workspace ${workspaceId}`,
          { requestId: req.requestId },
        );
      }

      res.json({ ...submission, delivered });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
