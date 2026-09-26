// ────────────────────────────────────────────────────────────────
// ArtifactService — artifact management (files, outputs)
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Artifact } from '@generatorai/shared';
import { generateId } from '@generatorai/shared';
import type { IArtifactRepository } from '../domain/ports/IRepositories.js';

export class ArtifactService {
  constructor(
    private artifactRepo: IArtifactRepository,
    private artifactsDir: string,
  ) {}

  /** Create a new artifact from content. */
  async createArtifact(params: {
    sessionId: string;
    /** v2: Associate artifact with a workflow run */
    workflowRunId?: string;
    /** v2: Associate artifact with a stage run */
    stageRunId?: string;
    name: string;
    mimeType: string;
    content: string | Buffer;
  }): Promise<Artifact> {
    const id = generateId();
    const now = new Date();

    // Write content to disk
    const filePath = path.join(this.artifactsDir, params.sessionId, `${id}-${params.name}`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, params.content);

    const stat = await fs.stat(filePath);

    const artifact: Artifact = {
      id,
      sessionId: params.sessionId,
      workflowRunId: params.workflowRunId,
      stageRunId: params.stageRunId,
      name: params.name,
      mimeType: params.mimeType,
      path: filePath,
      size: stat.size,
      direction: 'outbound',
      createdAt: now,
    };

    return this.artifactRepo.create(artifact);
  }

  /** Upsert an artifact (create or update). */
  async upsertArtifact(artifact: Artifact): Promise<Artifact> {
    return this.artifactRepo.upsert(artifact);
  }

  /** Get an artifact by ID. */
  async getArtifact(id: string): Promise<Artifact | null> {
    return this.artifactRepo.getById(id);
  }

  /** Get all artifacts for a session. */
  async getSessionArtifacts(sessionId: string): Promise<Artifact[]> {
    return this.artifactRepo.getBySessionId(sessionId);
  }

  /** Read artifact content. */
  async readArtifactContent(id: string): Promise<Buffer> {
    const artifact = await this.artifactRepo.getById(id);
    if (!artifact) throw new Error(`Artifact ${id} not found`);
    return fs.readFile(artifact.path);
  }

  /** Delete all artifacts for a session. */
  async deleteSessionArtifacts(sessionId: string): Promise<void> {
    await this.artifactRepo.deleteBySession(sessionId);
    const dir = path.join(this.artifactsDir, sessionId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
  }
}
