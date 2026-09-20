// ────────────────────────────────────────────────────────────────
// AgentStagingService — materialises a resolved projection onto disk so the
// harness can find it.
//
// Copilot discovers skills through `skillDirectories`, which means the selected
// skills must exist as real files somewhere the session can read. Staging
// happens OUTSIDE any git worktree (`<workspace>/.generatorai/`) so it never
// shows up as untracked noise in the diff/review UI.
//
// Copied, not symlinked: symlinks are unreliable on Windows and are not visible
// inside the Docker sandbox.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ILogger, ResolutionWarning, ResolvedAgentProjection } from '@generatorai/shared';

export interface StagingResult {
  /** Absolute directories to hand the provider as `skillDirectories`. */
  skillDirectories: string[];
  warnings: ResolutionWarning[];
}

interface StagingManifest {
  version: 1;
  entries: Record<string, string>;
}

/** Guards against a runaway skill tree filling the workspace. */
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 200;

export class AgentStagingService {
  constructor(private logger: ILogger) {}

  /** `<workspaceRoot>/.generatorai` — a sibling of `source/`, never inside a worktree. */
  stagingRoot(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.generatorai');
  }

  /**
   * Idempotent: a content-addressed manifest makes a re-check a no-op when
   * nothing changed, so this is safe to call on every conversation create.
   */
  async ensureStaged(
    workspaceRoot: string,
    projection: ResolvedAgentProjection,
  ): Promise<StagingResult> {
    const warnings: ResolutionWarning[] = [];
    const root = this.stagingRoot(workspaceRoot);
    const skillsDir = path.join(root, 'skills');

    if (projection.skills.refs.length === 0) {
      return { skillDirectories: [], warnings };
    }

    const manifestPath = path.join(root, 'manifest.json');
    const previous = await this.readManifest(manifestPath);
    const next: StagingManifest = { version: 1, entries: {} };

    let totalBytes = 0;
    let fileCount = 0;
    let budgetExceeded = false;

    await mkdir(skillsDir, { recursive: true });

    for (const skill of projection.skills.refs) {
      if (budgetExceeded) break;
      let content: string;
      try {
        content = await readFile(skill.filePath, 'utf-8');
        // Legacy bundled skills are plain Markdown. Codex and Claude discover
        // SKILL.md through required name/description frontmatter.
        if (!/^---\r?\n/.test(content)) {
          content = `---\nname: ${JSON.stringify(skill.name)}\ndescription: ${JSON.stringify(`Instructions for ${skill.name}`)}\n---\n\n${content}`;
        }
      } catch {
        warnings.push({ code: 'SKILL_NOT_FOUND', params: { id: skill.id } });
        continue;
      }

      const bytes = Buffer.byteLength(content, 'utf-8');
      if (totalBytes + bytes > MAX_TOTAL_BYTES || fileCount + 1 > MAX_FILES) {
        budgetExceeded = true;
        warnings.push({
          code: 'STAGING_BUDGET_EXCEEDED',
          params: { staged: fileCount, requested: projection.skills.refs.length },
        });
        break;
      }
      totalBytes += bytes;
      fileCount += 1;

      const hash = createHash('sha256').update(content).digest('hex');
      // Skill names are catalog-controlled, but this path is written to disk —
      // normalise so a crafted name cannot escape the staging directory.
      const safeName = skill.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100) || skill.id;
      const target = path.join(skillsDir, safeName, 'SKILL.md');
      next.entries[safeName] = hash;

      if (previous?.entries[safeName] === hash) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf-8');
    }

    // Drop skills that are no longer selected so a de-selected skill actually
    // stops being discoverable.
    if (previous) {
      for (const name of Object.keys(previous.entries)) {
        if (name in next.entries) continue;
        await rm(path.join(skillsDir, name), { recursive: true, force: true }).catch(() => undefined);
      }
    }

    await writeFile(manifestPath, JSON.stringify(next, null, 2), 'utf-8');
    return { skillDirectories: [skillsDir], warnings };
  }

  /** Remove everything this service wrote. Wired to workspace deletion. */
  async cleanup(workspaceRoot: string): Promise<void> {
    try {
      await rm(this.stagingRoot(workspaceRoot), { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(`[AgentStaging] Cleanup failed for ${workspaceRoot}: ${String(err)}`);
    }
  }

  /**
   * Stages a platform-owned skill that no agent selected.
   *
   * Deliberately a sibling directory of `skills/` rather than an entry in it:
   * `ensureStaged` prunes anything missing from its manifest, so a skill the
   * platform contributes would vanish the moment an agent-bound chat restaged.
   */
  async ensurePlatformSkill(
    workspaceRoot: string,
    skill: { name: string; content: string },
  ): Promise<string> {
    const dir = path.join(this.stagingRoot(workspaceRoot), 'platform-skills');
    const safeName = skill.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100) || 'skill';
    const target = path.join(dir, safeName, 'SKILL.md');
    await mkdir(path.dirname(target), { recursive: true });
    const existing = await readFile(target, 'utf-8').catch(() => null);
    if (existing !== skill.content) await writeFile(target, skill.content, 'utf-8');
    return dir;
  }

  private async readManifest(manifestPath: string): Promise<StagingManifest | null> {
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf-8')) as StagingManifest;
      if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === 'object') return parsed;
    } catch {
      // Missing or corrupt manifest just means "stage everything".
    }
    return null;
  }
}
