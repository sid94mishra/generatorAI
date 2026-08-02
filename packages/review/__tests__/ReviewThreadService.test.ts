import { describe, it, expect, beforeEach } from 'vitest';
import { ReviewThreadService, type ReviewContentReader } from '../src/ReviewThreadService.js';
import type { IReviewRepository } from '../src/ports/IReviewRepository.js';
import type { ReviewThread, ReviewComment, ReviewThreadStatus } from '../src/types.js';

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as ConstructorParameters<typeof ReviewThreadService>[2];

/**
 * In-memory repository. Only the behaviour the service actually depends on is
 * modelled; anything else throws so an accidental dependency shows up loudly.
 */
class FakeRepo implements IReviewRepository {
  threads = new Map<string, ReviewThread>();
  comments = new Map<string, ReviewComment[]>();

  async createThread(thread: ReviewThread): Promise<void> {
    this.threads.set(thread.id, { ...thread });
  }

  async findThreadById(id: string): Promise<ReviewThread | null> {
    return this.threads.get(id) ?? null;
  }

  async listThreads(): Promise<ReviewThread[]> {
    return [...this.threads.values()];
  }

  async findThreadsForFile(
    _workspaceId: string,
    repoAlias: string,
    path: string,
  ): Promise<ReviewThread[]> {
    return [...this.threads.values()].filter(
      (t) => t.repoAlias === repoAlias && t.path === path,
    );
  }

  async updateThread(id: string, patch: Partial<ReviewThread>): Promise<void> {
    const existing = this.threads.get(id);
    if (!existing) return;
    this.threads.set(id, { ...existing, ...patch });
  }

  async deleteThread(id: string): Promise<void> {
    this.threads.delete(id);
    this.comments.delete(id);
  }

  async deleteByWorkspace(): Promise<void> {
    this.threads.clear();
    this.comments.clear();
  }

  async addComment(comment: ReviewComment): Promise<void> {
    const list = this.comments.get(comment.threadId) ?? [];
    list.push({ ...comment });
    this.comments.set(comment.threadId, list);
  }

  async updateComment(): Promise<void> {}

  async deleteComment(): Promise<void> {}

  async markSubmitted(
    threadIds: string[],
    messageId: string | undefined,
    round: number,
    headCheckpointId?: string,
  ): Promise<void> {
    for (const id of threadIds) {
      const existing = this.threads.get(id);
      if (!existing) continue;
      this.threads.set(id, {
        ...existing,
        status: 'submitted',
        submittedMessageId: messageId,
        reviewRound: round,
        ...(headCheckpointId ? { headCheckpointId } : {}),
      });
    }
  }

  async countByStatus(): Promise<Record<ReviewThreadStatus, number>> {
    const counts = {
      draft: 0,
      pending: 0,
      submitted: 0,
      addressed: 0,
      resolved: 0,
      outdated: 0,
    } as Record<ReviewThreadStatus, number>;
    for (const t of this.threads.values()) counts[t.status] += 1;
    return counts;
  }
}

const FILE_BEFORE = ['def greet(name):', '    return f"Hello, {name}!"', ''].join('\n');

class FakeContent implements ReviewContentReader {
  body = FILE_BEFORE;
  /** Patch keyed by the checkpoint the caller diffs *from*. */
  patches = new Map<string, string>();

  async readCurrent(): Promise<string | null> {
    return this.body;
  }

  async readPatchSince(
    _workspaceId: string,
    _alias: string,
    _path: string,
    sinceCheckpointId: string,
  ): Promise<string | null> {
    return this.patches.get(sinceCheckpointId) ?? null;
  }
}

describe('ReviewThreadService', () => {
  let repo: FakeRepo;
  let content: FakeContent;
  let service: ReviewThreadService;

  beforeEach(() => {
    repo = new FakeRepo();
    content = new FakeContent();
    service = new ReviewThreadService(repo, content, silentLogger);
  });

  const createThread = async (headCheckpointId = '') =>
    service.createThread({
      workspaceId: 'ws1',
      scope: 'chat',
      scopeId: 'chat1',
      repoAlias: '.',
      path: 'hello.py',
      side: 'additions',
      startLine: 1,
      endLine: 2,
      anchorText: 'def greet(name):\n    return f"Hello, {name}!"',
      body: 'Add a type hint.',
      intent: 'fix',
      baseCheckpointId: 'ckpt_base',
      headCheckpointId,
    });

  it('starts a new thread as pending', async () => {
    const thread = await createThread();
    expect(thread.status).toBe('pending');
    expect(thread.reviewRound).toBe(0);
  });

  /**
   * Regression: `headCheckpointId` used to be empty whenever the thread was
   * anchored against the working tree (which has no checkpoint id). The
   * re-anchor pass then diffed from the *baseline*, so the very first
   * checkpoint after submission overlapped the anchor and every thread
   * flipped to `addressed` before the agent had written a single line.
   */
  it('re-anchors submitted threads to the submission-time checkpoint', async () => {
    const thread = await createThread(''); // anchored against the working tree

    await service.markSubmitted([thread.id], 1, undefined, 'ckpt_at_submit');

    const stored = await repo.findThreadById(thread.id);
    expect(stored?.status).toBe('submitted');
    expect(stored?.headCheckpointId).toBe('ckpt_at_submit');
  });

  it('does not mark a thread addressed when nothing changed after submission', async () => {
    const thread = await createThread('');
    await service.markSubmitted([thread.id], 1, undefined, 'ckpt_at_submit');

    // A patch exists for the baseline (the whole session) but NOT for the
    // submission-time checkpoint — i.e. the agent has not touched the file.
    content.patches.set('ckpt_base', '@@ -1,2 +1,2 @@\n-old\n+new\n');

    const result = await service.reanchorFiles(
      'ws1',
      [{ repoAlias: '.', path: 'hello.py' }],
      'ckpt_after',
    );

    expect(result.addressed).toBe(0);
    const stored = await repo.findThreadById(thread.id);
    expect(stored?.status).toBe('submitted');
  });

  it('marks a thread addressed when the agent edits the anchored range', async () => {
    const thread = await createThread('');
    await service.markSubmitted([thread.id], 1, undefined, 'ckpt_at_submit');

    content.patches.set(
      'ckpt_at_submit',
      '@@ -1,2 +1,2 @@\n-def greet(name):\n+def greet(name: str) -> str:\n     return f"Hello, {name}!"\n',
    );
    content.body = ['def greet(name: str) -> str:', '    return f"Hello, {name}!"', ''].join(
      '\n',
    );

    const result = await service.reanchorFiles(
      'ws1',
      [{ repoAlias: '.', path: 'hello.py' }],
      'ckpt_after',
    );

    expect(result.addressed).toBe(1);
    const stored = await repo.findThreadById(thread.id);
    expect(stored?.status).toBe('addressed');
    expect(stored?.resolvedByCheckpointId).toBe('ckpt_after');
  });

  /**
   * Regression: a comment on a function SIGNATURE is normally addressed by
   * editing the function BODY. Requiring the anchored line itself to change
   * left such threads stuck on "awaiting agent" forever.
   */
  it('marks a thread addressed when the agent edits elsewhere in the same file', async () => {
    const thread = await createThread('');
    await service.markSubmitted([thread.id], 1, undefined, 'ckpt_at_submit');

    // Anchor (lines 1-2) is untouched; the agent added a guard below it.
    content.patches.set(
      'ckpt_at_submit',
      '@@ -2,2 +2,4 @@\n     return f"Hello, {name}!"\n+    if not name:\n+        raise ValueError("name required")\n',
    );

    const result = await service.reanchorFiles(
      'ws1',
      [{ repoAlias: '.', path: 'hello.py' }],
      'ckpt_after',
    );

    expect(result.addressed).toBe(1);
    const stored = await repo.findThreadById(thread.id);
    expect(stored?.status).toBe('addressed');
  });

  it('leaves pending threads alone when the agent edits the file', async () => {
    const thread = await createThread('');
    content.patches.set('ckpt_base', '@@ -1,2 +1,2 @@\n-a\n+b\n');

    const result = await service.reanchorFiles(
      'ws1',
      [{ repoAlias: '.', path: 'hello.py' }],
      'ckpt_after',
    );

    expect(result.addressed).toBe(0);
    const stored = await repo.findThreadById(thread.id);
    expect(stored?.status).toBe('pending');
  });

  it('re-opens an addressed thread when a new comment arrives', async () => {
    const thread = await createThread('');
    await repo.updateThread(thread.id, { status: 'addressed' });

    await service.addComment(thread.id, { body: 'Still missing the docstring.' });

    const stored = await repo.findThreadById(thread.id);
    expect(stored?.status).toBe('pending');
  });
});
