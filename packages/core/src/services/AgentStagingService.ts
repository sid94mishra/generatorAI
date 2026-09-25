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
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

/** Name of the plugin the platform's skills are staged into (RV-7). */
const PLUGIN_NAME = 'generatorai';

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

  /**
   * RV-7 — stage skills as a local plugin root for providers whose skills
   * load from plugins (claude-agent `Options.plugins`), one per conversation:
   * `<root>/.generatorai/plugin/<conversationId>/{.claude-plugin/plugin.json, skills/<name>/…}`.
   * Parallel stages and orchestrator workers share a workspace, so each
   * conversation owns its own root and never touches another's skills
   * (P02 review R3).
   *
   * `dirs` are skill directories (each holding `<name>/SKILL.md` folders):
   * the agent's staged skills, platform skills, explicit ones. Every skill
   * folder is copied in whole; a skill no longer in `dirs` is removed from
   * this conversation's root. Returns
   * the plugin root and the plugin-qualified skill names (`generatorai:<name>`)
   * the provider's skill filter expects. Idempotent.
   */
  async ensurePlugin(
    workspaceRoot: string,
    conversationId: string,
    dirs: readonly string[],
  ): Promise<{ path: string; skills: string[] }> {
    const owner = conversationId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'session';
    const pluginRoot = path.join(this.stagingRoot(workspaceRoot), 'plugin', owner);
    const skillsDir = path.join(pluginRoot, 'skills');
    await mkdir(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    await mkdir(skillsDir, { recursive: true });
    const manifest = {
      name: PLUGIN_NAME,
      version: '1.0.0',
      description: 'Skills the GeneratorAI platform provides to this session',
    };
    const manifestPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
    const manifestText = `${JSON.stringify(manifest, null, 2)}
`;
    if ((await readFile(manifestPath, 'utf-8').catch(() => null)) !== manifestText) {
      await writeFile(manifestPath, manifestText, 'utf-8');
    }

    const names = new Set<string>();
    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        const source = path.join(dir, name);
        const skillFile = path.join(source, 'SKILL.md');
        if (!(await stat(skillFile).then((st) => st.isFile()).catch(() => false))) continue;
        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100);
        if (!safeName || names.has(safeName)) continue;
        names.add(safeName);
        const target = path.join(skillsDir, safeName);
        await rm(target, { recursive: true, force: true });
        await cp(source, target, { recursive: true });
      }
    }
    for (const existing of await readdir(skillsDir).catch(() => [] as string[])) {
      if (!names.has(existing)) await rm(path.join(skillsDir, existing), { recursive: true, force: true });
    }
    return { path: pluginRoot, skills: [...names].map((n) => `${PLUGIN_NAME}:${n}`) };
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
