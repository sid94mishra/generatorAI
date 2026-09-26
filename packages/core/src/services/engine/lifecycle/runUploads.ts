// ────────────────────────────────────────────────────────────────
// RunUploads — the ONE writer of a run's uploaded skills, agents and prompts
// (P04 WP-4.1 step 4; C-16).
//
// Every upload lands in the run workspace's `config/` directory, outside the
// mounts (so autoCommit never picks it up, C-8), in the layout providers
// discover:
//   skills/<name>/SKILL.md     (a loose `name.md` becomes this)
//   agents/<name>.md
//   prompts/<file>
// `scan` turns the directory into the run's system values: the skill
// directory, the sub-agents (front matter `name`/`description`, the body is
// the instructions) and the prompt directory.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RunSystemVars } from '@generatorai/shared';

export type UploadCategory = 'skills' | 'agents' | 'prompts';

/** Extensions a run upload may have (no executables). */
export const UPLOAD_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.prompt']);

/** The run's uploads directory. */
export function runUploadsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'config');
}

/** A file name reduced to one safe path segment. */
export function safeUploadName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
  if (!cleaned) throw new Error(`"${name}" is not a usable file name`);
  return cleaned.slice(0, 120);
}

function stem(name: string): string {
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/** Write one upload; answers the path it landed at. An existing file is kept (the first writer wins). */
export async function writeRunUpload(workspaceRoot: string, category: UploadCategory, name: string, content: string | Uint8Array): Promise<string> {
  const safe = safeUploadName(name);
  const ext = path.extname(safe).toLowerCase();
  if (ext && !UPLOAD_EXTENSIONS.has(ext)) throw new Error(`"${name}": ${ext} files cannot be uploaded to a run`);
  const root = runUploadsDir(workspaceRoot);
  let target: string;
  if (category === 'skills') {
    const skill = safe.toUpperCase() === 'SKILL.MD' ? 'skill' : stem(safe);
    target = path.join(root, 'skills', skill, 'SKILL.md');
  } else if (category === 'agents') {
    target = path.join(root, 'agents', `${stem(safe)}.md`);
  } else {
    target = path.join(root, 'prompts', safe);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(target, content, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return target;
}

async function entries(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/** `name`/`description` front matter over a markdown body. */
function parseAgent(file: string, content: string): { name: string; description: string; instructions: string } | null {
  let body = content;
  const meta: Record<string, string> = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (m) {
    body = content.slice(m[0].length);
    for (const line of m[1]!.split(/\r?\n/)) {
      const kv = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
      if (kv) meta[kv[1]!] = kv[2]!.trim().replace(/^["']|["']$/g, '');
    }
  }
  const instructions = body.trim();
  if (!instructions) return null;
  return {
    name: (meta['name'] || stem(file)).slice(0, 120),
    description: (meta['description'] || `Custom agent from ${file}`).slice(0, 2000),
    instructions: instructions.slice(0, 64_000),
  };
}

/** The run's upload-derived system values. */
export async function scanRunUploads(
  workspaceRoot: string,
): Promise<Pick<RunSystemVars, 'skillDirectories' | 'customAgents' | 'promptDirectories'>> {
  const root = runUploadsDir(workspaceRoot);
  const out: Pick<RunSystemVars, 'skillDirectories' | 'customAgents' | 'promptDirectories'> = {};
  const skills = path.join(root, 'skills');
  if ((await entries(skills)).length > 0) out.skillDirectories = [skills];
  const agentsDir = path.join(root, 'agents');
  const agents: NonNullable<RunSystemVars['customAgents']> = [];
  for (const file of (await entries(agentsDir)).sort()) {
    const agent = parseAgent(file, await fs.readFile(path.join(agentsDir, file), 'utf8').catch(() => ''));
    if (agent) agents.push(agent);
  }
  if (agents.length > 0) out.customAgents = agents;
  const prompts = path.join(root, 'prompts');
  if ((await entries(prompts)).length > 0) out.promptDirectories = [prompts];
  return out;
}
